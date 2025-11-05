/**
 * index.js - Google Cloud Functions (Node 22 + ESM)
 * Backend ARCA Dashboard - Integración AFIP WSAA + WS_SR_PADRON_A4 (Producción)
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import cors from "cors";
import axios from "axios";
import { getPersonaData } from "./padron.js"; // tu función existente
import {
  generarTokenPersistente,
  leerTokenPersistente,
} from "./production-token-json.js"; // token persistente

console.log("🧾 [ENV CHECK]", {
  AFIP_CERT: process.env.AFIP_CERT ? "✅ presente" : "❌ falta",
  AFIP_KEY: process.env.AFIP_KEY ? "✅ presente" : "❌ falta",
  AFIP_CUIT: process.env.AFIP_CUIT || "❌ falta",
  MODE: process.env.MODE || "❌ falta",
});

// =====================================================
// === CONFIGURACIÓN GLOBAL ===
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
export const afipAuth = onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    try {
      logger.info("➡️ Solicitud a /afipAuth");

      const faltan = validarSecretos();
      if (faltan.length > 0) {
        logger.error("❌ Faltan secretos AFIP:", faltan);
        return res
          .status(500)
          .json({ ok: false, error: `Faltan secretos: ${faltan.join(", ")}` });
      }

      let tokenData = leerTokenPersistente();
      if (!tokenData) {
        tokenData = await generarTokenPersistente();
        logger.info("💾 Token persistente generado y guardado");
      } else {
        logger.info("✅ Token persistente válido leído desde JSON");
      }

      res.status(200).json({
        ok: true,
        token: tokenData.token,
        sign: tokenData.sign,
        expiration: tokenData.expiration,
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
export const afipPadron = onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    try {
      const { cuit } = req.query;
      if (!cuit) {
        return res
          .status(400)
          .json({ ok: false, error: "Falta el parámetro ?cuit=" });
      }

      const faltan = validarSecretos();
      if (faltan.length > 0) {
        return res
          .status(500)
          .json({ ok: false, error: `Faltan secretos: ${faltan.join(", ")}` });
      }

      let tokenData = leerTokenPersistente();
      if (!tokenData) {
        tokenData = await generarTokenPersistente();
        logger.info("💾 Token persistente generado y guardado");
      }

      const persona = await getPersonaData(cuit, {
        token: tokenData.token,
        sign: tokenData.sign,
        cuit: process.env.AFIP_CUIT,
      });

      res.status(200).json({ ok: true, persona });
    } catch (error) {
      console.error("❌ ERROR EN /afipPadron:", error);
      res
        .status(500)
        .json({ ok: false, error: error.message || "Error interno" });
    }
  });
});

// =====================================================
// === FUNCIÓN 3: Dummy WS_SR_PADRON_A4 (Prueba real) ===
export const afipPadronDummy = onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    try {
      const faltan = validarSecretos();
      if (faltan.length > 0) {
        return res
          .status(500)
          .json({ ok: false, error: `Faltan secretos: ${faltan.join(", ")}` });
      }

      let tokenData = leerTokenPersistente();
      if (!tokenData) {
        tokenData = await generarTokenPersistente();
        logger.info("💾 Token persistente generado y guardado");
      }

      const cuitConsultado = req.query.cuit || "20300000000"; // Dummy CUIT
      const PADRON_URL =
        process.env.MODE === "PROD"
          ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4"
          : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4";

      const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gob.afip.dif.fecsr.padron/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:getPersona>
      <ar:token>${tokenData.token}</ar:token>
      <ar:sign>${tokenData.sign}</ar:sign>
      <ar:cuitRepresentada>${process.env.AFIP_CUIT}</ar:cuitRepresentada>
      <ar:idPersona>${cuitConsultado}</ar:idPersona>
    </ar:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;

      const response = await axios.post(PADRON_URL, soapRequest, {
        headers: { "Content-Type": "text/xml;charset=UTF-8" },
        timeout: 20000,
      });

      const xml2js = (await import("xml2js")).default;
      const parsed = await xml2js.parseStringPromise(response.data, {
        explicitArray: false,
      });

      const personaReturn =
        parsed["soapenv:Envelope"]["soapenv:Body"]["ar:getPersonaResponse"]?.[
          "ar:personaReturn"
        ] || "Sin datos";

      res.status(200).json({ ok: true, persona: personaReturn });
    } catch (error) {
      console.error("❌ ERROR EN /afipPadronDummy:", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });
});

// For Firebase Emulator (ESM compatibility)
export default { afipAuth, afipPadron, afipPadronDummy };
