export interface AppConfig {
  worldApiBaseUrl: string;
  timeoutMs: number;
  error?: string;
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const configuredUrl = env.VITE_WORLD_API_BASE_URL ?? 'https://api.sistemamanta.lexinnovate.com';
  const timeoutMs = Number(env.VITE_API_TIMEOUT_MS ?? 8000);
  const fallback: AppConfig = { worldApiBaseUrl: '', timeoutMs: 8000 };
  try {
    const url = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return { ...fallback, error: 'La URL de evacuación debe usar HTTP(S), sin credenciales, parámetros ni fragmentos.' };
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
      return { ...fallback, error: 'VITE_API_TIMEOUT_MS debe estar entre 100 y 120000 milisegundos.' };
    }
    return { worldApiBaseUrl: url.toString().replace(/\/$/, ''), timeoutMs };
  } catch {
    return { ...fallback, error: 'VITE_WORLD_API_BASE_URL no contiene una URL válida.' };
  }
}

export const config = readConfig(import.meta.env);
