/**
 * index.js - Versión corregida con secrets actualizados
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getPersonaData } from "./arca/padron-a4.js";
import { getPersonaDataA13 } from "./arca/padron-a13.js";
import { getToken, getTokenA13 } from "./arca/wsaa.js";

// Determinar entorno
const IS_PROD = false; // Por ahora forzamos HOMOLOGACIÓN

function validarCUIT(cuit) {
  return cuit && /^\d{11}$/.test(cuit);
}

// Handler CORS manual para mayor control
const handleCors = (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept"
  );

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  next();
};

// ==================== PADRÓN A4 ====================

// === FUNCIÓN 1: Generar token AFIP para A4 ===
export const afipAuth = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        logger.info(
          `🔑 [${IS_PROD ? "PROD" : "HOMO"}] Solicitud a /afipAuth (A4)`
        );

        const tokenData = await getToken(IS_PROD);

        res.status(200).json({
          ok: true,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          token: tokenData.token,
          sign: tokenData.sign,
          expiration: tokenData.expiration,
        });
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en /afipAuth:`,
          error
        );
        res.status(500).json({
          ok: false,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          error: error.message || "Error interno en autenticación AFIP A4",
        });
      }
    });
  }
);

// === FUNCIÓN 2: Consulta padrón AFIP A4 (usa token interno) ===
export const afipPadron = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const { cuit } = req.query;

        if (!validarCUIT(cuit)) {
          return res.status(400).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
          });
        }

        logger.info(
          `🔍 [${
            IS_PROD ? "PROD" : "HOMO"
          }] Consultando padrón A4 para CUIT: ${cuit}`
        );

        const tokenData = await getToken(IS_PROD);

        const persona = await getPersonaData(
          cuit,
          {
            token: tokenData.token,
            sign: tokenData.sign,
            cuit: tokenData.cuitRepresentada,
          },
          IS_PROD
        );

        res.status(200).json({
          ok: true,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          persona,
          consulta: {
            cuit,
            timestamp: new Date().toISOString(),
            mode: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          },
        });
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en /afipPadron:`,
          error
        );

        if (
          error.message.includes("alreadyAuthenticated") ||
          error.message.includes("ya existe")
        ) {
          return res.status(429).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error:
              "Ya existe un token AFIP activo. Use el método con token externo (/afipPadronWithToken) o espere 5-10 minutos.",
            solution:
              "Obtenga un token en /afipAuth y úselo en /afipPadronWithToken",
          });
        }

        res.status(500).json({
          ok: false,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          error: error.message || "Error interno en consulta AFIP A4",
          cuit: req.query.cuit,
        });
      }
    });
  }
);

// === FUNCIÓN 3: Consulta padrón A4 con token externo ===
export const afipPadronWithToken = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const { cuit, token, sign } = req.query;

        if (!validarCUIT(cuit)) {
          return res.status(400).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
          });
        }

        if (!token || !sign) {
          return res.status(400).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error: "Se requieren token y sign. Obténgalos desde /afipAuth",
          });
        }

        logger.info(
          `🔍 [${
            IS_PROD ? "PROD" : "HOMO"
          }] Consulta A4 con token externo para CUIT: ${cuit}`
        );

        // ✅ CORREGIDO: No llamar a getToken(), usar directamente el CUIT del environment
        const cuitRepresentada = process.env["arca-cuit-prod"]
          ?.replace(/\r\n/g, "")
          .trim();

        if (!cuitRepresentada) {
          throw new Error(
            "No se pudo cargar el CUIT representada desde environment variables"
          );
        }

        const persona = await getPersonaData(
          cuit,
          {
            token: token,
            sign: sign,
            cuit: cuitRepresentada,
          },
          IS_PROD
        );

        res.status(200).json({
          ok: true,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          persona,
          consulta: {
            cuit,
            timestamp: new Date().toISOString(),
            method: "withToken",
            mode: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          },
        });
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en /afipPadronWithToken:`,
          error
        );
        res.status(500).json({
          ok: false,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          error: error.message || "Error interno en consulta AFIP A4",
          cuit: req.query.cuit,
        });
      }
    });
  }
);

// ==================== PADRÓN A13 ====================

// === FUNCIÓN 4: Generar token AFIP para A13 ===
export const afipAuthA13 = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        logger.info(
          `🔑 [${IS_PROD ? "PROD" : "HOMO"}] Solicitud a /afipAuthA13`
        );

        // ✅ CORREGIDO: Llamar a getTokenA13 para obtener el token
        const tokenData = await getTokenA13(IS_PROD);

        res.status(200).json({
          ok: true,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a13",
          token: tokenData.token,
          sign: tokenData.sign,
          expiration: tokenData.expiration,
        });
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en /afipAuthA13:`,
          error
        );
        res.status(500).json({
          ok: false,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a13",
          error: error.message || "Error interno en autenticación AFIP A13",
        });
      }
    });
  }
);

// === FUNCIÓN 5: Consulta padrón AFIP A13 (usa token interno) ===
export const afipPadronA13 = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const { cuit } = req.query;

        if (!validarCUIT(cuit)) {
          return res.status(400).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a13",
            error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
          });
        }

        logger.info(
          `🔍 [${
            IS_PROD ? "PROD" : "HOMO"
          }] Consultando padrón A13 para CUIT: ${cuit}`
        );

        const tokenData = await getTokenA13(IS_PROD);

        const persona = await getPersonaDataA13(
          cuit,
          {
            token: tokenData.token,
            sign: tokenData.sign,
            cuit: tokenData.cuitRepresentada,
          },
          IS_PROD
        );

        res.status(200).json({
          ok: true,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a13",
          persona,
          consulta: {
            cuit,
            timestamp: new Date().toISOString(),
            mode: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          },
        });
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en /afipPadronA13:`,
          error
        );

        if (
          error.message.includes("alreadyAuthenticated") ||
          error.message.includes("ya existe")
        ) {
          return res.status(429).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a13",
            error:
              "Ya existe un token AFIP activo. Use el método con token externo (/afipPadronWithTokenA13) o espere 5-10 minutos.",
            solution:
              "Obtenga un token en /afipAuthA13 y úselo en /afipPadronWithTokenA13",
          });
        }

        res.status(500).json({
          ok: false,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a13",
          error: error.message || "Error interno en consulta AFIP A13",
          cuit: req.query.cuit,
        });
      }
    });
  }
);

// === FUNCIÓN 6: Consulta padrón A13 con token externo ===
export const afipPadronWithTokenA13 = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const { cuit, token, sign } = req.query;

        if (!validarCUIT(cuit)) {
          return res.status(400).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a13",
            error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
          });
        }

        if (!token || !sign) {
          return res.status(400).json({
            ok: false,
            environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
            service: "ws_sr_padron_a13",
            error: "Se requieren token y sign. Obténgalos desde /afipAuthA13",
          });
        }

        logger.info(
          `🔍 [${
            IS_PROD ? "PROD" : "HOMO"
          }] Consulta A13 con token externo para CUIT: ${cuit}`
        );

        // ✅ CORREGIDO: Obtener el CUIT directamente del environment, sin llamar a getTokenA13
        const cuitRepresentada = process.env["arca-cuit-prod"]
          ?.replace(/\r\n/g, "")
          .trim();

        if (!cuitRepresentada) {
          throw new Error(
            "No se pudo cargar el CUIT representada desde environment variables"
          );
        }

        const persona = await getPersonaDataA13(
          cuit,
          {
            token: token,
            sign: sign,
            cuit: cuitRepresentada,
          },
          IS_PROD
        );

        res.status(200).json({
          ok: true,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a13",
          persona,
          consulta: {
            cuit,
            timestamp: new Date().toISOString(),
            method: "withToken",
            mode: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          },
        });
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en /afipPadronWithTokenA13:`,
          error
        );
        res.status(500).json({
          ok: false,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ws_sr_padron_a13",
          error: error.message || "Error interno en consulta AFIP A13",
          cuit: req.query.cuit,
        });
      }
    });
  }
);

// ==================== UTILIDADES ====================

// === FUNCIÓN 7: Health Check ===
export const healthCheck = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const healthInfo = {
          status: "online",
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          service: "ARCA API - AFIP Integration",
          timestamp: new Date().toISOString(),
          endpoints: {
            a4: {
              auth: "/afipAuth",
              padron: "/afipPadron",
              padronWithToken: "/afipPadronWithToken",
            },
            a13: {
              auth: "/afipAuthA13",
              padron: "/afipPadronA13",
              padronWithToken: "/afipPadronWithTokenA13",
            },
            utils: {
              health: "/healthCheck",
              debug: "/debugInfo",
            },
          },
        };

        console.log(`🔍 [${IS_PROD ? "PROD" : "HOMO"}] Health check OK`);
        res.status(200).json(healthInfo);
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en health check:`,
          error
        );
        res.status(500).json({
          status: "error",
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          error: error.message,
        });
      }
    });
  }
);

// === FUNCIÓN 8: Debug Info ===
export const debugInfo = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const debugInfo = {
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          nodeVersion: process.version,
          region: process.env.FUNCTION_REGION || "us-central1",
          services: {
            a4: "ws_sr_padron_a4",
            a13: "ws_sr_padron_a13",
          },
          config: "Optimizado - Soporte completo A4 y A13",
        };

        console.log(`🔍 [${IS_PROD ? "PROD" : "HOMO"}] Debug info solicitada`);
        res.status(200).json(debugInfo);
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en debug info:`,
          error
        );
        res.status(500).json({
          error: error.message,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
        });
      }
    });
  }
);

// === FUNCIÓN 9: Status de Servicios ===
export const servicesStatus = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const statusInfo = {
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          timestamp: new Date().toISOString(),
          services: {
            a4: {
              name: "Padrón A4",
              service: "ws_sr_padron_a4",
              status: "available",
              description: "Consulta completa de datos del contribuyente",
            },
            a13: {
              name: "Padrón A13",
              service: "ws_sr_padron_a13",
              status: "available",
              description: "Consulta básica de datos del contribuyente",
            },
          },
          notes: "A13 actualmente autorizado en AFIP",
        };

        console.log(
          `🔍 [${IS_PROD ? "PROD" : "HOMO"}] Services status consultado`
        );
        res.status(200).json(statusInfo);
      } catch (error) {
        logger.error(
          `❌ [${IS_PROD ? "PROD" : "HOMO"}] ERROR en services status:`,
          error
        );
        res.status(500).json({
          error: error.message,
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
        });
      }
    });
  }
);

// === FUNCIÓN 10: Debug de Secrets (útil para verificar) ===
export const debugSecrets = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      try {
        const secretsInfo = {
          AFIP_CERT: process.env.AFIP_CERT
            ? `✅ PRESENTE (${process.env.AFIP_CERT.length} caracteres)`
            : "❌ FALTA",
          AFIP_KEY: process.env.AFIP_KEY
            ? `✅ PRESENTE (${process.env.AFIP_KEY.length} caracteres)`
            : "❌ FALTA",
          "arca-cuit-prod": process.env["arca-cuit-prod"]
            ? `✅ PRESENTE (${process.env["arca-cuit-prod"]})`
            : "❌ FALTA",
          MODE: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
        };

        console.log("🔍 DEBUG Secrets Info:", secretsInfo);
        res.status(200).json(secretsInfo);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }
);
