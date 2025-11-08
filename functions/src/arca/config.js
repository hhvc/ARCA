/**
 * config.js - Configuración centralizada
 */

export function getConfig() {
  const IS_PROD = false; // Por ahora forzamos HOMOLOGACIÓN
  console.log(
    `🚀 Iniciando ARCA API en modo: ${IS_PROD ? "PRODUCCIÓN" : "HOMOLOGACIÓN"}`
  );

  return {
    IS_PROD,
    corsOptions: {
      origin: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    },
  };
}
