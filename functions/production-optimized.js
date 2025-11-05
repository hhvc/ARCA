/**
 * production-optimized.js
 * WSAA AFIP: validación de CUIT y token/sign con cache en memoria
 * Devuelve { token, sign, expiration } y evita múltiples requests si sigue vigente
 * Ejecutar: node production-optimized.js
 */

import fs from "fs";
import forge from "node-forge";
import axios from "axios";
import { parseStringPromise } from "xml2js";

// === CONFIG ===
const CERT_PATH = "./certs/certificado.crt";
const KEY_PATH = "./certs/clave.key";
const CUIT_OBJETIVO = "20253006219";
const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const SERVICE = "ws_sr_padron_a4";

// === CACHE EN MEMORIA ===
let cacheToken = null; // { token, sign, expiration }

// === GENERAR TRA ===
async function generarTRA() {
  const uniqueId = Math.floor(Date.now() / 1000);
  const generationTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const expirationTime = new Date(
    Date.now() + 12 * 60 * 60 * 1000
  ).toISOString();

  const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${SERVICE}</service>
</loginTicketRequest>`;

  return { tra, uniqueId, generationTime, expirationTime };
}

// === FIRMAR CMS ===
async function firmarCMS(tra, certPem, keyPem) {
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

// === ENVIAR WSAA ===
async function enviarWSAA(cms) {
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.afip.gov.ar/">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await axios.post(WSAA_URL, soapBody, {
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    timeout: 15000,
  });
  return resp.data;
}

// === EXTRAER LOGINCMS RETURN ===
function extraerTokenSign(wsaaResponseXml) {
  const match = wsaaResponseXml.match(
    /<loginCmsReturn>([^<]+)<\/loginCmsReturn>/
  );
  if (!match) throw new Error("No se encontró loginCmsReturn en WSAA response");
  return match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// === VALIDAR TOKEN ===
async function validarToken(loginCmsReturnXml) {
  const parsed = await parseStringPromise(loginCmsReturnXml, {
    explicitArray: false,
  });
  const credentials = parsed.loginTicketResponse?.credentials;
  const header = parsed.loginTicketResponse?.header;

  if (!credentials?.token || !credentials?.sign)
    throw new Error("No se pudo extraer token/sign del WSAA");

  const expiration = new Date(header.expirationTime);
  if (expiration < new Date())
    throw new Error("❌ Token recibido ya está vencido");

  return { token: credentials.token, sign: credentials.sign, expiration };
}

// === OBTENER TOKEN OPTIMIZADO ===
export async function obtenerTokenWSAA() {
  // Reutilizar si el token sigue vigente
  if (cacheToken && cacheToken.expiration > new Date()) {
    return cacheToken;
  }

  // Leer certificado y clave
  const certPem = fs.readFileSync(CERT_PATH, "utf8");
  const keyPem = fs.readFileSync(KEY_PATH, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);

  // Extraer CUIT
  let cuitExtraido = "";
  for (const attr of cert.subject.attributes) {
    if (
      (attr.shortName && attr.shortName.toUpperCase() === "SERIALNUMBER") ||
      (attr.name && attr.name.toUpperCase() === "SERIALNUMBER")
    ) {
      const match = attr.value.match(/\d{11}/);
      if (match) {
        cuitExtraido = match[0];
        break;
      }
    }
  }
  if (cuitExtraido !== CUIT_OBJETIVO)
    throw new Error(
      `⚠️ CUIT del certificado (${cuitExtraido}) NO coincide con la CUIT objetivo (${CUIT_OBJETIVO})`
    );

  const { tra } = await generarTRA();
  const cms = await firmarCMS(tra, certPem, keyPem);
  const wsaaResponse = await enviarWSAA(cms);
  const loginCmsReturnXml = extraerTokenSign(wsaaResponse);
  const { token, sign, expiration } = await validarToken(loginCmsReturnXml);

  // Guardar en cache
  cacheToken = { token, sign, expiration };
  return cacheToken;
}

// === EJECUCIÓN DIRECTA PARA TEST ===
if (import.meta.url === `file://${process.argv[1]}`) {
  obtenerTokenWSAA()
    .then(({ token, sign, expiration }) => {
      console.log("✅ Token válido hasta:", expiration.toISOString());
      console.log("Token preview:", token.slice(0, 50) + "...");
      console.log("Sign preview:", sign.slice(0, 50) + "...");
    })
    .catch(() => process.exit(1));
}
