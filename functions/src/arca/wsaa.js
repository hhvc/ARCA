/**
 * wsaa.js - Con logs detallados para debug
 */

import forge from "node-forge";
import axios from "axios";
import https from "https";
import { parseStringPromise } from "xml2js";
import { getCachedToken, setCachedToken } from "./token-cache.js";

// Constantes para los servicios
const SERVICE_A4 = "ws_sr_padron_a4";
const SERVICE_A13 = "ws_sr_padron_a13";

// Función para crear agente HTTPS con certificados
function createHttpsAgent(certPem, keyPem) {
  try {
    console.log("🔐 Creando agente HTTPS con certificado...");

    // ✅ CORREGIDO: Formateo más agresivo y confiable
    const formatCertificate = (cert) => {
      if (!cert) return cert;

      console.log(
        `🔐 [DEBUG] Procesando certificado - longitud: ${cert.length}`
      );
      console.log(`🔐 [DEBUG] Primeros 50 chars: "${cert.substring(0, 50)}"`);

      // FORZAR el formateo - siempre agregar saltos de línea
      const base64Content = cert
        .replace(/-----BEGIN CERTIFICATE-----/g, "")
        .replace(/-----END CERTIFICATE-----/g, "")
        .trim();

      // Reconstruir con formato PEM CORRECTO
      const formatted = `-----BEGIN CERTIFICATE-----\n${base64Content}\n-----END CERTIFICATE-----`;

      console.log("🔐 [DEBUG] Certificado formateado (primeros 120 chars):");
      console.log(formatted.substring(0, 120));
      console.log(
        `🔐 [DEBUG] ¿Tiene salto de línea después de BEGIN? ${formatted.includes(
          "-----BEGIN CERTIFICATE-----\n"
        )}`
      );
      return formatted;
    };

    const certFormatted = formatCertificate(certPem);
    const keyFormatted = keyPem; // La clave ya está bien formateada

    console.log("🔐 [DEBUG] === CERTIFICADO FINAL PARA HTTPS ===");
    console.log(certFormatted);
    console.log("🔐 [DEBUG] === FIN CERTIFICADO ===");

    const agent = new https.Agent({
      cert: certFormatted,
      key: keyFormatted,
      rejectUnauthorized: true,
      secureProtocol: "TLSv1_2_method",
      keepAlive: true,
    });

    console.log("✅ Agente HTTPS creado exitosamente");
    return agent;
  } catch (error) {
    console.error("❌ Error creando agente HTTPS:", error.message);
    console.error("🔐 [DEBUG] Stack trace:", error.stack);
    throw new Error(`Error configurando SSL: ${error.message}`);
  }
}

export async function getTokenFromWSAA(service = SERVICE_A4, isProd = false) {
  const MODE = isProd ? "PROD" : "HOMO";

  // Verificar cache primero - clave única por servicio
  const cacheKey = `${service}_${MODE}`;
  const cached = getCachedToken(cacheKey);
  if (cached) {
    console.log(
      `✅ [${MODE}] Token obtenido desde cache para servicio: ${service}`
    );
    return cached;
  }

  try {
    console.log(
      `🔐 [${MODE}] Iniciando autenticación para servicio: ${service}`
    );

    // ✅ CORREGIDO: Limpiar los secrets de \r\n y espacios extra
    const cert = process.env.AFIP_CERT?.replace(/\r\n/g, "\n").trim();
    const key = process.env.AFIP_KEY?.replace(/\r\n/g, "\n").trim();
    const cuit = process.env["arca-cuit-prod"]?.replace(/\r\n/g, "").trim();

    console.log(
      `✅ [${MODE}] Environment variables - Cert: ${cert?.length} chars, Key: ${
        key?.length
      } chars, CUIT: ${cuit ? "PRESENTE" : "FALTA"}`
    );

    // DEBUG DETALLADO de certificados
    console.log("🔍 [DEBUG DETALLADO] === INICIO CERTIFICADO ===");
    console.log(cert);
    console.log("🔍 [DEBUG DETALLADO] === FIN CERTIFICADO ===");

    console.log("🔍 [DEBUG DETALLADO] === INICIO CLAVE PRIVADA ===");
    console.log(key?.substring(0, 500) + "..."); // Solo primeros 500 chars por seguridad
    console.log("🔍 [DEBUG DETALLADO] === FIN CLAVE PRIVADA ===");

    // Si no tenemos CUIT, lanzar error específico
    if (!cuit) {
      throw new Error(
        "No se pudo cargar el CUIT desde environment variables. Verifica el secreto 'arca-cuit-prod'"
      );
    }

    // Verificar que los environment variables sean válidos
    if (!cert || !key) {
      throw new Error(
        "No se pudieron cargar los certificados desde environment variables"
      );
    }

    // Validaciones más estrictas del formato PEM
    if (!cert.startsWith("-----BEGIN CERTIFICATE-----")) {
      console.error("❌ [DEBUG] Certificado no empieza con BEGIN CERTIFICATE");
      console.error("❌ [DEBUG] Primeros 50 chars:", cert.substring(0, 50));
      throw new Error(
        "Formato de certificado incorrecto - debe empezar con '-----BEGIN CERTIFICATE-----'"
      );
    }

    if (!cert.endsWith("-----END CERTIFICATE-----")) {
      console.error("❌ [DEBUG] Certificado no termina con END CERTIFICATE");
      console.error(
        "❌ [DEBUG] Últimos 50 chars:",
        cert.substring(cert.length - 50)
      );
      throw new Error(
        "Formato de certificado incorrecto - debe terminar con '-----END CERTIFICATE-----'"
      );
    }

    if (!key.startsWith("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
      console.error("❌ [DEBUG] Formato de clave privada incorrecto");
      console.error(
        "❌ [DEBUG] Primeros 50 chars de clave:",
        key.substring(0, 50)
      );
      throw new Error("Formato de clave privada incorrecto");
    }

    console.log(`🔑 [${MODE}] Generando TRA para servicio: ${service}`);
    const tra = generarTRA(service);
    console.log("🔍 [DEBUG] TRA generado:", tra);

    console.log(`✍️ [${MODE}] Firmando CMS...`);
    const cms = firmarTRA(tra, cert, key);
    console.log(
      `🔍 [DEBUG] CMS generado (primeros 100 chars): ${cms.substring(
        0,
        100
      )}...`
    );

    const WSAA_URL = isProd
      ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
      : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

    console.log(`🚀 [${MODE}] Enviando a WSAA: ${WSAA_URL}`);
    const wsaaResponse = await enviarWSAA(cms, WSAA_URL, cert, key);

    console.log("🔍 [DEBUG] Respuesta WSAA recibida");
    const loginCmsReturnXml = extraerLoginCmsReturn(wsaaResponse);
    console.log(
      "🔍 [DEBUG] loginCmsReturn extraído (primeros 200 chars):",
      loginCmsReturnXml.substring(0, 200)
    );

    const parsed = await parseStringPromise(loginCmsReturnXml, {
      explicitArray: false,
    });

    console.log("🔍 [DEBUG] XML parseado:", JSON.stringify(parsed, null, 2));

    const credentials = parsed.loginTicketResponse?.credentials;
    const header = parsed.loginTicketResponse?.header;

    if (!credentials?.token || !credentials?.sign) {
      console.error("❌ Estructura de respuesta WSAA inesperada:", parsed);
      throw new Error("No se encontraron token/sign en la respuesta WSAA");
    }

    const expiration = new Date(header.expirationTime);
    const tokenData = {
      token: credentials.token,
      sign: credentials.sign,
      expiration,
      cuitRepresentada: cuit,
      service: service,
    };

    // Guardar en cache con clave específica del servicio
    setCachedToken(tokenData, cacheKey);

    console.log(`✅ [${MODE}] Token generado exitosamente para ${service}`);
    console.log(`⏰ Válido hasta: ${expiration.toISOString()}`);

    return tokenData;
  } catch (error) {
    console.error(
      `❌ [${MODE}] Error en getTokenFromWSAA para ${service}:`,
      error.message
    );
    console.error("🔍 [DEBUG] Stack trace:", error.stack);

    // Limpiar cache en caso de error de autenticación
    if (
      error.message.includes("alreadyAuthenticated") ||
      error.message.includes("no autorizado")
    ) {
      console.log("🔄 Limpiando cache debido a error de autenticación...");
      const { clearCache } = await import("./token-cache.js");
      clearCache();
    }

    throw error;
  }
}

function generarTRA(service) {
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
  try {
    console.log("🔐 Iniciando firma CMS...");

    // ✅ Mismo formateo agresivo para node-forge
    const formatCertificate = (cert) => {
      if (!cert) return cert;

      const base64Content = cert
        .replace(/-----BEGIN CERTIFICATE-----/g, "")
        .replace(/-----END CERTIFICATE-----/g, "")
        .trim();
      return `-----BEGIN CERTIFICATE-----\n${base64Content}\n-----END CERTIFICATE-----`;
    };

    const certFormatted = formatCertificate(certPem);
    const keyFormatted = keyPem;

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, "utf8");

    console.log("🔐 Cargando certificado PEM...");
    const certificate = forge.pki.certificateFromPem(certFormatted);
    p7.addCertificate(certificate);

    console.log("🔐 Cargando clave privada PEM...");
    const privateKey = forge.pki.privateKeyFromPem(keyFormatted);

    p7.addSigner({
      key: privateKey,
      certificate: certificate,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });

    console.log("🔐 Firmando CMS...");
    p7.sign();

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const cmsBase64 = Buffer.from(der, "binary").toString("base64");

    console.log(
      `✅ CMS firmado exitosamente - Longitud: ${cmsBase64.length} chars`
    );
    return cmsBase64;
  } catch (error) {
    console.error("❌ Error en firmarTRA:", error.message);
    throw new Error(`Error firmando TRA: ${error.message}`);
  }
}

async function enviarWSAA(cmsBase64, wsaaUrl, certPem, keyPem) {
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
    console.log("🌐 [WSAA] Preparando solicitud a WSAA...");
    console.log("🔍 [DEBUG WSAA] URL:", wsaaUrl);
    console.log(
      "🔍 [DEBUG WSAA] CMS (primeros 200 chars):",
      cmsBase64.substring(0, 200)
    );
    console.log(
      "🔍 [DEBUG WSAA] SOAP Body (primeros 500 chars):",
      soapBody.substring(0, 500)
    );

    // Crear agente HTTPS con certificados
    const httpsAgent = createHttpsAgent(certPem, keyPem);

    const response = await axios.post(wsaaUrl, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      httpsAgent,
      timeout: 20000,
    });

    console.log(
      `✅ [WSAA] Respuesta recibida de WSAA - Status: ${response.status}`
    );
    console.log(
      "🔍 [DEBUG WSAA] Respuesta (primeros 500 chars):",
      response.data.substring(0, 500)
    );
    return response.data;
  } catch (error) {
    console.error("❌ [WSAA] Error en enviarWSAA:", error.message);

    if (error.code) {
      console.error(`❌ [WSAA] Error code: ${error.code}`);
    }

    if (error.response) {
      console.error(`❌ [WSAA] Response status: ${error.response.status}`);
      console.error(`❌ [WSAA] Response data: ${error.response.data}`);
    }

    if (error.response?.data?.includes("alreadyAuthenticated")) {
      console.log("⚠️ WSAA rechazó por token existente, limpiando cache...");
      const { clearCache } = await import("./token-cache.js");
      clearCache();
      throw new Error("AFIP rechazó la solicitud: ya existe un token activo.");
    }

    // Manejar errores específicos de AFIP
    if (error.response?.data) {
      const errorData = error.response.data;
      if (errorData.includes("Computador no autorizado")) {
        throw new Error(
          "AFIP: Computador no autorizado - Verifique que el certificado esté autorizado para el servicio"
        );
      }
      if (errorData.includes("coe.notAuthorized")) {
        throw new Error(
          "AFIP: Servicio no autorizado - Verifique los permisos del certificado"
        );
      }
    }

    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    throw new Error("Error al enviar solicitud al WSAA: " + msg);
  }
}

function extraerLoginCmsReturn(wsaaResponseXml) {
  console.log("🔍 Extrayendo loginCmsReturn del XML de respuesta...");

  const match = wsaaResponseXml.match(
    /<loginCmsReturn>([^<]+)<\/loginCmsReturn>/
  );

  if (!match) {
    console.error("❌ No se encontró <loginCmsReturn> en respuesta WSAA");
    console.error("🔍 [DEBUG] Respuesta completa:", wsaaResponseXml);
    throw new Error("No se encontró <loginCmsReturn> en respuesta WSAA");
  }

  const decoded = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  console.log(`✅ loginCmsReturn extraído - Longitud: ${decoded.length} chars`);
  return decoded;
}

// Funciones de conveniencia para mantener compatibilidad

// Función original (mantener para compatibilidad)
export async function getToken(isProd = false) {
  return await getTokenFromWSAA(SERVICE_A4, isProd);
}

// Función específica para A4
export async function getTokenA4(isProd = false) {
  return await getTokenFromWSAA(SERVICE_A4, isProd);
}

// Función específica para A13
export async function getTokenA13(isProd = false) {
  return await getTokenFromWSAA(SERVICE_A13, isProd);
}

// Función genérica para cualquier servicio
export async function getTokenForService(service, isProd = false) {
  return await getTokenFromWSAA(service, isProd);
}

// Exportar constantes de servicios
export { SERVICE_A4, SERVICE_A13 };
