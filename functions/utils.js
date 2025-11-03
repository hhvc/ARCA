/* eslint-env node */
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

// Cache en memoria: Map<secretName, { value: string, expiresAt: number }>
const secretCache = new Map();

// TTL configurable por entorno (default: 5 min)
const DEFAULT_TTL_MS = parseInt(process.env.SECRET_CACHE_TTL_MS || "300000", 10);

/**
 * Obtiene un secreto desde Google Secret Manager con cache en memoria
 * @param {string} secretName Ruta completa del secreto (p.ej. "projects/123456789/secrets/MICERT/versions/latest")
 * @param {number} ttl Tiempo de vida del cache en milisegundos (opcional)
 * @returns {Promise<string>} El contenido del secreto en texto UTF-8
 */
export async function getSecretCached(secretName, ttl = DEFAULT_TTL_MS) {
  if (!secretName || typeof secretName !== "string") {
    throw new Error("Se requiere un nombre de secreto válido (string).");
  }

  const now = Date.now();
  const cached = secretCache.get(secretName);
  if (cached && cached.expiresAt > now) {
    if (process.env.DEBUG_AFIP === "true") {
      console.log(`[SecretManager] Cache hit: ${secretName}`);
    }
    return cached.value;
  }

  // Acceso al secreto con reintento simple
  let payload;
  try {
    const [version] = await client.accessSecretVersion({ name: secretName });
    payload = version.payload?.data?.toString("utf8");
  } catch (err) {
    console.error(`[SecretManager] Error accediendo al secreto ${secretName}:`, err.message);
    throw new Error("No se pudo acceder al secreto de Secret Manager.");
  }

  if (!payload) {
    throw new Error(`El secreto ${secretName} no tiene contenido o no existe.`);
  }

  // Guardar en cache
  secretCache.set(secretName, { value: payload, expiresAt: now + ttl });

  if (process.env.DEBUG_AFIP === "true") {
    console.log(`[SecretManager] Cache actualizado: ${secretName} (TTL ${ttl / 1000}s)`);
  }

  return payload;
}

/**
 * Limpia secretos expirados del cache.
 * Puede llamarse periódicamente si el entorno es de larga vida (ej. App Engine).
 */
export function clearExpiredSecrets() {
  const now = Date.now();
  for (const [key, { expiresAt }] of secretCache.entries()) {
    if (expiresAt < now) {
      secretCache.delete(key);
    }
  }
}

/**
 * Limpieza manual del cache (por si necesitás invalidarlo tras rotar secretos)
 */
export function clearAllSecrets() {
  secretCache.clear();
}
