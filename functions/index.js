/**
 * index.js - Google Cloud Functions optimizado con token externo
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getPersonaData } from "./padron.js";
import { getTokenFromWSAA } from "./wsaa.js";

// Validación de environment variables
function validarConfiguracion() {
  const faltan = [];
  if (!process.env.AFIP_CERT) faltan.push("AFIP_CERT");
  if (!process.env.AFIP_KEY) faltan.push("AFIP_KEY");
  if (!process.env.AFIP_CUIT) faltan.push("AFIP_CUIT");
  return faltan;
}

function validarCUIT(cuit) {
  return cuit && /^\d{11}$/.test(cuit);
}

// === FUNCIÓN 1: Generar token AFIP ===
export const afipAuth = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      logger.info("🔑 Solicitud a /afipAuth");

      const faltan = validarConfiguracion();
      if (faltan.length > 0) {
        return res.status(500).json({
          ok: false,
          error: `Faltan configuraciones: ${faltan.join(", ")}`,
        });
      }

      const tokenData = await getTokenFromWSAA();

      res.status(200).json({
        ok: true,
        token: tokenData.token,
        sign: tokenData.sign,
        expiration: tokenData.expiration,
      });
    } catch (error) {
      logger.error("❌ ERROR en /afipAuth:", error);
      res.status(500).json({
        ok: false,
        error: error.message || "Error interno en autenticación AFIP",
      });
    }
  }
);

// === FUNCIÓN 2: Consulta padrón AFIP (usa token interno) ===
export const afipPadron = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      const { cuit } = req.query;

      if (!validarCUIT(cuit)) {
        return res.status(400).json({
          ok: false,
          error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
        });
      }

      const faltan = validarConfiguracion();
      if (faltan.length > 0) {
        return res.status(500).json({
          ok: false,
          error: `Faltan configuraciones: ${faltan.join(", ")}`,
        });
      }

      const tokenData = await getTokenFromWSAA();
      const persona = await getPersonaData(cuit, {
        token: tokenData.token,
        sign: tokenData.sign,
        cuit: process.env.AFIP_CUIT,
      });

      res.status(200).json({
        ok: true,
        persona,
        consulta: { cuit, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error("❌ ERROR en /afipPadron:", error);

      if (
        error.message.includes("alreadyAuthenticated") ||
        error.message.includes("ya existe")
      ) {
        return res.status(429).json({
          ok: false,
          error:
            "Ya existe un token AFIP activo. Use el método con token externo (/afipPadronWithToken) o espere 5-10 minutos.",
          solution:
            "Obtenga un token en /afipAuth y úselo en /afipPadronWithToken",
        });
      }

      res.status(500).json({
        ok: false,
        error: error.message || "Error interno en consulta AFIP",
        cuit: req.query.cuit,
      });
    }
  }
);

// === FUNCIÓN 3: Consulta padrón con token externo (CON SECRETS CONFIGURADOS) ===
export const afipPadronWithToken = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "AFIP_CUIT", "MODE"],
    cors: true,
  },
  async (req, res) => {
    try {
      const { cuit, token, sign } = req.query;

      if (!validarCUIT(cuit)) {
        return res.status(400).json({
          ok: false,
          error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
        });
      }

      if (!token || !sign) {
        return res.status(400).json({
          ok: false,
          error: "Se requieren token y sign. Obténgalos desde /afipAuth",
        });
      }

      const faltan = validarConfiguracion();
      if (faltan.length > 0) {
        console.error("❌ Faltan configuraciones:", faltan);
        return res.status(500).json({
          ok: false,
          error: `Faltan configuraciones: ${faltan.join(", ")}`,
        });
      }

      console.log("✅ Usando token proporcionado para consulta");

      const persona = await getPersonaData(cuit, {
        token: token,
        sign: sign,
        cuit: process.env.AFIP_CUIT,
      });

      res.status(200).json({
        ok: true,
        persona,
        consulta: {
          cuit,
          timestamp: new Date().toISOString(),
          method: "withToken",
        },
      });
    } catch (error) {
      logger.error("❌ ERROR en /afipPadronWithToken:", error);
      res.status(500).json({
        ok: false,
        error: error.message || "Error interno en consulta AFIP",
        cuit: req.query.cuit,
      });
    }
  }
);

// === FUNCIÓN DEBUG: Verificar secrets ===
export const debugSecrets = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "AFIP_CUIT", "MODE"],
    cors: true,
  },
  async (req, res) => {
    try {
      const secretsInfo = {
        AFIP_CERT: process.env.AFIP_CERT
          ? `✅ PRESENTE (${process.env.AFIP_CERT.length} caracteres)`
          : "❌ FALTA",
        AFIP_KEY: process.env.AFIP_KEY
          ? `✅ PRESENTE (${process.env.AFIP_KEY.length} caracteres)`
          : "❌ FALTA",
        AFIP_CUIT: process.env.AFIP_CUIT
          ? `✅ PRESENTE (${process.env.AFIP_CUIT})`
          : "❌ FALTA",
        MODE: process.env.MODE
          ? `✅ PRESENTE (${process.env.MODE})`
          : "❌ FALTA",
      };

      console.log("🔍 DEBUG Secrets Info:", secretsInfo);
      res.status(200).json(secretsInfo);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);
