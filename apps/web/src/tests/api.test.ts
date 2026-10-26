import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, readConfig } from '../lib/config';
import { api, ApiError } from '../services/api';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); config.timeoutMs = 8000; });

describe('adaptador HTTP', () => {
  it('propaga el envelope de errores y sus detalles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Título inválido.', requestId: 'req-validation', details: [{ field: 'title', message: 'Obligatorio' }] } }), { status: 400 }));
    await expect(api.submit({ title: '' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, requestId: 'req-validation', details: [{ field: 'title', message: 'Obligatorio' }] });
  });

  it('traduce la indisponibilidad de red', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.health()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });

  it('cancela solicitudes al superar el timeout', async () => {
    vi.useFakeTimers();
    config.timeoutMs = 100;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); }));
    const pending = expect(api.health()).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
  });

  it('rechaza respuestas que incumplen el contrato', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ok' })));
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'incomplete' }], pagination: { page: 1, pageSize: 6, total: 1 } })));
    await expect(api.items()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('normaliza errores HTTP sin un envelope JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad gateway', { status: 502, headers: { 'x-request-id': 'gateway-req' } }));
    await expect(api.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 502, requestId: 'gateway-req' });
  });
});

describe('configuración pública', () => {
  it('permite una API remota con prefijo de ruta', () => {
    expect(readConfig({ VITE_API_MODE: 'remote', VITE_API_BASE_URL: 'https://api.example.com/stage/' })).toMatchObject({ apiMode: 'remote', apiBaseUrl: 'https://api.example.com/stage' });
  });

  it('rechaza credenciales y parámetros sin exponerlos en diagnóstico', () => {
    const result = readConfig({ VITE_API_BASE_URL: 'https://user:secret@example.com?token=secret' });
    expect(result.error).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.apiBaseUrl).toBe('');
  });

  it('rechaza modo, URL y timeout inválidos', () => {
    expect(readConfig({ VITE_API_MODE: 'fake' }).error).toBeDefined();
    expect(readConfig({ VITE_API_BASE_URL: 'not-a-url' }).error).toBeDefined();
    expect(readConfig({ VITE_API_TIMEOUT_MS: '0' }).error).toBeDefined();
  });
});
