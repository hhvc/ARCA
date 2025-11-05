import axios from "axios";

// 🔧 URL de producción: reemplaza con tu proyecto Firebase
const PROD_BASE_URL = "https://us-central1-arca-25621.cloudfunctions.net";

// Usamos la variable de entorno de Vite si existe (para dev), si no, prod
const BASE_URL = import.meta.env.VITE_API_BASE_URL || PROD_BASE_URL;

/**
 * Llama a la función de autenticación WSAA
 */
export async function testAuth() {
  try {
    const res = await axios.get(`${BASE_URL}/afipAuth`, {
      timeout: 20000, // 20s
    });
    return res.data;
  } catch (err) {
    console.error("[AFIP API] Error en testAuth:", err.message);
    throw err;
  }
}

/**
 * Consulta datos del padrón AFIP
 * @param {string} cuit - CUIT del contribuyente
 */
export async function getPadron(cuit) {
  if (!cuit) throw new Error("Debés pasar un CUIT válido");
  try {
    const res = await axios.get(`${BASE_URL}/afipPadron?cuit=${cuit}`, {
      timeout: 20000,
    });
    return res.data;
  } catch (err) {
    console.error(`[AFIP API] Error en getPadron(${cuit}):`, err.message);
    throw err;
  }
}
