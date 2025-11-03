/**
 * Test WSAA AFIP (HOMO) con decodificación de CMS
 * Ejecutar: node testWSAADecode.js
 */

import fs from "fs";
import forge from "node-forge";

// === CONFIG ===
const CERT_PATH = "./certs/certificado.crt"; // tu certificado PEM
const KEY_PATH = "./certs/clave.key"; // tu clave privada PEM
const SERVICE = "ws_sr_padron_a4";

async function main() {
  try {
    // === 1️⃣ Leer archivos ===
    const certPem = fs.readFileSync(CERT_PATH, "utf8");
    const keyPem = fs.readFileSync(KEY_PATH, "utf8");

    // === 2️⃣ Generar TRA ===
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
    const cert = forge.pki.certificateFromPem(certPem);
    const key = forge.pki.privateKeyFromPem(keyPem);

    p7.addCertificate(cert);
    p7.addSigner({
      key: key,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });

    p7.sign();
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const cmsBase64 = Buffer.from(der, "binary").toString("base64");

    console.log(
      "🔑 CMS generado (primeros 200 chars):\n",
      cmsBase64.slice(0, 200),
      "..."
    );

    // === 4️⃣ Decodificar CMS para inspección ===
    const cmsAsn1 = forge.asn1.fromDer(forge.util.createBuffer(der, "binary"));
    const cms = forge.pkcs7.messageFromAsn1(cmsAsn1);

    // Certificado que firmó
    const signerCert = cms.certificates[0];
    const subject = signerCert.subject.getField("CN")?.value || "Desconocido";
    const issuer = signerCert.issuer.getField("CN")?.value || "Desconocido";

    console.log("\n📜 Certificado del firmante:");
    console.log("  CN (Nombre común / CUIT):", subject);
    console.log("  Issuer:", issuer);
    console.log("  Fecha inicio:", signerCert.validity.notBefore);
    console.log("  Fecha fin:", signerCert.validity.notAfter);

    // === 5️⃣ Mostrar SOAP que se enviaría ===
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

    console.log(
      "\n📡 SOAP listo para enviar (primeros 500 chars):\n",
      soapBody.slice(0, 500),
      "...\n"
    );

    console.log(
      "✅ Script finalizado. Ahora podés inspeccionar CUIT y timestamps antes de enviar."
    );
  } catch (err) {
    console.error("❌ Error en testWSAADecode:", err.message || err);
  }
}

main();
