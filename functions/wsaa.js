/**
 * wsaa.js
 * Genera y cachea (en memoria) el token y sign de AFIP WSAA.
 * Compatible con Google Cloud Functions (Node.js 22 + ESM).
 */

import forge from "node-forge";
import axios from "axios";
import { parseStringPromise } from "xml2js";

// ======================================================
// === CONFIG GLOBAL ===
const SERVICE = "ws_sr_padron_a4";
const WSAA_URL =
  process.env.MODE === "PROD"
    ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
    : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

// ======================================================
// === CACHÉ TEMPORAL EN MEMORIA ===
let tokenCache = {
  token: null,
  sign: null,
  expiration: null,
};

/**
 * Verifica si el token actual sigue siendo válido.
 * Devuelve true si el token existe y no venció.
 */
function tokenValido() {
  if (!tokenCache.token || !tokenCache.sign || !tokenCache.expiration)
    return false;
  const exp = new Date(tokenCache.expiration);
  const ahora = new Date();
  // Consideramos 2 minutos de margen antes del vencimiento
  return exp > new Date(ahora.getTime() + 2 * 60 * 1000);
}

// ======================================================
// === FUNCIÓN: Generar TRA ===
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

// ======================================================
// === FUNCIÓN: Firmar TRA en CMS con forge ===
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

// ======================================================
// === FUNCIÓN: Enviar a WSAA ===
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
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      timeout: 20000,
    });
    return response.data;
  } catch (error) {
    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.data}`
      : error.message;
    throw new Error("Error al enviar solicitud al WSAA: " + msg);
  }
}

// ======================================================
// === FUNCIÓN: Extraer loginCmsReturn del XML ===
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

// ======================================================
// === FUNCIÓN PRINCIPAL: getTokenFromWSAA ===
export async function getTokenFromWSAA(service = SERVICE, _unusedSecrets = {}) {
  // ✅ Reusar si el token en memoria aún es válido
  if (tokenValido()) {
    console.log("♻️ [WSAA] Token en memoria válido, reutilizando");
    return tokenCache;
  }

  const cert = process.env.AFIP_CERT;
  const key = process.env.AFIP_KEY;
  const cuit = process.env.AFIP_CUIT;

  if (!cert || !key || !cuit) {
    throw new Error("Faltan datos en secrets: cert, key o cuit");
  }

  console.log("🔑 [WSAA] Generando nuevo token...");
  const tra = generarTRA(service);
  const cms = firmarTRA(tra, cert, key);

  const wsaaResponse = await enviarWSAA(cms);
  const loginCmsReturnXml = extraerLoginCmsReturn(wsaaResponse);

  // === Parsear loginCmsReturn ===
  const parsed = await parseStringPromise(loginCmsReturnXml, {
    explicitArray: false,
  });
  const credentials = parsed.loginTicketResponse?.credentials;
  const header = parsed.loginTicketResponse?.header;

  if (!credentials?.token || !credentials?.sign) {
    throw new Error("No se pudieron extraer token/sign del WSAA");
  }

  const expiration = new Date(header.expirationTime);
  console.log("⏱ Token válido hasta:", expiration.toISOString());

  // Guardar en caché
  tokenCache = {
    token: credentials.token,
    sign: credentials.sign,
    expiration,
  };

  return tokenCache;
}
