import { generarTokenPersistente } from "./production-token-json.js";

(async () => {
  try {
    const tokenData = await generarTokenPersistente();
    console.log("✅ Token persistente listo para usar:");
    console.log(tokenData);
  } catch (err) {
    console.error("❌ Error al generar token persistente:", err);
  }
})();
