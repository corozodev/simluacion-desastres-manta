export interface AppConfig {
  worldApiBaseUrl: string;
  floodApiBaseUrl: string;
  incidentsApiBaseUrl: string;
  osmTilesEnabled: boolean;
  osmTileUrlTemplate: string;
  timeoutMs: number;
  error?: string;
  floodError?: string;
  incidentsError?: string;
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const configuredUrl = env.VITE_WORLD_API_BASE_URL ?? 'https://api.sistemamanta.lexinnovate.com';
  const timeoutMs = Number(env.VITE_API_TIMEOUT_MS ?? 8000);
  const fallback: AppConfig = { worldApiBaseUrl: '', floodApiBaseUrl: '', incidentsApiBaseUrl: '', osmTilesEnabled: false, osmTileUrlTemplate: '', timeoutMs: 8000 };
  try {
    const url = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return { ...fallback, error: 'La URL de evacuación debe usar HTTP(S), sin credenciales, parámetros ni fragmentos.' };
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
      return { ...fallback, error: 'VITE_API_TIMEOUT_MS debe estar entre 100 y 120000 milisegundos.' };
    }
    const result: AppConfig = { ...fallback, worldApiBaseUrl: url.toString().replace(/\/$/, ''), timeoutMs };
    const localHostname = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? window.location.hostname : undefined;
    try {
      const floodUrl = new URL(env.VITE_FLOOD_API_BASE_URL ?? (localHostname ? `http://${localHostname}:8082` : result.worldApiBaseUrl));
      if (!['http:', 'https:'].includes(floodUrl.protocol) || floodUrl.username || floodUrl.password || floodUrl.search || floodUrl.hash) throw new Error('invalid');
      result.floodApiBaseUrl = floodUrl.toString().replace(/\/$/, '');
    } catch {
      result.floodError = 'VITE_FLOOD_API_BASE_URL debe usar HTTP(S), sin credenciales, parámetros ni fragmentos.';
    }
    try {
      const incidentsUrl = new URL(env.VITE_INCIDENTS_API_BASE_URL ?? result.floodApiBaseUrl);
      if (!['http:', 'https:'].includes(incidentsUrl.protocol) || incidentsUrl.username || incidentsUrl.password || incidentsUrl.search || incidentsUrl.hash) throw new Error('invalid');
      result.incidentsApiBaseUrl = incidentsUrl.toString().replace(/\/$/, '');
    } catch {
      result.incidentsError = 'VITE_INCIDENTS_API_BASE_URL debe usar HTTP(S), sin credenciales, parámetros ni fragmentos.';
    }
    const tileTemplate = env.VITE_OSM_TILE_URL_TEMPLATE ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    try {
      const tileUrl = new URL(tileTemplate);
      if (tileUrl.protocol !== 'https:' || tileUrl.username || tileUrl.password || tileUrl.search || tileUrl.hash || !['{z}', '{x}', '{y}'].every(token => tileTemplate.includes(token))) throw new Error('invalid');
      result.osmTileUrlTemplate = tileTemplate;
      result.osmTilesEnabled = env.VITE_OSM_TILES_ENABLED !== 'false';
    } catch { /* Local OSM geometry stays usable if the optional raster provider is invalid. */ }
    return result;
  } catch {
    return { ...fallback, error: 'VITE_WORLD_API_BASE_URL no contiene una URL válida.' };
  }
}

export const config = readConfig(import.meta.env);
