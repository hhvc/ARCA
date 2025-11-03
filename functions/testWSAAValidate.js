import fs from "fs";
import forge from "node-forge";

// === CONFIG ===
const CERT_PATH = "./certs/certificado.crt";
const KEY_PATH = "./certs/clave.key";
const CUIT_OBJETIVO = "20253006219";
const SERVICE = "ws_sr_padron_a4";

function issuerToString(issuer) {
  return issuer.attributes
    .map((attr) => `${attr.shortName || attr.name}=${attr.value}`)
    .join(", ");
}

async function main() {
  try {
    console.log("📌 Leyendo certificado y clave...");

    const certPem = fs.readFileSync(CERT_PATH, "utf8");
    const keyPem = fs.readFileSync(KEY_PATH, "utf8");

    const cert = forge.pki.certificateFromPem(certPem);
    const subjectAttrs = cert.subject.attributes;

    let cn = subjectAttrs.find((a) => a.name === "commonName")?.value || "";
    let serialNumber =
      subjectAttrs.find((a) => a.name === "serialNumber")?.value || "";

    // Extraer CUIT del serialNumber
    let cuitCertMatch = serialNumber.match(/CUIT\s*(\d+)/i);
    let cuitCert = cuitCertMatch ? cuitCertMatch[1] : "";

    console.log("\n� Certificado del firmante:");
    console.log(`  CN (Nombre común / alias): ${cn}`);
    console.log(`  CUIT extraído del certificado: ${cuitCert}`);
    console.log(`  Issuer: ${issuerToString(cert.issuer)}`);
    console.log(`  Fecha inicio: ${cert.validity.notBefore.toISOString()}`);
    console.log(`  Fecha fin: ${cert.validity.notAfter.toISOString()}`);

    if (cuitCert !== CUIT_OBJETIVO) {
      console.warn(
        `⚠️ CUIT del certificado (${cuitCert}) NO coincide con la CUIT objetivo (${CUIT_OBJETIVO}).`
      );
      console.warn("❌ No continuar hasta corregir esto.");
      return;
    } else {
      console.log("✅ CUIT validado correctamente.");
    }

    // === TRA ===
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

    console.log("\n� TRA generado:\n", tra);

    // === Firmar TRA ===
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
      key: forge.pki.privateKeyFromPem(keyPem),
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
    const cms = Buffer.from(der, "binary").toString("base64");

    console.log(
      "\n� CMS generado (primeros 200 chars):\n",
      cms.slice(0, 200) + "..."
    );

    // === SOAP ===
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

    console.log(
      "\n� SOAP listo para enviar (primeros 500 chars):\n",
      soapBody.slice(0, 500) + "..."
    );

    // === Timestamps ===
    console.log("\n⏱ TRA timestamps:");
    console.log(`  uniqueId: ${uniqueId}`);
    console.log(`  generationTime: ${generationTime}`);
    console.log(`  expirationTime: ${expirationTime}`);

    console.log("\n✅ Script finalizado. Validación local exitosa.");
  } catch (err) {
    console.error("\n❌ Error en validación/test:", err.message || err);
  }
}

main();
