// src/services/afipApi.js - VERSIÓN SOLO PRODUCCIÓN
const PRODUCTION_URL = "https://us-central1-arca-25621.cloudfunctions.net";

// Forzar siempre URL de producción
const BASE_URL = PRODUCTION_URL;

export const testAuth = async () => {
  try {
    console.log("🔗 Conectando a Cloud Functions en producción...");

    const response = await fetch(`${BASE_URL}/afipAuth`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error en testAuth:", error);
    throw error;
  }
};

export const getPadron = async (cuit) => {
  try {
    console.log("🔑 Paso 1: Obteniendo token AFIP...");

    // Primero obtener el token
    const authResponse = await testAuth();

    if (!authResponse.ok) {
      throw new Error(`Error de autenticación: ${authResponse.error}`);
    }

    console.log("✅ Token obtenido correctamente");
    console.log("📋 Paso 2: Consultando padrón con token...");

    // Luego usar el token para consultar el padrón
    const { token, sign } = authResponse;

    const padronResponse = await fetch(
      `${BASE_URL}/afipPadronWithToken?cuit=${cuit}&token=${encodeURIComponent(
        token
      )}&sign=${encodeURIComponent(sign)}`
    );

    if (!padronResponse.ok) {
      const errorText = await padronResponse.text();
      throw new Error(
        `Error del servidor: ${padronResponse.status} - ${errorText}`
      );
    }

    const padronData = await padronResponse.json();

    if (!padronData.ok) {
      throw new Error(padronData.error || "Error desconocido en consulta AFIP");
    }

    console.log("✅ Consulta al padrón exitosa");
    return padronData;
  } catch (error) {
    console.error("❌ Error en getPadron:", error);
    throw error;
  }
};
