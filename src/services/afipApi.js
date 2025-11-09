// src/services/afipApi.js - VERSIÓN DEFINITIVA

const BASE_URL = "https://us-central1-arca-25621.cloudfunctions.net";

let currentEnvironment = "homo";

export const setEnvironment = (environment) => {
  currentEnvironment = environment;
  console.log(`🌍 Entorno cambiado a: ${environment}`);
};

export const getCurrentEnvironment = () => currentEnvironment;

// Función genérica para autenticación
export const testAuth = async (service = "a4") => {
  try {
    let endpoint;
    const normalizedService = service.toLowerCase();

    switch (normalizedService) {
      case "a13":
        endpoint = "/afipAuthA13";
        break;
      case "a4":
      default:
        endpoint = "/afipAuth";
        break;
    }

    const environment =
      normalizedService === "a4" ? "homo" : currentEnvironment;
    const url = `${BASE_URL}${endpoint}?environment=${environment}`;

    console.log(`🔗 Autenticación ${normalizedService} en ${environment}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error en testAuth:", error);
    throw error;
  }
};

// Función genérica para consultar padrón
export const getPadron = async (cuit, service = "a4") => {
  try {
    const normalizedService = service.toLowerCase();

    console.log(`🔑 Obteniendo token para ${normalizedService}...`);

    // Primero obtener el token
    const authResponse = await testAuth(normalizedService);

    if (!authResponse.ok) {
      throw new Error(`Error de autenticación: ${authResponse.error}`);
    }

    console.log("✅ Token obtenido");
    console.log(`📋 Consultando padrón ${normalizedService}...`);

    const { token, sign } = authResponse;

    // ✅ USAR LAS FUNCIONES "WithToken" CORRECTAS
    let endpoint;
    if (normalizedService === "a13") {
      endpoint = "/afipPadronWithTokenA13"; // Para A13
    } else {
      endpoint = "/afipPadronWithToken"; // Para a4
    }

    const environment =
      normalizedService === "a4" ? "homo" : currentEnvironment;

    // ✅ USAR QUERY PARAMETERS (como funciona actualmente)
    const padronUrl = `${BASE_URL}${endpoint}?cuit=${cuit}&token=${encodeURIComponent(
      token
    )}&sign=${encodeURIComponent(sign)}&environment=${environment}`;

    console.log(`🔗 URL: ${padronUrl}`);

    const padronResponse = await fetch(padronUrl);

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

    console.log(`✅ Consulta ${normalizedService} exitosa`);
    return padronData;
  } catch (error) {
    console.error(`❌ Error en getPadron ${service}:`, error);
    throw error;
  }
};

// Funciones específicas para compatibilidad
export const testAutha4 = () => testAuth("a4");
export const testAuthA13 = () => testAuth("a13");
export const getPadrona4 = (cuit) => getPadron(cuit, "a4");
export const getPadronA13 = (cuit) => getPadron(cuit, "a13");
