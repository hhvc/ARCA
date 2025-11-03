/* eslint-env node */
import axios from "axios";
import { getTokenFromWSAA } from "./wsaa.js";

const PADRON_WSDL =
  (process.env.MODE || "HOMO") === "PROD"
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4";

/**
 * Llama al método dummy del servicio WS_SR_PADRON_A4
 * Incluye diagnóstico detallado para detectar fallos en AFIP o WSAA.
 */
export async function callPadronDummy(secrets) {
  console.log("🧩 [callPadronDummy] Inicio");
  const start = Date.now();

  try {
    // === 1️⃣ Validar secretos básicos ===
    console.log("🔍 Secretos recibidos:");
    console.log("  • CERT:", secrets.cert ? "OK" : "FALTANTE");
    console.log("  • KEY:", secrets.key ? "OK" : "FALTANTE");
    console.log("  • CUIT:", secrets.cuit || "N/D");

    // === 2️⃣ Validar WSAA ===
    console.log("🚀 Probando conexión WSAA (getTokenFromWSAA)...");
    const tokenStart = Date.now();
    try {
      const tokenResult = await getTokenFromWSAA("ws_sr_padron_a4", secrets);
      console.log(
        `✅ WSAA respondió OK en ${(Date.now() - tokenStart) / 1000}s`
      );
      if (!tokenResult?.token) {
        console.warn("⚠️ WSAA no devolvió token válido");
      }
    } catch (wsaaError) {
      console.error("❌ Error al invocar WSAA:", wsaaError.message);
      throw new Error(`Error al invocar WSAA: ${wsaaError.message}`);
    }

    // === 3️⃣ Preparar solicitud SOAP ===
    console.log("🧾 Preparando solicitud SOAP dummy...");
    const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                        xmlns:a4="http://a4.soap.ws.server.puc.sr/">
        <soapenv:Header/>
        <soapenv:Body>
          <a4:dummy/>
        </soapenv:Body>
      </soapenv:Envelope>`;

    console.log("🌐 URL destino:", PADRON_WSDL);

    // === 4️⃣ Ejecutar POST hacia AFIP ===
    const sendStart = Date.now();
    let response;
    try {
      response = await axios.post(PADRON_WSDL, soapRequest, {
        headers: {
          "Content-Type": "text/xml;charset=UTF-8",
          SOAPAction: "",
        },
        timeout: 25000,
        validateStatus: () => true, // no tirar error por 500
      });
    } catch (axiosErr) {
      console.error("💥 Axios lanzó excepción:", axiosErr.message);
      throw new Error(
        `Error de red o timeout hacia ${PADRON_WSDL}: ${axiosErr.message}`
      );
    }

    const duration = (Date.now() - sendStart) / 1000;
    console.log(`📡 Respuesta recibida en ${duration}s`);
    console.log("  • Código HTTP:", response.status);
    console.log("  • Longitud body:", response.data?.length || 0);

    if (response.status >= 400) {
      console.error("❌ Error HTTP desde AFIP:", response.status);
      throw new Error(`Respuesta HTTP ${response.status} desde AFIP`);
    }

    const data = response.data;
    console.log("🧩 Analizando XML...");

    const app = data.match(/<appserver>([^<]+)<\/appserver>/)?.[1];
    const auth = data.match(/<authserver>([^<]+)<\/authserver>/)?.[1];
    const db = data.match(/<dbserver>([^<]+)<\/dbserver>/)?.[1];

    const totalTime = (Date.now() - start) / 1000;
    console.log(
      `✅ Dummy exitoso (${totalTime}s) → app:${app}, auth:${auth}, db:${db}`
    );

    return {
      ok: true,
      appserver: app || "N/D",
      authserver: auth || "N/D",
      dbserver: db || "N/D",
    };
  } catch (err) {
    console.error("❌ [AFIP Dummy] Error capturado:", err);
    const totalTime = (Date.now() - start) / 1000;
    console.error(`⏱️ Tiempo total antes de fallar: ${totalTime}s`);
    return {
      ok: false,
      error: err.message || "Error desconocido en callPadronDummy",
    };
  }
}
