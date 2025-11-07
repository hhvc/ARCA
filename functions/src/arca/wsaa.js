/**
 * wsaa.js - Actualizado para soportar A4 y A13
 */

import forge from "node-forge";
import axios from "axios";
import { parseStringPromise } from "xml2js";
import { getCachedToken, setCachedToken } from "./token-cache.js";
import { accessSecret } from "./secrets.js";

// Constantes para los servicios
const SERVICE_A4 = "ws_sr_padron_a4";
const SERVICE_A13 = "ws_sr_padron_a13";

export async function getTokenFromWSAA(service = SERVICE_A4, isProd = false) {
  const MODE = isProd ? "PROD" : "HOMO";

  // Verificar cache primero - clave única por servicio
  const cacheKey = `${service}_${MODE}`;
  const cached = getCachedToken(cacheKey);
  if (cached) {
    console.log(
      `✅ [${MODE}] Token obtenido desde cache para servicio: ${service}`
    );
    return cached;
  }

  try {
    console.log(
      `🔐 [${MODE}] Iniciando autenticación para servicio: ${service}`
    );

    // Usar nombres de secrets existentes
    const certSecretName = isProd ? "arca-cert-prod" : "AFIP_CERT";
    const keySecretName = isProd ? "arca-key-prod" : "AFIP_KEY";

    console.log(
      `📁 [${MODE}] Buscando secrets: ${certSecretName}, ${keySecretName}`
    );

    // Cargar secrets
    const [cert, key] = await Promise.all([
      accessSecret(certSecretName),
      accessSecret(keySecretName),
    ]);

    // Para CUIT, usar valor por defecto temporalmente
    const cuit = isProd ? await accessSecret("arca-cuit-prod") : "20253006219";

    console.log(
      `✅ [${MODE}] Secrets cargados - Cert: ${cert?.length} chars, Key: ${key?.length} chars, CUIT: ${cuit}`
    );

    // Verificar que los secrets sean válidos
    if (!cert || !key) {
      throw new Error("No se pudieron cargar los certificados");
    }

    if (!cert.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("Formato de certificado incorrecto");
    }

    if (!key.includes("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
      throw new Error("Formato de clave privada incorrecto");
    }

    console.log(`🔑 [${MODE}] Generando TRA para servicio: ${service}`);
    const tra = generarTRA(service);

    console.log(`✍️ [${MODE}] Firmando CMS...`);
    const cms = firmarTRA(tra, cert, key);

    const WSAA_URL = isProd
      ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
      : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

    console.log(`🚀 [${MODE}] Enviando a WSAA: ${WSAA_URL}`);
    const wsaaResponse = await enviarWSAA(cms, WSAA_URL);

    const loginCmsReturnXml = extraerLoginCmsReturn(wsaaResponse);
    const parsed = await parseStringPromise(loginCmsReturnXml, {
      explicitArray: false,
    });

    const credentials = parsed.loginTicketResponse?.credentials;
    const header = parsed.loginTicketResponse?.header;

    if (!credentials?.token || !credentials?.sign) {
      console.error("❌ Estructura de respuesta WSAA inesperada:", parsed);
      throw new Error("No se encontraron token/sign en la respuesta WSAA");
    }

    const expiration = new Date(header.expirationTime);
    const tokenData = {
      token: credentials.token,
      sign: credentials.sign,
      expiration,
      cuitRepresentada: cuit,
      service: service, // Agregar servicio para tracking
    };

    // Guardar en cache con clave específica del servicio
    setCachedToken(tokenData, cacheKey);

    console.log(`✅ [${MODE}] Token generado exitosamente para ${service}`);
    console.log(`⏰ Válido hasta: ${expiration.toISOString()}`);

    return tokenData;
  } catch (error) {
    console.error(
      `❌ [${MODE}] Error en getTokenFromWSAA para ${service}:`,
      error.message
    );

    // Limpiar cache en caso de error de autenticación
    if (
      error.message.includes("alreadyAuthenticated") ||
      error.message.includes("no autorizado")
    ) {
      console.log("🔄 Limpiando cache debido a error de autenticación...");
      const { clearCache } = await import("./token-cache.js");
      clearCache();
    }

    throw error;
  }
}

// Funciones auxiliares (mantener igual)
function generarTRA(service) {
  const uniqueId = Math.floor(Date.now() / 1000);
  const generationTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const expirationTime = new Date(
    Date.now() + 12 * 60 * 60 * 1000
  ).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
    <header>
        <uniqueId>${uniqueId}</uniqueId>
        <generationTime>${generationTime}</generationTime>
        <expirationTime>${expirationTime}</expirationTime>
    </header>
    <service>${service}</service>
</loginTicketRequest>`;
}

function firmarTRA(tra, certPem, keyPem) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(forge.pki.certificateFromPem(certPem));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem),
    certificate: forge.pki.certificateFromPem(certPem),
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, "binary").toString("base64");
}

async function enviarWSAA(cmsBase64, wsaaUrl) {
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.afip.gov.ar/">
    <soapenv:Header/>
    <soapenv:Body>
        <wsaa:loginCms>
            <wsaa:in0>${cmsBase64}</wsaa:in0>
        </wsaa:loginCms>
    </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const response = await axios.post(wsaaUrl, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      timeout: 20000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.data?.includes("alreadyAuthenticated")) {
      console.log("⚠️ WSAA rechazó por token existente, limpiando cache...");
      const { clearCache } = await import("./token-cache.js");
      clearCache();
      throw new Error("AFIP rechazó la solicitud: ya existe un token activo.");
    }

    // Manejar errores específicos de AFIP
    if (error.response?.data) {
      const errorData = error.response.data;
      if (errorData.includes("Computador no autorizado")) {
        throw new Error(
          "AFIP: Computador no autorizado - Verifique que el certificado esté autorizado para el servicio"
        );
      }
      if (errorData.includes("coe.notAuthorized")) {
        throw new Error(
          "AFIP: Servicio no autorizado - Verifique los permisos del certificado"
        );
      }
    }

    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.data}`
      : error.message;
    throw new Error("Error al enviar solicitud al WSAA: " + msg);
  }
}

function extraerLoginCmsReturn(wsaaResponseXml) {
  const match = wsaaResponseXml.match(
    /<loginCmsReturn>([^<]+)<\/loginCmsReturn>/
  );
  if (!match)
    throw new Error("No se encontró <loginCmsReturn> en respuesta WSAA");
  return match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// Funciones de conveniencia para mantener compatibilidad

// Función original (mantener para compatibilidad)
export async function getToken(isProd = false) {
  return await getTokenFromWSAA(SERVICE_A4, isProd);
}

// Función específica para A4
export async function getTokenA4(isProd = false) {
  return await getTokenFromWSAA(SERVICE_A4, isProd);
}

// Función específica para A13
export async function getTokenA13(isProd = false) {
  return await getTokenFromWSAA(SERVICE_A13, isProd);
}

// Función genérica para cualquier servicio
export async function getTokenForService(service, isProd = false) {
  return await getTokenFromWSAA(service, isProd);
}

// Exportar constantes de servicios
export { SERVICE_A4, SERVICE_A13 };
