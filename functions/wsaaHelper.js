import fs from "fs";
import forge from "node-forge";
import axios from "axios";

const CERT_PATH = "./certs/certificado.crt";
const KEY_PATH = "./certs/clave.key";
const CUIT = "20253006219";
const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const SERVICE = "ws_sr_padron_a4";

function unescapeXml(escaped) {
  return escaped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export async function getToken() {
  const certPem = fs.readFileSync(CERT_PATH, "utf8");
  const keyPem = fs.readFileSync(KEY_PATH, "utf8");

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
  const cms = Buffer.from(der, "binary").toString("base64");

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

  const response = await axios.post(WSAA_URL, soapBody, {
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    timeout: 15000,
  });

  const matchReturn = response.data.match(
    /<loginCmsReturn>([\s\S]+)<\/loginCmsReturn>/
  );
  if (!matchReturn)
    throw new Error("No se encontró loginCmsReturn en la respuesta");

  // Manejo seguro: puede venir escapado o en base64
  let xmlToken = matchReturn[1].trim();
  if (xmlToken.startsWith("&lt;")) xmlToken = unescapeXml(xmlToken);

  const tokenMatch = xmlToken.match(/<token>(.+)<\/token>/s);
  const signMatch = xmlToken.match(/<sign>(.+)<\/sign>/s);
  if (!tokenMatch || !signMatch)
    throw new Error("No se pudo extraer token/sign del WSAA");

  const token = tokenMatch[1];
  const sign = signMatch[1];

  const genMatch = xmlToken.match(/<generationTime>(.+)<\/generationTime>/);
  const expMatch = xmlToken.match(/<expirationTime>(.+)<\/expirationTime>/);
  if (!genMatch || !expMatch)
    throw new Error("No se pudo extraer generationTime/expirationTime");

  const expirationTimeToken = new Date(expMatch[1]);
  if (new Date() > expirationTimeToken) throw new Error("Token WSAA vencido");

  const soapHeader = {
    "wsaa:RequesterCredentials": { token, sign, cuit: CUIT },
  };

  return {
    token,
    sign,
    soapHeader,
    generationTime: genMatch[1],
    expirationTime: expMatch[1],
  };
}
