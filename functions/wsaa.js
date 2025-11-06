/**
 * wsaa.js - Corregido para Firebase Secrets
 */

import forge from "node-forge";
import axios from "axios";
import { parseStringPromise } from "xml2js";
import { getCachedToken, setCachedToken } from "./token-cache.js";

const SERVICE = "ws_sr_padron_a4";
const WSAA_URL =
  process.env.MODE === "PROD"
    ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
    : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

// === FUNCIÓN PRINCIPAL CORREGIDA ===
export async function getTokenFromWSAA(service = SERVICE) {
  // Verificar cache primero
  const cached = getCachedToken(service);
  if (cached) {
    console.log("✅ Token obtenido desde cache");
    return cached;
  }

  // 🔍 DEBUG DETALLADO DE SECRETS
  const cert = process.env.AFIP_CERT;
  const key = process.env.AFIP_KEY;
  const cuit = process.env.AFIP_CUIT;

  console.log("🔍 [WSAA DEBUG] Secrets check:", {
    certPresent: !!cert,
    certLength: cert?.length,
    keyPresent: !!key,
    keyLength: key?.length,
    cuitPresent: !!cuit,
    cuitValue: cuit,
    mode: process.env.MODE,
  });

  if (!cert || !key || !cuit) {
    throw new Error(
      `Faltan secrets: cert=${!!cert}, key=${!!key}, cuit=${!!cuit}`
    );
  }

  // Verificar formato básico de certificado y clave
  if (!cert.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "Formato de certificado incorrecto - falta BEGIN CERTIFICATE"
    );
  }
  if (!key.includes("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
    throw new Error("Formato de clave privada incorrecto");
  }

  console.log("🔑 [WSAA] Generando nuevo token...");
  const tra = generarTRA(service);
  console.log("📝 TRA generado correctamente");

  const cms = firmarTRA(tra, cert, key);
  console.log("✍️ CMS firmado correctamente, longitud:", cms.length);

  console.log("🚀 Enviando solicitud a WSAA...");
  const wsaaResponse = await enviarWSAA(cms);
  console.log("📨 Respuesta recibida de WSAA");

  const loginCmsReturnXml = extraerLoginCmsReturn(wsaaResponse);
  console.log(
    "📄 LoginCmsReturn extraído, longitud:",
    loginCmsReturnXml.length
  );

  const parsed = await parseStringPromise(loginCmsReturnXml, {
    explicitArray: false,
  });

  const credentials = parsed.loginTicketResponse?.credentials;
  const header = parsed.loginTicketResponse?.header;

  if (!credentials?.token || !credentials?.sign) {
    console.error("❌ No se encontraron token/sign en la respuesta:", parsed);
    throw new Error("No se pudieron extraer token/sign del WSAA");
  }

  const expiration = new Date(header.expirationTime);
  const tokenData = {
    token: credentials.token,
    sign: credentials.sign,
    expiration,
  };

  // Guardar en cache
  setCachedToken(tokenData, service);

  console.log(
    "✅ Token generado exitosamente, válido hasta:",
    expiration.toISOString()
  );
  return tokenData;
}

// === FUNCIONES AUXILIARES (mantener igual) ===
function generarTRA(service = SERVICE) {
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

async function enviarWSAA(cmsBase64) {
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
    const response = await axios.post(WSAA_URL, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      timeout: 20000,
    });
    return response.data;
  } catch (error) {
    // Manejo específico del error "alreadyAuthenticated"
    if (
      error.response &&
      error.response.data &&
      error.response.data.includes("alreadyAuthenticated")
    ) {
      console.log("⚠️ WSAA rechazó por token existente, limpiando cache...");

      // Limpiar cache forzosamente
      const { clearCache } = await import("./token-cache.js");
      clearCache();

      throw new Error(
        "AFIP rechazó la solicitud: ya existe un token activo. Use el método con token externo."
      );
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
