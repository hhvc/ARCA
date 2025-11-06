/**
 * token-cache.js
 * Cache en memoria para tokens AFIP (válido por instancia de Cloud Function)
 */

const tokenCache = new Map();

export function getCachedToken(service = "ws_sr_padron_a4") {
  const cached = tokenCache.get(service);
  if (cached && new Date(cached.expiration) > new Date()) {
    console.log("✅ Token obtenido desde cache");
    return cached;
  }
  return null;
}

export function setCachedToken(tokenData, service = "ws_sr_padron_a4") {
  tokenCache.set(service, tokenData);
  console.log("💾 Token guardado en cache");
}

export function clearCache() {
  tokenCache.clear();
  console.log("🧹 Cache limpiado");
}
