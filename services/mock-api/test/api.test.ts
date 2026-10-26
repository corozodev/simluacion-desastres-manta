import { afterEach, describe, expect, it } from 'vitest';
import type { ErrorResponse, ItemListResponse, SubmitResponse } from '@corodev/contracts';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { contract, errorSchema, routeSchema, validateResponse } from '../src/contract.js';

const servers: FastifyInstance[] = [];
function setup(options: Parameters<typeof buildApp>[0] = {}): FastifyInstance {
  const app = buildApp({ nodeEnv: 'test', ...options });
  servers.push(app);
  return app;
}

afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

function expectError(response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }, status: number, code: ErrorResponse['error']['code']): void {
  expect(response.statusCode).toBe(status);
  const body = response.json() as ErrorResponse;
  expect(validateResponse(errorSchema, body)).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe(response.headers['x-request-id']);
  expect(body.error.requestId).toMatch(/^[a-f0-9-]{36}$/);
}

describe('OpenAPI routes', () => {
  it('reports health and generates its own request ID', async () => {
    const app = setup();
    const response = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'untrusted' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'corodev-mock-api', version: contract.info.version });
    expect(response.headers['x-request-id']).not.toBe('untrusted');
  });

  it('returns deterministic defaults, paginates and reports total before slicing', async () => {
    const app = setup();
    const first = (await app.inject('/v1/demo/items')).json<ItemListResponse>();
    expect(first.pagination).toEqual({ page: 1, pageSize: 10, total: 12 });
    expect(first.data).toHaveLength(10);
    expect(first.data[0]?.id).toBe('item-001');
    const second = (await app.inject('/v1/demo/items?page=2&pageSize=10')).json<ItemListResponse>();
    expect(second.data.map((item) => item.id)).toEqual(['item-011', 'item-012']);
    const outside = (await app.inject('/v1/demo/items?page=100')).json<ItemListResponse>();
    expect(outside.data).toEqual([]);
    expect(outside.pagination.total).toBe(12);
  });

  it('searches case-insensitively in title and description and supports no matches', async () => {
    const app = setup();
    const byTitle = (await app.inject('/v1/demo/items?q=MEDIANOCHE')).json<ItemListResponse>();
    expect(byTitle.data.map((item) => item.id)).toEqual(['item-001']);
    const byDescription = (await app.inject('/v1/demo/items?q=semilla')).json<ItemListResponse>();
    expect(byDescription.data.map((item) => item.id)).toEqual(['item-011']);
    const empty = (await app.inject('/v1/demo/items?q=no-coincidencia-zzzz')).json<ItemListResponse>();
    expect(empty).toEqual({ data: [], pagination: { page: 1, pageSize: 10, total: 0 } });
  });

  it.each([
    'page=0', 'page=-1', 'page=no', 'page=1.5', 'page=',
    'pageSize=101', 'pageSize=0', 'pageSize=abc', 'pageSize=2.5',
    'page=1&page=2', 'q=a&q=b', 'unexpected=true', `q=${'x'.repeat(201)}`,
  ])('rejects malformed query %s', async (query) => {
    const response = await setup().inject(`/v1/demo/items?${query}`);
    expectError(response, 400, 'VALIDATION_ERROR');
    expect(response.json<ErrorResponse>().error.details.length).toBeGreaterThan(0);
  });

  it('accepts pageSize=100 and the query length boundary', async () => {
    const app = setup();
    const response = await app.inject(`/v1/demo/items?pageSize=100&q=${'x'.repeat(200)}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<ItemListResponse>().pagination.pageSize).toBe(100);
  });

  it('returns item detail and uniform errors for missing items and endpoints', async () => {
    const app = setup();
    const response = await app.inject('/v1/demo/items/item-003');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'item-003', status: 'completed' });
    expectError(await app.inject('/v1/demo/items/no-such-item'), 404, 'NOT_FOUND');
    expectError(await app.inject('/no-such-route'), 404, 'NOT_FOUND');
    expectError(await app.inject('/v1/demo/items/%zz'), 400, 'VALIDATION_ERROR');
  });

  it('accepts a valid form, trims its title and never adds a fixture', async () => {
    const app = setup();
    const response = await app.inject({ method: 'POST', url: '/v1/demo/submit', payload: { title: '  Nueva idea  ', description: 'Descripción' } });
    expect(response.statusCode).toBe(202);
    const body = response.json<SubmitResponse>();
    expect(body.status).toBe('accepted');
    expect(body.submissionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.message).toContain('«Nueva idea»');
    expect((await app.inject('/v1/demo/items')).json<ItemListResponse>().pagination.total).toBe(12);
  });

  it.each([
    {}, { title: '' }, { title: '   \t\n' }, { title: 'x'.repeat(101) },
    { title: 42 }, { title: 'Valid', description: 42 },
    { title: 'Valid', description: 'x'.repeat(1001) }, { title: 'Valid', unexpected: true },
  ])('rejects invalid form %j', async (payload) => {
    expectError(await setup().inject({ method: 'POST', url: '/v1/demo/submit', payload }), 400, 'VALIDATION_ERROR');
  });

  it('handles malformed JSON and missing bodies through the common envelope', async () => {
    const app = setup();
    expectError(await app.inject({ method: 'POST', url: '/v1/demo/submit', headers: { 'content-type': 'application/json' }, payload: '{broken' }), 400, 'VALIDATION_ERROR');
    expectError(await app.inject({ method: 'POST', url: '/v1/demo/submit' }), 400, 'VALIDATION_ERROR');
  });

  it.each([null, 42, 'primitive', true, []])('rejects a root JSON value %j instead of an object', async (payload) => {
    const response = await setup().inject({ method: 'POST', url: '/v1/demo/submit',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('validates outgoing data before serialization can hide contract errors', async () => {
    const app = setup();
    app.get('/invalid-response', { schema: routeSchema('/v1/demo/items', 'get') }, () => ({
      data: [{ id: 'bad', title: 'Bad', description: '', status: 'invalid', createdAt: 'not-a-date' }],
      pagination: { page: 1, pageSize: 10, total: 1 },
      undocumentedField: true,
    }));
    const response = await app.inject('/invalid-response');
    expectError(response, 500, 'INTERNAL_ERROR');
    expect(response.body).not.toContain('not-a-date');
  });
});

describe('CORS and development controls', () => {
  it('permits only exact configured origins and exposes the request ID', async () => {
    const app = setup({ allowedOrigins: ['http://localhost:5173'] });
    const allowed = await app.inject({ url: '/health', headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-expose-headers']).toBe('x-request-id');
    for (const origin of ['http://localhost:5173.evil.test', 'https://localhost:5173', 'null']) {
      const denied = await app.inject({ url: '/health', headers: { origin } });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    }
    const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/demo/submit', headers: {
      origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type',
    } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    expectError(await app.inject({ method: 'OPTIONS', url: '/v1/demo/submit', headers: {
      origin: 'http://localhost:5173',
    } }), 400, 'VALIDATION_ERROR');
  });

  it('requires both development environment and explicit opt-in', async () => {
    const app = setup({ nodeEnv: 'development', enableDevControls: true });
    expectError(await app.inject({ url: '/health', headers: { 'x-demo-fail': 'true' } }), 500, 'INTERNAL_ERROR');
    expectError(await app.inject({ url: '/health', headers: { 'x-demo-delay-ms': '-1' } }), 400, 'VALIDATION_ERROR');
    expectError(await app.inject({ url: '/health', headers: { 'x-demo-delay-ms': '2001' } }), 400, 'VALIDATION_ERROR');
    const started = performance.now();
    const delayed = await app.inject({ url: '/health', headers: { 'x-demo-delay-ms': '20' } });
    expect(delayed.statusCode).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });

  it.each([
    { nodeEnv: 'development', enableDevControls: false },
    { nodeEnv: 'production', enableDevControls: true },
    { nodeEnv: 'test', enableDevControls: true },
  ])('ignores simulation headers for %j', async (options) => {
    const response = await setup(options).inject({ url: '/health', headers: { 'x-demo-fail': 'true', 'x-demo-delay-ms': '-1' } });
    expect(response.statusCode).toBe(200);
  });
});
