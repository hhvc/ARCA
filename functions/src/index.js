/**
 * index.js - VERSIÓN ESTABLE - A4 SIEMPRE EN HOMOLOGACIÓN
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getPersonaData } from "./arca/padron-a4.js";
import { getPersonaDataA13 } from "./arca/padron-a13.js";
import { getToken, getTokenA13 } from "./arca/wsaa.js";

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

// Función para determinar el entorno basado en parámetros
const getEnvironment = (req) => {
  // Prioridad: query parameter > body parameter > default homo
  const environment = req.query.environment || req.body?.environment || "homo";
  const isProd = environment === "prod";

  console.log(
    `🌍 Entorno determinado: ${environment} -> ${
      isProd ? "PRODUCCIÓN" : "HOMOLOGACIÓN"
    }`
  );
  return isProd;
};

function validarCUIT(cuit) {
  return cuit && /^\d{11}$/.test(cuit);
}

// ==================== PADRÓN A4 ====================

// === FUNCIÓN 1: Generar token AFIP para A4 ===
export const afipAuth = onRequest(
  {
    secrets: ["AFIP_CERT", "AFIP_KEY", "arca-cuit-prod"],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      // ✅ A4 SIEMPRE en homologación
      const IS_PROD = false;

      try {
        logger.info("🔑 [HOMO] Solicitud a /afipAuth (A4)");

        const tokenData = await getToken(IS_PROD);

        res.status(200).json({
          ok: true,
          environment: "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          token: tokenData.token,
          sign: tokenData.sign,
          expiration: tokenData.expiration,
        });
      } catch (error) {
        logger.error("❌ [HOMO] ERROR en /afipAuth:", error);
        res.status(500).json({
          ok: false,
          environment: "HOMOLOGACIÓN",
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
      // ✅ A4 SIEMPRE en homologación
      const IS_PROD = false;

      try {
        const { cuit } = req.query;

        if (!validarCUIT(cuit)) {
          return res.status(400).json({
            ok: false,
            environment: "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
          });
        }

        logger.info(`🔍 [HOMO] Consultando padrón A4 para CUIT: ${cuit}`);

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
          environment: "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          persona,
          consulta: {
            cuit,
            timestamp: new Date().toISOString(),
            mode: "HOMOLOGACIÓN",
          },
        });
      } catch (error) {
        logger.error("❌ [HOMO] ERROR en /afipPadron:", error);

        if (
          error.message.includes("alreadyAuthenticated") ||
          error.message.includes("ya existe")
        ) {
          return res.status(429).json({
            ok: false,
            environment: "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error:
              "Ya existe un token AFIP activo. Use el método con token externo (/afipPadronWithToken) o espere 5-10 minutos.",
            solution:
              "Obtenga un token en /afipAuth y úselo en /afipPadronWithToken",
          });
        }

        res.status(500).json({
          ok: false,
          environment: "HOMOLOGACIÓN",
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
      // ✅ A4 SIEMPRE en homologación
      const IS_PROD = false;

      try {
        const { cuit, token, sign } = req.query;

        if (!validarCUIT(cuit)) {
          return res.status(400).json({
            ok: false,
            environment: "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error: "CUIT inválido o faltante. Debe tener 11 dígitos.",
          });
        }

        if (!token || !sign) {
          return res.status(400).json({
            ok: false,
            environment: "HOMOLOGACIÓN",
            service: "ws_sr_padron_a4",
            error: "Se requieren token y sign. Obténgalos desde /afipAuth",
          });
        }

        logger.info(
          `🔍 [HOMO] Consulta A4 con token externo para CUIT: ${cuit}`
        );

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
          environment: "HOMOLOGACIÓN",
          service: "ws_sr_padron_a4",
          persona,
          consulta: {
            cuit,
            timestamp: new Date().toISOString(),
            method: "withToken",
            mode: "HOMOLOGACIÓN",
          },
        });
      } catch (error) {
        logger.error("❌ [HOMO] ERROR en /afipPadronWithToken:", error);
        res.status(500).json({
          ok: false,
          environment: "HOMOLOGACIÓN",
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
    secrets: [
      "AFIP_CERT", // Para homologación
      "AFIP_KEY", // Para homologación
      "arca-cert-prod", // Para producción
      "arca-key-prod", // Para producción
      "arca-cuit-prod", // Para ambos entornos
    ],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      const IS_PROD = getEnvironment(req);

      try {
        logger.info(
          `🔑 [${IS_PROD ? "PROD" : "HOMO"}] Solicitud a /afipAuthA13`
        );

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
    secrets: [
      "AFIP_CERT", // Para homologación
      "AFIP_KEY", // Para homologación
      "arca-cert-prod", // Para producción
      "arca-key-prod", // Para producción
      "arca-cuit-prod", // Para ambos entornos
    ],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      const IS_PROD = getEnvironment(req);

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
    secrets: [
      "AFIP_CERT", // Para homologación
      "AFIP_KEY", // Para homologación
      "arca-cert-prod", // Para producción
      "arca-key-prod", // Para producción
      "arca-cuit-prod", // Para ambos entornos
    ],
    cors: true,
  },
  async (req, res) => {
    handleCors(req, res, async () => {
      const IS_PROD = getEnvironment(req);

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
      const IS_PROD = getEnvironment(req);

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
              note: "A4 solo disponible en homologación",
            },
            a13: {
              auth: "/afipAuthA13",
              padron: "/afipPadronA13",
              padronWithToken: "/afipPadronWithTokenA13",
              note: "A13 disponible en ambos entornos",
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
      const IS_PROD = getEnvironment(req);

      try {
        const debugInfo = {
          environment: IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN",
          nodeVersion: process.version,
          region: process.env.FUNCTION_REGION || "us-central1",
          services: {
            a4: {
              service: "ws_sr_padron_a4",
              status: "available",
              environment: "HOMOLOGACIÓN only",
            },
            a13: {
              service: "ws_sr_padron_a13",
              status: "available",
              environment: "Both PROD and HOMO",
            },
          },
          config: "Estable - A4 solo homologación, A13 ambos entornos",
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
      const IS_PROD = getEnvironment(req);

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
              environment: "HOMOLOGACIÓN only",
            },
            a13: {
              name: "Padrón A13",
              service: "ws_sr_padron_a13",
              status: "available",
              description: "Consulta básica de datos del contribuyente",
              environment: "PRODUCCIÓN and HOMOLOGACIÓN",
            },
          },
          notes: "A13 actualmente autorizado en AFIP para ambos entornos",
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
