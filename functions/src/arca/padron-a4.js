/**
 * padron-a4.js - VERSIÓN ESTABLE
 */

import axios from "axios";
import https from "https";
import { parseStringPromise } from "xml2js";

// URLs corregidas según documentación AFIP
const URL_PADRON_A4 = (isProd = false) =>
  isProd
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4";

// Función para crear agente HTTPS con certificados
function createHttpsAgent(certPem, keyPem) {
  try {
    console.log("🔐 Creando agente HTTPS para padrón A4...");

    const formatCertificate = (cert) => {
      if (!cert) return cert;

      const base64Content = cert
        .replace(/-----BEGIN CERTIFICATE-----/g, "")
        .replace(/-----END CERTIFICATE-----/g, "")
        .trim();

      return `-----BEGIN CERTIFICATE-----\n${base64Content}\n-----END CERTIFICATE-----`;
    };

    const certFormatted = formatCertificate(certPem);
    const keyFormatted = keyPem;

    const agent = new https.Agent({
      cert: certFormatted,
      key: keyFormatted,
      rejectUnauthorized: true,
      secureProtocol: "TLSv1_2_method",
      keepAlive: true,
    });

    console.log("✅ Agente HTTPS para padrón A4 creado exitosamente");
    return agent;
  } catch (error) {
    console.error(
      "❌ Error creando agente HTTPS para padrón A4:",
      error.message
    );
    throw error;
  }
}

function extractPersona(parsed) {
  console.log("🔍 Buscando personaReturn en la estructura...");

  if (parsed["soap:Body"] && parsed["soap:Body"]["ns2:getPersonaResponse"]) {
    console.log("✅ Encontrado en estructura estándar A4");
    const personaReturn =
      parsed["soap:Body"]["ns2:getPersonaResponse"]["personaReturn"];
    if (personaReturn) return personaReturn;
  }

  function findPersonaReturn(obj, path = "") {
    if (!obj || typeof obj !== "object") return null;

    if (obj.personaReturn) {
      console.log(`✅ Encontrado personaReturn en: ${path}.personaReturn`);
      return obj.personaReturn;
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const result = findPersonaReturn(
          obj[key],
          path ? `${path}.${key}` : key
        );
        if (result) return result;
      }
    }

    return null;
  }

  const persona = findPersonaReturn(parsed);

  if (!persona) {
    console.error("❌ No se pudo encontrar personaReturn");
    return null;
  }

  return persona;
}

function validarCUIT(cuit) {
  if (!cuit || !/^\d{11}$/.test(cuit)) {
    throw new Error(`CUIT inválido: ${cuit}. Debe tener 11 dígitos.`);
  }
  return true;
}

export async function getPersonaData(cuit, secrets, isProd = false) {
  validarCUIT(cuit);

  if (!secrets?.cuit) {
    throw new Error("Falta CUIT de la representada (secrets.cuit)");
  }

  if (!secrets.token || !secrets.sign) {
    throw new Error("Token y sign son requeridos");
  }

  // ✅ MANTENER ORIGINAL - usar AFIP_CERT y AFIP_KEY directamente
  const cert = process.env.AFIP_CERT;
  const key = process.env.AFIP_KEY;

  console.log(
    `📁 [A4] Environment variables cargadas - Cert: ${cert?.length} chars, Key: ${key?.length} chars`
  );

  if (!cert || !key) {
    throw new Error(
      "No se pudieron cargar los certificados desde environment variables"
    );
  }

  const url = URL_PADRON_A4(isProd);
  console.log(`🔍 [A4] Consultando AFIP para CUIT: ${cuit}`);
  console.log(`🔍 [A4] URL: ${url}`);
  console.log(`🔍 [A4] CUIT Representada: ${secrets.cuit}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:a4="http://a4.soap.ws.server.puc.sr/">
    <soapenv:Header/>
    <soapenv:Body>
        <a4:getPersona>
            <token>${secrets.token}</token>
            <sign>${secrets.sign}</sign>
            <cuitRepresentada>${secrets.cuit}</cuitRepresentada>
            <idPersona>${cuit}</idPersona>
        </a4:getPersona>
    </soapenv:Body>
</soapenv:Envelope>`;

  let data;
  try {
    console.log(`🌐 [A4] Enviando solicitud a: ${url}`);

    const httpsAgent = createHttpsAgent(cert, key);

    const response = await axios.post(url, xml, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      httpsAgent,
      timeout: 30000,
    });
    data = response.data;
    console.log("✅ [A4] Respuesta recibida de AFIP");
  } catch (err) {
    console.error("❌ [A4] Error HTTP completo:", {
      message: err.message,
      code: err.code,
      status: err.response?.status,
    });

    if (err.response?.data) {
      const errorXml = err.response.data;
      if (errorXml.includes("<faultcode>")) {
        const faultCode =
          errorXml.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] ||
          "Desconocido";
        const faultString =
          errorXml.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
          "Error desconocido";
        console.error(`❌ [A4] Error SOAP AFIP: [${faultCode}] ${faultString}`);
        throw new Error(`AFIP A4 Error [${faultCode}]: ${faultString}`);
      }
    }

    throw new Error(`Error HTTP al llamar WS_SR_PADRON_A4: ${err.message}`);
  }

  if (data.includes("<faultcode>")) {
    const faultCode =
      data.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] || "Desconocido";
    const faultString =
      data.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
      "Error desconocido";
    console.error(`❌ [A4] Error SOAP AFIP: [${faultCode}] ${faultString}`);
    throw new Error(`AFIP A4 Error [${faultCode}]: ${faultString}`);
  }

  try {
    const parsed = await parseStringPromise(data, {
      explicitArray: false,
      mergeAttrs: true,
      explicitRoot: false,
    });

    console.log("🔍 [A4] Estructura parseada del XML");
    const persona = extractPersona(parsed);

    if (!persona) {
      console.error("❌ [A4] No se pudo parsear respuesta AFIP");
      throw new Error("No se pudo parsear la respuesta de AFIP PADRON A4");
    }

    if (persona.error) {
      console.error("❌ [A4] Error en respuesta persona:", persona.error);
      throw new Error(`AFIP Padron A4 Error: ${persona.error}`);
    }

    console.log(`✅ [AFIP PADRON A4] Consulta ${cuit} exitosa`);
    return persona;
  } catch (parseError) {
    console.error("❌ [A4] Error parseando XML:", parseError);
    throw new Error("Error procesando respuesta de AFIP A4");
  }
}
