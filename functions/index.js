/**
 * === Firebase Functions (Node 22 + ESM) ===
 * Backend ARCA Dashboard - Integración AFIP WSAA + WS_SR_PADRON_A4 (2025)
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import cors from "cors";
import { getTokenFromWSAA } from "./wsaa.js";
import { getPersonaData } from "./padron.js";
import axios from "axios";

// =====================================================
// === CONFIGURACIÓN GLOBAL ===
// =====================================================

const corsHandler = cors({ origin: true });

function validarSecretos() {
  const faltan = [];
  if (!process.env.AFIP_CERT) faltan.push("AFIP_CERT");
  if (!process.env.AFIP_KEY) faltan.push("AFIP_KEY");
  if (!process.env.AFIP_CUIT) faltan.push("AFIP_CUIT");
  return faltan;
}

// =====================================================
// === FUNCIÓN 1: Autenticación WSAA (token + sign) ===
// =====================================================
export const afipAuth = onRequest(async (req, res) => {
  console.log("➡️ [afipAuth] Inicio de solicitud");
  corsHandler(req, res, async () => {
    logger.info("➡️ Solicitud a /afipAuth", { method: req.method });

    try {
      console.log("🔍 Validando secretos...");
      const faltan = validarSecretos();
      if (faltan.length > 0) {
        logger.error("❌ Faltan secretos AFIP:", faltan);
        return res.status(500).json({
          ok: false,
          error: `Faltan secretos: ${faltan.join(", ")}`,
        });
      }

      const mode = process.env.MODE || "HOMO";
      const wsaaUrl =
        mode === "PROD"
          ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
          : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

      console.log("🌐 WSAA URL:", wsaaUrl);
      const result = await getTokenFromWSAA("ws_sr_padron_a4", {
        cert: process.env.AFIP_CERT,
        key: process.env.AFIP_KEY,
        cuit: process.env.AFIP_CUIT,
      });

      logger.info("✅ Token WSAA obtenido correctamente", {
        ambiente: mode,
        wsaaUrl,
      });

      res.status(200).json({
        ok: true,
        ambiente: mode,
        wsaaUrl,
        token: result.token,
        sign: result.sign,
      });
    } catch (error) {
      console.error("❌ ERROR EN /afipAuth:", error);
      res.status(500).json({
        ok: false,
        error: error.message || "Error interno en afipAuth",
      });
    }
  });
});

// ==================================================
// === FUNCIÓN 2: Consulta WS_SR_PADRON_A4 (AFIP) ===
// ==================================================
export const afipPadron = onRequest(async (req, res) => {
  console.log("➡️ [afipPadron] Inicio de solicitud");
  corsHandler(req, res, async () => {
    logger.info("➡️ Solicitud a /afipPadron", { query: req.query });

    try {
      const { cuit } = req.query;
      if (!cuit) {
        return res
          .status(400)
          .json({ ok: false, error: "Falta el parámetro ?cuit=" });
      }

      const faltan = validarSecretos();
      if (faltan.length > 0) {
        return res.status(500).json({
          ok: false,
          error: `Faltan secretos: ${faltan.join(", ")}`,
        });
      }

      const mode = process.env.MODE || "HOMO";
      const persona = await getPersonaData(cuit, {
        cert: process.env.AFIP_CERT,
        key: process.env.AFIP_KEY,
        cuit: process.env.AFIP_CUIT,
      });

      res.status(200).json({
        ok: true,
        ambiente: mode,
        persona,
      });
    } catch (error) {
      console.error("❌ ERROR EN /afipPadron:", error);
      res.status(500).json({
        ok: false,
        error: error.message || "Error interno en afipPadron",
      });
    }
  });
});

// =====================================================
// === FUNCIÓN 3: Dummy WS_SR_PADRON_A4 (Real Test) ====
// =====================================================
export const afipPadronDummy = onRequest(async (req, res) => {
  console.log("➡️ [afipPadronDummy] Inicio de prueba real WSAA + PADRÓN");
  corsHandler(req, res, async () => {
    try {
      const faltan = validarSecretos();
      if (faltan.length > 0) {
        return res.status(500).json({
          ok: false,
          error: `Faltan secretos: ${faltan.join(", ")}`,
        });
      }

      const mode = process.env.MODE || "HOMO";
      console.log("🌐 Ambiente:", mode);

      const { token, sign } = await getTokenFromWSAA("ws_sr_padron_a4", {
        cert: process.env.AFIP_CERT,
        key: process.env.AFIP_KEY,
        cuit: process.env.AFIP_CUIT,
      });

      const cuitConsultado = req.query.cuit || "20300000000"; // Dummy CUIT
      const PADRON_URL =
        mode === "PROD"
          ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4"
          : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4";

      const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gob.afip.dif.fecsr.padron/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:getPersona>
      <ar:token>${token}</ar:token>
      <ar:sign>${sign}</ar:sign>
      <ar:cuitRepresentada>${process.env.AFIP_CUIT}</ar:cuitRepresentada>
      <ar:idPersona>${cuitConsultado}</ar:idPersona>
    </ar:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;

      const response = await axios.post(PADRON_URL, soapRequest, {
        headers: {
          "Content-Type": "text/xml;charset=UTF-8",
        },
        timeout: 20000,
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status} desde PADRON`);
      }

      const xml2js = (await import("xml2js")).default;
      const parsed = await xml2js.parseStringPromise(response.data, {
        explicitArray: false,
      });

      const personaReturn =
        parsed["soapenv:Envelope"]["soapenv:Body"]["ar:getPersonaResponse"][
          "ar:personaReturn"
        ];

      res.status(200).json({
        ok: true,
        ambiente: mode,
        persona: personaReturn || "Sin datos",
      });
    } catch (err) {
      console.error("❌ Error en /afipPadronDummy:", err);
      res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  });
});
