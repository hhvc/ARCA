/**
 * secrets.js - Manejo de secrets para Google Secret Manager
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

/**
 * Accede a un secret de Google Secret Manager
 */
export async function accessSecret(secretName) {
  try {
    const projectId = process.env.GCLOUD_PROJECT || "arca-25621";
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    console.log(`🔐 Accediendo a secret: ${secretName}`);

    const [version] = await client.accessSecretVersion({ name });

    if (!version.payload || !version.payload.data) {
      throw new Error(`Secret ${secretName} está vacío o no existe`);
    }

    const secretValue = version.payload.data.toString("utf8");
    console.log(`✅ Secret ${secretName} cargado correctamente`);

    return secretValue;
  } catch (error) {
    console.error(
      `❌ Error accediendo al secret ${secretName}:`,
      error.message
    );

    if (error.message.includes("PERMISSION_DENIED")) {
      throw new Error(
        `Sin permisos para acceder a ${secretName}. Verifica los permisos de Secret Manager.`
      );
    }

    if (error.message.includes("NOT_FOUND")) {
      throw new Error(`El secret ${secretName} no existe.`);
    }

    throw new Error(`Error cargando ${secretName}: ${error.message}`);
  }
}
