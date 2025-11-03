/**
 * Test local WSAA AFIP (HOMO)
 * Ejecutar: node testWSAA.js
 */

import fs from "fs";
import forge from "node-forge";
import axios from "axios";

// === CONFIG ===
const CERT_PATH = "./certs/certificado.crt"; // tu certificado PEM
const KEY_PATH = "./certs/clave.key"; // tu clave privada PEM
const CUIT = "20135464605"; // tu CUIT sin guiones
const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const SERVICE = "ws_sr_padron_a4";

async function main() {
  try {
    // === 1️⃣ Leer archivos ===
    const cert = fs.readFileSync(CERT_PATH, "utf8");
    const key = fs.readFileSync(KEY_PATH, "utf8");

    // === 2️⃣ Armar TRA ===
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

    console.log("📄 TRA generado:\n", tra);

    // === 3️⃣ Firmar TRA con PKCS#7 ===
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, "utf8");
    p7.addCertificate(forge.pki.certificateFromPem(cert));
    p7.addSigner({
      key: forge.pki.privateKeyFromPem(key),
      certificate: forge.pki.certificateFromPem(cert),
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });
    p7.sign();
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const cms = Buffer.from(der, "binary").toString("base64");

    console.log("🔑 CMS generado:\n", cms.slice(0, 200) + "..."); // mostrar solo inicio

    // === 4️⃣ Armar SOAP ===
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

    console.log("📡 SOAP listo para enviar...");

    // === 5️⃣ Enviar a WSAA ===
    const response = await axios.post(WSAA_URL, soapBody, {
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      timeout: 15000,
    });

    console.log("✅ Respuesta WSAA recibida:");
    console.log(response.data);
  } catch (err) {
    console.error("❌ Error en testWSAA:", err.response?.data || err.message);
  }
}

main();
