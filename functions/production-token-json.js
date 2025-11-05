/**
 * production-token-json.js
 * WSAA AFIP: Producción con persistencia JSON de token y sign
 * Ejecutar: node production-token-json.js
 */

import fs from "fs";
import forge from "node-forge";
import axios from "axios";
import { parseStringPromise } from "xml2js";
import path from "path";

// === CONFIG ===
const CERT_PATH = "./certs/certificado.crt";
const KEY_PATH = "./certs/clave.key";
const CUIT_OBJETIVO = "20253006219";
const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const SERVICE = "ws_sr_padron_a4";
const TOKEN_FILE = path.resolve("./wsaa-token.json");

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

  console.log("� Enviando solicitud al WSAA...");
  console.log("   URL:", WSAA_URL);

  try {
    const resp = await axios.post(WSAA_URL, soapBody, {
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      timeout: 15000,
    });
    return resp.data;
  } catch (err) {
    if (err.response) {
      console.error("❌ Error al enviar a AFIP:");
      console.error("Código HTTP:", err.response.status);
      console.error("Respuesta:", err.response.data);
    } else {
      console.error("❌ Error al enviar a AFIP:", err.message);
    }
    throw err;
  }
}

// === EXTRAER LOGINCMS RETURN ===
function extraerTokenSign(wsaaResponseXml) {
  const match = wsaaResponseXml.match(
    /<loginCmsReturn>([^<]+)<\/loginCmsReturn>/
  );
  if (!match) return null;
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

  if (!credentials?.token || !credentials?.sign) {
    throw new Error("No se pudo extraer token/sign del WSAA");
  }

  const token = credentials.token;
  const sign = credentials.sign;
  const expiration = new Date(header.expirationTime);

  console.log("⏱ Token expiración:", expiration.toISOString());
  if (expiration < new Date())
    throw new Error("❌ Token recibido ya está vencido");

  console.log("✅ Token y sign OK, válidos hasta:", expiration.toISOString());
  return { token, sign, expiration };
}

// === LEER / GUARDAR TOKEN ===
function leerTokenPersistente() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    const exp = new Date(data.expiration);
    if (!data.token || !data.sign || !data.expiration || exp < new Date())
      return null;
    return data;
  } catch {
    return null;
  }
}

function guardarTokenPersistente({ token, sign, expiration }) {
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ token, sign, expiration }, null, 2),
    "utf8"
  );
  console.log("💾 Token guardado en wsaa-token.json");
}

// === GENERAR TOKEN PERSISTENTE ===
async function generarTokenPersistente() {
  let tokenData = leerTokenPersistente();
  if (tokenData) {
    console.log("✅ Token válido leído desde wsaa-token.json");
    return tokenData;
  }

  console.log("� Leyendo certificado y clave...");
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
  if (!loginCmsReturnXml)
    throw new Error("No se pudo extraer loginCmsReturn del WSAA");

  tokenData = await validarToken(loginCmsReturnXml);
  guardarTokenPersistente(tokenData);

  return tokenData;
}

// === EJECUTAR DIRECTAMENTE ===
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const tokenData = await generarTokenPersistente();
      console.log("✅ Token persistente generado correctamente:");
      console.log(tokenData);
      const tokenLeido = leerTokenPersistente();
      console.log("📄 Token leído desde JSON:", tokenLeido);
    } catch (err) {
      console.error("❌ Error al generar token persistente:", err);
    }
  })();
}

// === EXPORTS ES MODULES ===
export { generarTokenPersistente, leerTokenPersistente };
