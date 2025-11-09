/**
 * padron-a13.js - VERSIÓN ESTABLE
 */

import axios from "axios";
import https from "https";
import { parseStringPromise } from "xml2js";

// URLs CORREGIDAS según el manual oficial
const URL_PADRON_A13 = (isProd = false) =>
  isProd
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13";

// Función para crear agente HTTPS con certificados
function createHttpsAgent(certPem, keyPem) {
  try {
    console.log("🔐 Creando agente HTTPS para padrón A13...");

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

    console.log("✅ Agente HTTPS para padrón A13 creado exitosamente");
    return agent;
  } catch (error) {
    console.error("❌ Error creando agente HTTPS para padrón:", error.message);
    throw error;
  }
}

function extractPersonaA13(parsed) {
  console.log("🔍 Buscando personaReturn en la estructura para A13...");

  if (parsed["soap:Body"] && parsed["soap:Body"]["ns2:getPersonaResponse"]) {
    console.log("✅ Encontrado en estructura estándar A13");
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
    console.error("❌ No se pudo encontrar personaReturn en A13");
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

export async function getPersonaDataA13(cuit, secrets, isProd = false) {
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
    `📁 [A13] Environment variables cargadas - Cert: ${cert?.length} chars, Key: ${key?.length} chars`
  );

  if (!cert || !key) {
    throw new Error(
      "No se pudieron cargar los certificados desde environment variables"
    );
  }

  const url = URL_PADRON_A13(isProd);
  console.log(`🔍 [A13] Consultando AFIP para CUIT: ${cuit}`);
  console.log(`🔍 [A13] URL: ${url}`);
  console.log(`🔍 [A13] CUIT Representada: ${secrets.cuit}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:a13="http://a13.soap.ws.server.puc.sr/">
    <soapenv:Header/>
    <soapenv:Body>
        <a13:getPersona>
            <token>${secrets.token}</token>
            <sign>${secrets.sign}</sign>
            <cuitRepresentada>${secrets.cuit}</cuitRepresentada>
            <idPersona>${cuit}</idPersona>
        </a13:getPersona>
    </soapenv:Body>
</soapenv:Envelope>`;

  let data;
  try {
    console.log(`🌐 [A13] Enviando solicitud a: ${url}`);

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
    console.log("✅ [A13] Respuesta recibida de AFIP");
  } catch (err) {
    console.error("❌ [A13] Error HTTP completo:", {
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
        console.error(
          `❌ [A13] Error SOAP AFIP: [${faultCode}] ${faultString}`
        );
        throw new Error(`AFIP A13 Error [${faultCode}]: ${faultString}`);
      }
    }

    throw new Error(`Error HTTP al llamar WS_SR_PADRON_A13: ${err.message}`);
  }

  if (data.includes("<faultcode>")) {
    const faultCode =
      data.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] || "Desconocido";
    const faultString =
      data.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
      "Error desconocido";
    console.error(`❌ [A13] Error SOAP AFIP: [${faultCode}] ${faultString}`);
    throw new Error(`AFIP A13 Error [${faultCode}]: ${faultString}`);
  }

  try {
    const parsed = await parseStringPromise(data, {
      explicitArray: false,
      mergeAttrs: true,
      explicitRoot: false,
    });

    console.log("🔍 [A13] Estructura parseada del XML");
    const persona = extractPersonaA13(parsed);

    if (!persona) {
      console.error("❌ [A13] No se pudo parsear respuesta AFIP");
      throw new Error("No se pudo parsear la respuesta de AFIP PADRON A13");
    }

    if (persona.error) {
      console.error("❌ [A13] Error en respuesta persona:", persona.error);
      throw new Error(`AFIP Padron A13 Error: ${persona.error}`);
    }

    console.log(`✅ [AFIP PADRON A13] Consulta ${cuit} exitosa`);
    return persona;
  } catch (parseError) {
    console.error("❌ [A13] Error parseando XML:", parseError);
    throw new Error("Error procesando respuesta de AFIP A13");
  }
}
