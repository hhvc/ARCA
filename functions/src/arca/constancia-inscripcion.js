/**
 * constancia-inscripcion.js - Servicio de Constancia de Inscripción AFIP (VERSIÓN SIMPLIFICADA)
 */

import axios from "axios";
import https from "https";
import { parseStringPromise } from "xml2js";

// URLs para el servicio de constancia de inscripción (A5)
const URL_CONSTANCIA = (isProd = false) =>
  isProd
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5";

// Función simplificada para crear agente HTTPS
function createHttpsAgent(certPem, keyPem) {
  try {
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

    return new https.Agent({
      cert: certFormatted,
      key: keyFormatted,
      rejectUnauthorized: true,
      secureProtocol: "TLSv1_2_method",
    });
  } catch (error) {
    throw new Error(`Error creando agente HTTPS: ${error.message}`);
  }
}

// Función simplificada para extraer constancia
function extractConstancia(parsed) {
  // Busqueda directa sin recursión compleja
  if (parsed["soap:Body"] && parsed["soap:Body"]["a5:getPersonaResponse"]) {
    return parsed["soap:Body"]["a5:getPersonaResponse"]["personaReturn"];
  }

  // Busqueda alternativa
  if (parsed["soap:Body"] && parsed["soap:Body"]["getPersonaResponse"]) {
    return parsed["soap:Body"]["getPersonaResponse"]["personaReturn"];
  }

  // Último intento - buscar en toda la estructura
  const findInObject = (obj) => {
    if (obj && typeof obj === "object") {
      if (obj.personaReturn) return obj.personaReturn;
      for (const key in obj) {
        const result = findInObject(obj[key]);
        if (result) return result;
      }
    }
    return null;
  };

  return findInObject(parsed);
}

function validarCUIT(cuit) {
  if (!cuit || !/^\d{11}$/.test(cuit)) {
    throw new Error(`CUIT inválido: ${cuit}. Debe tener 11 dígitos.`);
  }
  return true;
}

export async function getConstanciaInscripcion(cuit, secrets, isProd = false) {
  validarCUIT(cuit);

  if (!secrets?.cuit) {
    throw new Error("Falta CUIT de la representada (secrets.cuit)");
  }

  if (!secrets.token || !secrets.sign) {
    throw new Error("Token y sign son requeridos");
  }

  const cert = process.env.AFIP_CERT;
  const key = process.env.AFIP_KEY;

  if (!cert || !key) {
    throw new Error("No se pudieron cargar los certificados");
  }

  const url = URL_CONSTANCIA(isProd);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:a5="http://a5.soap.ws.server.puc.sr/">
    <soapenv:Header/>
    <soapenv:Body>
        <a5:getPersona>
            <token>${secrets.token}</token>
            <sign>${secrets.sign}</sign>
            <cuitRepresentada>${secrets.cuit}</cuitRepresentada>
            <idPersona>${cuit}</idPersona>
        </a5:getPersona>
    </soapenv:Body>
</soapenv:Envelope>`;

  let data;
  try {
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
  } catch (err) {
    if (err.response?.data) {
      const errorXml = err.response.data;
      if (errorXml.includes("<faultcode>")) {
        const faultCode =
          errorXml.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] ||
          "Desconocido";
        const faultString =
          errorXml.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
          "Error desconocido";
        throw new Error(`AFIP Constancia Error [${faultCode}]: ${faultString}`);
      }
    }
    throw new Error(`Error HTTP al llamar WS_SR_CONSTANCIA: ${err.message}`);
  }

  if (data.includes("<faultcode>")) {
    const faultCode =
      data.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] || "Desconocido";
    const faultString =
      data.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
      "Error desconocido";
    throw new Error(`AFIP Constancia Error [${faultCode}]: ${faultString}`);
  }

  try {
    const parsed = await parseStringPromise(data, {
      explicitArray: false,
      mergeAttrs: true,
      explicitRoot: false,
    });

    const constancia = extractConstancia(parsed);

    if (!constancia) {
      throw new Error("No se pudo parsear la respuesta de AFIP Constancia");
    }

    if (constancia.error) {
      throw new Error(`AFIP Constancia Error: ${constancia.error}`);
    }

    return constancia;
  } catch (error) {
    // ✅ CORREGIDO: Usamos el parámetro 'error' en el mensaje
    throw new Error(
      `Error procesando respuesta de AFIP Constancia: ${error.message}`
    );
  }
}
