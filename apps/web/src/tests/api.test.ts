import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, readConfig } from '../lib/config';
import { api, ApiError } from '../services/api';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); config.timeoutMs = 8000; });
describe('adaptador HTTP Go', () => {
  it('consulta healthz con la URL Go sin credenciales privilegiadas', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ok', service: 'corodev-evacuation', version: '0.1.0' })));
    await expect(api.health()).resolves.toMatchObject({ service: 'corodev-evacuation' });
    expect(request.mock.calls[0]?.[0]).toBe(`${config.worldApiBaseUrl}/healthz`);
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({ Accept: 'application/json' });
  });
  it('propaga los errores reales y su request ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Snapshot no disponible.', requestId: 'req-state', details: [] } }), { status: 503 }));
    await expect(api.world()).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503, requestId: 'req-state' });
  });
  it('traduce la indisponibilidad de red', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.health()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });
  it('cancela al superar el timeout', async () => {
    vi.useFakeTimers(); config.timeoutMs = 100;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); }));
    const pending = expect(api.health()).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100); await pending;
  });
  it('rechaza respuestas que incumplen el contrato', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ok' })));
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
  });
  it('conserva los errores HTTP sin envelope JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad gateway', { status: 502, headers: { 'x-request-id': 'gateway-req' } }));
    await expect(api.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 502, requestId: 'gateway-req' });
  });
});
describe('configuración Go pública', () => {
  it('usa producción por defecto y permite Go local explícito', () => {
    expect(readConfig({}).worldApiBaseUrl).toBe('https://api.sistemamanta.lexinnovate.com');
    expect(readConfig({ VITE_WORLD_API_BASE_URL: 'http://localhost:8080/' }).worldApiBaseUrl).toBe('http://localhost:8080');
  });
  it('rechaza credenciales y parámetros sin exponerlos', () => {
    const result = readConfig({ VITE_WORLD_API_BASE_URL: 'https://user:secret@example.com?token=secret' });
    expect(result.error).toBeDefined(); expect(JSON.stringify(result)).not.toContain('secret'); expect(result.worldApiBaseUrl).toBe('');
  });
  it('rechaza URL y timeout inválidos', () => {
    expect(readConfig({ VITE_WORLD_API_BASE_URL: 'not-a-url' }).error).toBeDefined();
    expect(readConfig({ VITE_API_TIMEOUT_MS: '0' }).error).toBeDefined();
  });
});
