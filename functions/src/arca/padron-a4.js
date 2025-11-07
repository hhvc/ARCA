import axios from "axios";
import { parseStringPromise } from "xml2js";

// URLs corregidas según documentación AFIP
const URL_PADRON =
  process.env.MODE === "PROD"
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4";

function extractPersona(parsed) {
  console.log("🔍 Buscando personaReturn en la estructura...");

  // La estructura real según los logs es:
  // { 'soap:Body': { 'ns2:getPersonaResponse': { personaReturn: ... } } }

  if (parsed["soap:Body"] && parsed["soap:Body"]["ns2:getPersonaResponse"]) {
    console.log(
      "✅ Encontrado en estructura: soap:Body -> ns2:getPersonaResponse -> personaReturn"
    );
    const personaReturn =
      parsed["soap:Body"]["ns2:getPersonaResponse"]["personaReturn"];

    if (personaReturn) {
      console.log("✅ Datos extraídos correctamente");
      return personaReturn;
    }
  }

  // Fallback: buscar recursivamente
  function findPersonaReturn(obj, path = "") {
    if (!obj || typeof obj !== "object") return null;

    if (obj.personaReturn) {
      console.log(`✅ Encontrado personaReturn en: ${path}.personaReturn`);
      return obj.personaReturn;
    }

    for (const key in obj) {
      // CORRECCIÓN: Usar Object.prototype.hasOwnProperty.call() en lugar de obj.hasOwnProperty()
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

export async function getPersonaData(cuit, secrets) {
  validarCUIT(cuit);

  if (!secrets?.cuit) {
    throw new Error("Falta CUIT de la representada (secrets.cuit)");
  }

  if (!secrets.token || !secrets.sign) {
    throw new Error("Token y sign son requeridos");
  }

  console.log(`🔍 Consultando AFIP para CUIT: ${cuit}`);
  console.log(`🔍 Mode: ${process.env.MODE || "No configurado"}`);
  console.log(`🔍 CUIT Representada: ${secrets.cuit}`);

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
    console.log(`🌐 Enviando solicitud a: ${URL_PADRON}`);
    const response = await axios.post(URL_PADRON, xml, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      timeout: 30000,
    });
    data = response.data;
    console.log("✅ Respuesta recibida de AFIP");

    // Log temporal para debug
    console.log("📄 Respuesta XML completa:", data.substring(0, 1000) + "...");
  } catch (err) {
    console.error("❌ Error HTTP completo:", {
      message: err.message,
      code: err.code,
      response: err.response?.data,
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
        console.error(`❌ Error SOAP AFIP: [${faultCode}] ${faultString}`);
        throw new Error(`AFIP Error [${faultCode}]: ${faultString}`);
      }
    }

    throw new Error(`Error HTTP al llamar WS_SR_PADRON_A4: ${err.message}`);
  }

  // Manejo de error SOAP en la respuesta exitosa
  if (data.includes("<faultcode>")) {
    const faultCode =
      data.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] || "Desconocido";
    const faultString =
      data.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
      "Error desconocido";
    console.error(
      `❌ Error SOAP AFIP en respuesta: [${faultCode}] ${faultString}`
    );
    throw new Error(`AFIP Error [${faultCode}]: ${faultString}`);
  }

  try {
    const parsed = await parseStringPromise(data, {
      explicitArray: false,
      mergeAttrs: true,
      explicitRoot: false,
    });

    console.log("🔍 Estructura parseada del XML");
    const persona = extractPersona(parsed);

    if (!persona) {
      console.error(
        "❌ No se pudo parsear respuesta AFIP. Estructura completa:",
        parsed
      );
      throw new Error("No se pudo parsear la respuesta de AFIP PADRON A4");
    }

    // Validar si hay error en la respuesta
    if (persona.error) {
      console.error("❌ Error en respuesta persona:", persona.error);
      throw new Error(`AFIP Padron Error: ${persona.error}`);
    }

    console.log(`✅ [AFIP PADRON] Consulta ${cuit} exitosa`);
    return persona;
  } catch (parseError) {
    console.error("❌ Error parseando XML:", parseError);
    console.error("📄 XML que falló:", data.substring(0, 500));
    throw new Error("Error procesando respuesta de AFIP");
  }
}
