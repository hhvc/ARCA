/**
 * production-ready.js
 * Producción: WSAA AFIP con logs completos y validación de token
 * Ejecutar: node production-ready.js
 */

import fs from "fs";
import forge from "node-forge";
import axios from "axios";
import { parseStringPromise } from "xml2js";

// === CONFIG ===
const CERT_PATH = "./certs/certificado.crt"; // tu certificado PEM
const KEY_PATH = "./certs/clave.key"; // tu clave privada PEM
const CUIT_OBJETIVO = "20253006219"; // CUIT del computador autorizado
const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms"; // usar wsaa o wsaa producción según entorno
const SERVICE = "ws_sr_padron_a4";

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

  const decoded = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return decoded;
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
  if (expiration < new Date()) {
    throw new Error("❌ Token recibido ya está vencido");
  }

  console.log("✅ Token y sign OK, válidos hasta:", expiration.toISOString());
  return { token, sign, expiration };
}

// === MAIN ===
async function main() {
  try {
    console.log("� Leyendo certificado y clave...");
    const certPem = fs.readFileSync(CERT_PATH, "utf8");
    const keyPem = fs.readFileSync(KEY_PATH, "utf8");

    const cert = forge.pki.certificateFromPem(certPem);

    // Extraer CN
    const cnField = cert.subject.getField("CN");
    const cn = cnField ? cnField.value : "";

    // === EXTRAER CUIT (ESTO FUNCIONA) ===
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

    // Extraer Issuer legible
    const issuer = cert.issuer.attributes
      .map((a) => `${a.shortName || a.name}=${a.value}`)
      .join(", ");

    console.log("\n� Certificado del firmante:");
    console.log("  CN (alias):", cn);
    console.log("  CUIT extraído:", cuitExtraido);
    console.log("  Issuer:", issuer);
    console.log("  Fecha inicio:", cert.validity.notBefore.toISOString());
    console.log("  Fecha fin:", cert.validity.notAfter.toISOString());

    if (cuitExtraido !== CUIT_OBJETIVO) {
      throw new Error(
        `⚠️ CUIT del certificado (${cuitExtraido}) NO coincide con la CUIT objetivo (${CUIT_OBJETIVO})`
      );
    }
    console.log("✅ CUIT validado correctamente.\n");

    // Generar TRA
    const { tra, uniqueId, generationTime, expirationTime } =
      await generarTRA();
    console.log("� TRA generado:\n", tra);

    // Firmar CMS
    const cms = await firmarCMS(tra, certPem, keyPem);
    console.log(
      "� CMS generado (primeros 200 chars):\n",
      cms.slice(0, 200) + "..."
    );

    // Preparar SOAP
    console.log(
      "\n� SOAP listo para enviar (primeros 500 chars):\n",
      '<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope>...'
    );

    console.log("\n⏱ TRA timestamps:");
    console.log("  uniqueId:", uniqueId);
    console.log("  generationTime:", generationTime);
    console.log("  expirationTime:", expirationTime);

    // Enviar a WSAA
    const wsaaResponse = await enviarWSAA(cms);

    // Extraer loginCmsReturn
    const loginCmsReturnXml = extraerTokenSign(wsaaResponse);
    if (!loginCmsReturnXml)
      throw new Error("No se pudo extraer loginCmsReturn del WSAA");

    // Validar token
    await validarToken(loginCmsReturnXml);

    console.log("\n✅ Script finalizado. Token y SOAP listos para usar.");
  } catch (err) {
    console.error("\n❌ Error en producción:", err.message || err);
  }
}

main();
