import axios from "axios";
import { parseStringPromise } from "xml2js";
import { getTokenFromWSAA } from "./wsaa.js";

// === CONFIGURACIÓN DE ENDPOINT ===
// Homologación: https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4
// Producción:   https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4
const URL_PADRON =
  process.env.URL_PADRON ||
  "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4";

// === FUNCIÓN AUXILIAR: extraer personaReturn del XML parseado ===
function extractPersona(parsed) {
  const envelope =
    parsed["soapenv:Envelope"] ||
    parsed["SOAP-ENV:Envelope"] ||
    parsed["Envelope"];
  const body =
    envelope?.["soapenv:Body"] ||
    envelope?.["SOAP-ENV:Body"] ||
    envelope?.["Body"];

  if (!body) return null;

  const responseKey = Object.keys(body).find((k) =>
    k.includes("getPersonaResponse")
  );
  return body?.[responseKey]?.["personaReturn"] || null;
}

/**
 * Obtiene datos del padrón AFIP (WS_SR_PADRON_A4)
 * @param {string} cuit - CUIT de la persona o entidad consultada
 * @param {Object} secrets - { cert, key, cuit } obtenidos de Firebase Secrets
 * @returns {Promise<Object>} Objeto con la información devuelta por AFIP
 */
export async function getPersonaData(cuit, secrets) {
  if (!secrets?.cuit) {
    throw new Error("Falta variable CUIT de la representada (secrets.cuit)");
  }

  // === 1️⃣ Obtener token + sign desde WSAA ===
  const { token, sign } = await getTokenFromWSAA("ws_sr_padron_a4", secrets);

  // === 2️⃣ Armar XML SOAP conforme al manual v1.3 ===
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:a4="http://ar.gov.afip.ws_sr_padron.a4/">
    <soapenv:Header/>
    <soapenv:Body>
      <a4:getPersona>
        <a4:token>${token}</a4:token>
        <a4:sign>${sign}</a4:sign>
        <a4:cuitRepresentada>${secrets.cuit}</a4:cuitRepresentada>
        <a4:idPersona>${cuit}</a4:idPersona>
      </a4:getPersona>
    </soapenv:Body>
  </soapenv:Envelope>`;

  // === 3️⃣ Llamar al servicio ===
  let data;
  try {
    const response = await axios.post(URL_PADRON, xml, {
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      timeout: 20000,
    });
    data = response.data;
  } catch (err) {
    throw new Error("Error al llamar al WS_SR_PADRON_A4: " + err.message);
  }

  // === 4️⃣ Manejo de error SOAP (fault) ===
  if (data.includes("<faultcode>")) {
    const faultCode =
      data.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] || "Desconocido";
    const faultString =
      data.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
      "Error desconocido";
    throw new Error(`Error SOAP AFIP Padron [${faultCode}]: ${faultString}`);
  }

  // === 5️⃣ Parsear XML a objeto JS ===
  const parsed = await parseStringPromise(data, { explicitArray: false });
  const persona = extractPersona(parsed);

  if (!persona) {
    throw new Error("No se pudo parsear la respuesta de AFIP PADRON A4");
  }

  if (process.env.DEBUG_AFIP === "true") {
    console.log(`[AFIP PADRON] Consulta ${cuit} OK`);
  }

  return persona;
}
