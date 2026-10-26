export type ApiMode = 'mock' | 'remote';

export interface AppConfig {
  apiMode: ApiMode;
  apiBaseUrl: string;
  worldApiBaseUrl: string;
  timeoutMs: number;
  error?: string;
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const mode = env.VITE_API_MODE ?? 'mock';
  const configuredUrl = env.VITE_API_BASE_URL ?? 'http://localhost:3001';
  const timeoutMs = Number(env.VITE_API_TIMEOUT_MS ?? 8000);
  const fallback: AppConfig = { apiMode: 'mock', apiBaseUrl: '', worldApiBaseUrl: '', timeoutMs: 8000 };
  try {
    const url = new URL(configuredUrl);
    const worldUrl = new URL(env.VITE_WORLD_API_BASE_URL ?? configuredUrl);
    if ([url, worldUrl].some(value => !['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.search || value.hash)) {
      return { ...fallback, error: 'La URL de API debe usar HTTP(S), sin credenciales, parámetros ni fragmentos.' };
    }
    if (mode !== 'mock' && mode !== 'remote') return { ...fallback, error: 'VITE_API_MODE debe ser mock o remote.' };
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
      return { ...fallback, error: 'El timeout debe estar entre 100 y 120000 milisegundos.' };
    }
    return { apiMode: mode, apiBaseUrl: url.toString().replace(/\/$/, ''), worldApiBaseUrl: worldUrl.toString().replace(/\/$/, ''), timeoutMs };
  } catch {
    return { ...fallback, error: 'VITE_API_BASE_URL no contiene una URL válida.' };
  }
}

export const config = readConfig(import.meta.env);
