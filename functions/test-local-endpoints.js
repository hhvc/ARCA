/**
 * test-local-endpoints.js
 * Prueba local de las Cloud Functions AFIP (usando el emulador)
 */

import axios from "axios";

const BASE_URL = "http://localhost:5001/arca-25621/us-central1";

async function probarEndpoint(nombre, url) {
  console.log(`\n🚀 Probando ${nombre}...`);
  try {
    const response = await axios.get(url, { timeout: 15000 });
    console.log(`✅ ${nombre} OK`);
    console.log("Respuesta:", response.data);
  } catch (err) {
    if (err.response) {
      console.error(`❌ ${nombre} devolvió HTTP ${err.response.status}`);
      console.error("Respuesta:", err.response.data);
    } else {
      console.error(`❌ ${nombre} error de conexión:`, err.message);
    }
  }
}

async function main() {
  console.log("🔍 Iniciando pruebas locales de Cloud Functions...\n");

  await probarEndpoint("afipAuth", `${BASE_URL}/afipAuth`);
  await probarEndpoint("afipPadronDummy", `${BASE_URL}/afipPadronDummy`);
  await probarEndpoint(
    "afipPadron (con ?cuit=20253006219)",
    `${BASE_URL}/afipPadron?cuit=20253006219`
  );

  console.log("\n🧩 Pruebas locales finalizadas.\n");
}

main();
