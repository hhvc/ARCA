/**
 * secrets.js - CON DEBUGGING MEJORADO
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

export async function accessSecret(secretName) {
  try {
    const projectId = process.env.GCLOUD_PROJECT || "arca-25621";
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    console.log(`🔐 [DEBUG] Accediendo a secret: ${secretName}`);

    const [version] = await client.accessSecretVersion({ name });

    if (!version.payload || !version.payload.data) {
      throw new Error(`Secret ${secretName} está vacío o no existe`);
    }

    const secretValue = version.payload.data.toString();

    // DEBUG EXTENDIDO
    console.log(
      `✅ [DEBUG] Secret ${secretName} cargado - Longitud: ${secretValue.length} chars`
    );
    console.log(
      `📄 [DEBUG] Primeros 100 chars: "${secretValue.substring(0, 100)}"`
    );
    console.log(
      `📄 [DEBUG] Últimos 50 chars: "${secretValue.substring(
        secretValue.length - 50
      )}"`
    );

    // Verificar formato PEM
    if (secretName.includes("CERT") || secretName.includes("cert")) {
      if (!secretValue.includes("BEGIN CERTIFICATE")) {
        console.warn(
          `⚠️ [DEBUG] El secret ${secretName} no parece ser un certificado PEM válido`
        );
      }
    }

    if (secretName.includes("KEY") || secretName.includes("key")) {
      if (!secretValue.includes("BEGIN PRIVATE KEY")) {
        console.warn(
          `⚠️ [DEBUG] El secret ${secretName} no parece ser una clave privada PEM válida`
        );
      }
    }

    return secretValue;
  } catch (error) {
    console.error(
      `❌ [DEBUG] Error accediendo al secret ${secretName}:`,
      error.message
    );
    throw error;
  }
}
