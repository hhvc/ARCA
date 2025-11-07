// src/services/afipApi.js - VERSIÓN ACTUALIZADA CON MÚLTIPLES SERVICIOS
const PRODUCTION_URL = "https://us-central1-arca-25621.cloudfunctions.net";

// Forzar siempre URL de producción
const BASE_URL = PRODUCTION_URL;

// Función genérica para autenticación
export const testAuth = async (service = "A14") => {
  try {
    console.log(`🔗 Conectando a Cloud Functions para servicio ${service}...`);

    let endpoint;
    switch (service) {
      case "A13":
        endpoint = "/afipAuthA13";
        break;
      case "A14":
      default:
        endpoint = "/afipAuth";
        break;
    }

    const response = await fetch(`${BASE_URL}${endpoint}`);
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
export const getPadron = async (cuit, service = "A14") => {
  try {
    console.log(`🔑 Paso 1: Obteniendo token AFIP para ${service}...`);

    // Primero obtener el token
    const authResponse = await testAuth(service);

    if (!authResponse.ok) {
      throw new Error(`Error de autenticación: ${authResponse.error}`);
    }

    console.log("✅ Token obtenido correctamente");
    console.log(`📋 Paso 2: Consultando padrón ${service} con token...`);

    // Luego usar el token para consultar el padrón
    const { token, sign } = authResponse;

    let endpoint;
    switch (service) {
      case "A13":
        endpoint = "/afipPadronWithTokenA13";
        break;
      case "A14":
      default:
        endpoint = "/afipPadronWithToken";
        break;
    }

    const padronResponse = await fetch(
      `${BASE_URL}${endpoint}?cuit=${cuit}&token=${encodeURIComponent(
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

    console.log(`✅ Consulta al padrón ${service} exitosa`);
    return padronData;
  } catch (error) {
    console.error(`❌ Error en getPadron ${service}:`, error);
    throw error;
  }
};

// Funciones específicas para compatibilidad
export const testAuthA14 = () => testAuth("A14");
export const testAuthA13 = () => testAuth("A13");
export const getPadronA14 = (cuit) => getPadron(cuit, "A14");
export const getPadronA13 = (cuit) => getPadron(cuit, "A13");
