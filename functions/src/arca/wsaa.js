/**
 * wsaa.js - ACTUALIZADO CON SERVICIO DE CONSTANCIA DE INSCRIPCIÓN
 */

import forge from "node-forge";
import axios from "axios";
import https from "https";
import { parseStringPromise } from "xml2js";
import { getCachedToken, setCachedToken } from "./token-cache.js";

// Constantes para los servicios
const SERVICE_A4 = "ws_sr_padron_a4";
const SERVICE_A13 = "ws_sr_padron_a13";
const SERVICE_CONSTANCIA = "ws_sr_constancia_inscripcion"; // ✅ NUEVO SERVICIO

// URLs para WSAA según entorno
const URL_WSAA = (isProd = false) =>
  isProd
    ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
    : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

// Función para obtener secrets según entorno
function getSecretsForEnvironment(isProd = false) {
  if (isProd) {
    // Usar certificados específicos de producción
    const cert = process.env["arca-cert-prod"];
    const key = process.env["arca-key-prod"];
    const cuit = process.env["arca-cuit-prod"];

    console.log("🔐 [PROD] Usando certificados específicos de producción");
    console.log(`🔐 [PROD] Certificado: ${cert ? "PRESENTE" : "FALTA"}`);
    console.log(`🔐 [PROD] Clave: ${key ? "PRESENTE" : "FALTA"}`);
    console.log(`🔐 [PROD] CUIT: ${cuit ? "PRESENTE" : "FALTA"}`);

    return { cert, key, cuit };
  } else {
    // Usar certificados de homologación
    const cert = process.env.AFIP_CERT;
    const key = process.env.AFIP_KEY;
    const cuit = process.env["arca-cuit-prod"];

    console.log("🔐 [HOMO] Usando certificados de homologación");
    console.log(`🔐 [HOMO] Certificado: ${cert ? "PRESENTE" : "FALTA"}`);
    console.log(`🔐 [HOMO] Clave: ${key ? "PRESENTE" : "FALTA"}`);
    console.log(`🔐 [HOMO] CUIT: ${cuit ? "PRESENTE" : "FALTA"}`);

    return { cert, key, cuit };
  }
}

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

      // FORZAR el formateo - siempre agregar saltos de línea
      const base64Content = cert
        .replace(/-----BEGIN CERTIFICATE-----/g, "")
        .replace(/-----END CERTIFICATE-----/g, "")
        .trim();

      // Reconstruir con formato PEM CORRECTO
      const formatted = `-----BEGIN CERTIFICATE-----\n${base64Content}\n-----END CERTIFICATE-----`;

      return formatted;
    };

    const certFormatted = formatCertificate(certPem);
    const keyFormatted = keyPem;

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
    throw new Error(`Error configurando SSL: ${error.message}`);
  }
}

export async function getTokenFromWSAA(service = SERVICE_A4, isProd = false) {
  const MODE = isProd ? "PROD" : "HOMO";

  // Verificar cache primero - clave única por servicio y entorno
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

    // ✅ ACTUALIZADO: Obtener secrets específicos por entorno
    const { cert, key, cuit } = getSecretsForEnvironment(isProd);

    // Limpiar formatos
    const certClean = cert?.replace(/\r\n/g, "\n").trim();
    const keyClean = key?.replace(/\r\n/g, "\n").trim();
    const cuitClean = cuit?.replace(/\r\n/g, "").trim();

    console.log(
      `✅ [${MODE}] Secrets cargados - Cert: ${
        certClean?.length || 0
      } chars, Key: ${keyClean?.length || 0} chars, CUIT: ${
        cuitClean ? "PRESENTE" : "FALTA"
      }`
    );

    // DEBUG DETALLADO de certificados
    if (certClean) {
      console.log(`🔍 [${MODE}] === INICIO CERTIFICADO ===`);
      console.log(certClean.substring(0, 200) + "...");
      console.log(`🔍 [${MODE}] === FIN CERTIFICADO ===`);
    }

    // Validaciones críticas
    if (!cuitClean) {
      throw new Error(
        `No se pudo cargar el CUIT desde environment variables para ${MODE}`
      );
    }

    if (!certClean || !keyClean) {
      throw new Error(
        `No se pudieron cargar los certificados desde environment variables para ${MODE}. ` +
          `Certificado: ${certClean ? "PRESENTE" : "FALTA"}, Clave: ${
            keyClean ? "PRESENTE" : "FALTA"
          }`
      );
    }

    // Validaciones de formato PEM
    if (!certClean.startsWith("-----BEGIN CERTIFICATE-----")) {
      throw new Error(
        `Formato de certificado incorrecto para ${MODE} - debe empezar con '-----BEGIN CERTIFICATE-----'`
      );
    }

    if (!certClean.endsWith("-----END CERTIFICATE-----")) {
      throw new Error(
        `Formato de certificado incorrecto para ${MODE} - debe terminar con '-----END CERTIFICATE-----'`
      );
    }

    if (
      !keyClean.startsWith("-----BEGIN") ||
      !keyClean.includes("PRIVATE KEY-----")
    ) {
      throw new Error(`Formato de clave privada incorrecto para ${MODE}`);
    }

    console.log(`🔑 [${MODE}] Generando TRA para servicio: ${service}`);
    const tra = generarTRA(service);

    console.log(`✍️ [${MODE}] Firmando CMS...`);
    const cms = firmarTRA(tra, certClean, keyClean);

    const wsaaUrl = URL_WSAA(isProd);
    console.log(`🚀 [${MODE}] Enviando a WSAA: ${wsaaUrl}`);
    const wsaaResponse = await enviarWSAA(
      cms,
      wsaaUrl,
      certClean,
      keyClean,
      MODE
    );

    console.log("🔍 [DEBUG] Respuesta WSAA recibida");
    const loginCmsReturnXml = extraerLoginCmsReturn(wsaaResponse);

    const parsed = await parseStringPromise(loginCmsReturnXml, {
      explicitArray: false,
    });

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
      cuitRepresentada: cuitClean,
      service: service,
      environment: MODE,
    };

    // Guardar en cache con clave específica del servicio y entorno
    setCachedToken(tokenData, cacheKey);

    console.log(`✅ [${MODE}] Token generado exitosamente para ${service}`);
    console.log(`⏰ Válido hasta: ${expiration.toISOString()}`);

    return tokenData;
  } catch (error) {
    console.error(
      `❌ [${MODE}] Error en getTokenFromWSAA para ${service}:`,
      error.message
    );

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

async function enviarWSAA(cmsBase64, wsaaUrl, certPem, keyPem, mode = "HOMO") {
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
    console.log(`🌐 [WSAA ${mode}] Preparando solicitud a WSAA...`);
    console.log(`🔍 [DEBUG WSAA ${mode}] URL: ${wsaaUrl}`);

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
      `✅ [WSAA ${mode}] Respuesta recibida de WSAA - Status: ${response.status}`
    );
    return response.data;
  } catch (error) {
    console.error(`❌ [WSAA ${mode}] Error en enviarWSAA:`, error.message);

    if (error.code) {
      console.error(`❌ [WSAA ${mode}] Error code: ${error.code}`);
    }

    if (error.response) {
      console.error(
        `❌ [WSAA ${mode}] Response status: ${error.response.status}`
      );
      console.error(`❌ [WSAA ${mode}] Response data: ${error.response.data}`);
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
      if (errorData.includes("Certificate")) {
        throw new Error(
          "AFIP: Error de certificado - Verifique que el certificado sea válido para este entorno"
        );
      }
    }

    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    throw new Error(`Error al enviar solicitud al WSAA (${mode}): ` + msg);
  }
}

function extraerLoginCmsReturn(wsaaResponseXml) {
  console.log("🔍 Extrayendo loginCmsReturn del XML de respuesta...");

  const match = wsaaResponseXml.match(
    /<loginCmsReturn>([^<]+)<\/loginCmsReturn>/
  );

  if (!match) {
    console.error("❌ No se encontró <loginCmsReturn> en respuesta WSAA");
    throw new Error("No se encontró <loginCmsReturn> en respuesta WSAA");
  }

  const decoded = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  console.log(`✅ loginCmsReturn extraído - Longitud: ${decoded.length} chars`);
  return decoded;
}

// ==================== FUNCIONES DE CONVENIENCIA ====================

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

// ✅ NUEVA: Función específica para Constancia de Inscripción
export async function getTokenConstancia(isProd = false) {
  return await getTokenFromWSAA(SERVICE_CONSTANCIA, isProd);
}

// Función genérica para cualquier servicio
export async function getTokenForService(service, isProd = false) {
  return await getTokenFromWSAA(service, isProd);
}

// Exportar constantes de servicios
export {
  SERVICE_A4,
  SERVICE_A13,
  SERVICE_CONSTANCIA,
  URL_WSAA,
};
