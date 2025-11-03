/* eslint-env node */
import forge from "node-forge";
import axios from "axios";

// === CONFIG ===
const DEFAULT_WSAA =
  process.env.MODE === "PROD"
    ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
    : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const DEFAULT_SERVICE = "ws_sr_padron_a4";

// === CACHE LOCAL DE TOKEN ===
let cachedToken = null;
let cachedSign = null;
let cachedExpiry = null;

// === FUNCIÓN AUXILIAR ===
function parseExpiration(soapResponse) {
  const m = soapResponse.match(/<expirationTime>([^<]+)<\/expirationTime>/);
  return m ? new Date(m[1]) : null;
}

/**
 * Obtiene o renueva el token + sign desde WSAA (AFIP)
 * @param {string} service Nombre del servicio solicitado (ej: "ws_sr_padron_a4")
 * @param {Object} secrets { cert, key, cuit }
 * @returns {Promise<{token: string, sign: string}>}
 */
export async function getTokenFromWSAA(
  service = DEFAULT_SERVICE,
  secrets = {}
) {
  // === 1️⃣ Validar cache ===
  if (cachedToken && cachedExpiry && new Date() < cachedExpiry) {
    console.log(
      `[AFIP WSAA] Usando token cacheado válido hasta ${cachedExpiry.toISOString()}`
    );
    return { token: cachedToken, sign: cachedSign };
  }

  // === 2️⃣ Validar secretos ===
  const { cert, key, cuit } = secrets;
  if (!cert || !key || !cuit) {
    throw new Error("Faltan datos en secrets: cert, key o cuit");
  }

  const wsaaUrl = process.env.WSAA_URL || DEFAULT_WSAA;

  // === 3️⃣ Armar TRA (Ticket de Requerimiento de Acceso) ===
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
    <service>${service}</service>
  </loginTicketRequest>`;

  // === 4️⃣ Firmar TRA con PKCS#7 ===
  let cms;
  try {
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
    cms = Buffer.from(der, "binary").toString("base64");
  } catch (err) {
    throw new Error("Error firmando TRA: " + err.message);
  }

  // === 5️⃣ Armar request SOAP ===
  const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:wsaa="http://wsaa.view.sua.dvadac.afip.gov.ar/">
    <soapenv:Header/>
    <soapenv:Body>
      <wsaa:loginCms>
        <wsaa:in0>${cms}</wsaa:in0>
      </wsaa:loginCms>
    </soapenv:Body>
  </soapenv:Envelope>`;

  // === 6️⃣ Invocar WSAA ===
  let data;
  try {
    const response = await axios.post(wsaaUrl, soapRequest, {
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      timeout: 25000,
    });
    data = response.data;
  } catch (err) {
    throw new Error(`Error al invocar WSAA (${wsaaUrl}): ${err.message}`);
  }

  // === 7️⃣ Manejar errores SOAP ===
  if (data.includes("<faultcode>")) {
    const faultCode =
      data.match(/<faultcode>([^<]+)<\/faultcode>/)?.[1] || "Desconocido";
    const faultString =
      data.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] ||
      "Error desconocido";
    throw new Error(`Error SOAP AFIP WSAA [${faultCode}]: ${faultString}`);
  }

  // === 8️⃣ Extraer token y sign ===
  const token = data.match(/<token>([^<]+)<\/token>/)?.[1];
  const sign = data.match(/<sign>([^<]+)<\/sign>/)?.[1];
  const expiration = parseExpiration(data);

  if (!token || !sign) {
    console.error("Respuesta WSAA incompleta:\n", data.slice(0, 500));
    throw new Error("No se obtuvo token/sign de WSAA");
  }

  // === 9️⃣ Cachear en memoria ===
  cachedToken = token;
  cachedSign = sign;
  cachedExpiry = expiration || new Date(Date.now() + 11 * 60 * 60 * 1000);

  console.log(
    `[AFIP WSAA] Token obtenido correctamente. Válido hasta ${cachedExpiry.toISOString()}`
  );
  return { token, sign };
}
