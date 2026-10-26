import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import type { ErrorResponse, HealthResponse, ItemListResponse, SubmitRequest, SubmitResponse } from '@corodev/contracts';
import { bodyAjv, contract, contractDefinitions, errorSchema, inputAjv, routeSchema, validateResponse, validationDetails } from './contract.js';
import { demoItems } from './fixtures.js';
import { demoGraph, demoWorld } from './world-fixtures.js';

export interface AppOptions {
  nodeEnv?: string;
  allowedOrigins?: string[];
  enableDevControls?: boolean;
  logger?: boolean;
}

class RequestError extends Error {
  constructor(readonly statusCode: number, readonly code: ErrorResponse['error']['code'], message: string) {
    super(message);
  }
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const enableDevControls = nodeEnv === 'development' &&
    (options.enableDevControls ?? process.env.ENABLE_DEV_CONTROLS === 'true');
  const allowedOrigins = options.allowedOrigins ??
    (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 16_384,
    ajv: { customOptions: { coerceTypes: true, useDefaults: true, removeAdditional: false } },
    frameworkErrors: (error, request, reply) => {
      const invalidUrl = error.code === 'FST_ERR_BAD_URL';
      const body: ErrorResponse = { error: {
        code: invalidUrl ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        message: invalidUrl ? 'La URL enviada no es válida.' : 'Ocurrió un error interno. Intenta de nuevo.',
        requestId: request.id, details: [],
      } };
      // Framework failures occur before a route exists, so no route reply type applies.
      const response = reply as FastifyReply;
      response.header('x-request-id', request.id).status(invalidUrl ? 400 : 500).send(body);
    },
  });
  app.addSchema(contractDefinitions);
  app.setValidatorCompiler(({ schema, httpPart }) => (httpPart === 'body' ? bodyAjv : inputAjv).compile(schema));
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (request.method === 'OPTIONS' && (!request.headers.origin || !request.headers['access-control-request-method'])) {
      throw new RequestError(400, 'VALIDATION_ERROR', 'La solicitud CORS requiere origen y método.');
    }
    if (!enableDevControls) return;
    const fail = request.headers['x-demo-fail'];
    const rawDelay = request.headers['x-demo-delay-ms'];
    if (rawDelay !== undefined) {
      if (typeof rawDelay !== 'string' || !/^\d{1,4}$/.test(rawDelay) || Number(rawDelay) > 2000) {
        throw new RequestError(400, 'VALIDATION_ERROR', 'x-demo-delay-ms debe ser un entero entre 0 y 2000.');
      }
      await delay(Number(rawDelay));
    }
    if (fail === 'true') throw new RequestError(500, 'INTERNAL_ERROR', 'Error de demostración solicitado.');
  });
  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-demo-delay-ms', 'x-demo-fail'],
    exposedHeaders: ['x-request-id'],
    credentials: false,
  });
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (reply.statusCode === 204) return payload;
    const responseSchemas = request.routeOptions.schema?.response as Record<string, unknown> | undefined;
    const schema = responseSchemas?.[String(reply.statusCode)] ??
      (reply.statusCode >= 400 ? errorSchema : undefined);
    if (schema && !validateResponse(schema, payload)) {
      request.log.error({ requestId: request.id }, 'Response does not satisfy the HTTP contract');
      throw new Error('Response contract validation failed');
    }
    return payload;
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const isRequestError = error instanceof RequestError;
    const isValidation = Boolean(error.validation) || (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500);
    const statusCode = isRequestError ? error.statusCode : isValidation ? 400 : 500;
    const body: ErrorResponse = {
      error: {
        code: isRequestError ? error.code : isValidation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        message: isRequestError ? error.message : isValidation ? 'Revisa los datos enviados.' : 'Ocurrió un error interno. Intenta de nuevo.',
        requestId: request.id,
        details: validationDetails(error.validation),
      },
    };
    if (statusCode >= 500) request.log.error({ err: error, requestId: request.id }, 'Request failed');
    reply.status(statusCode).send(body);
  });
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = { error: {
      code: 'NOT_FOUND', message: 'El recurso solicitado no existe.', requestId: request.id, details: [],
    } };
    reply.status(404).send(body);
  });
  app.get('/estado', { schema: routeSchema('/estado', 'get') }, async () => demoWorld);
  app.get('/grafo', { schema: routeSchema('/grafo', 'get') }, async () => demoGraph);
  app.get('/healthz', { schema: routeSchema('/healthz', 'get') }, async (): Promise<HealthResponse> => ({ status: 'ok', service: 'corodev-mock-api', version: contract.info.version }));
  app.get('/health', { schema: routeSchema('/health', 'get') }, async (): Promise<HealthResponse> => ({
    status: 'ok', service: 'corodev-mock-api', version: contract.info.version,
  }));
  app.get<{ Querystring: { page: number; pageSize: number; q?: string } }>(
    '/v1/demo/items', { schema: routeSchema('/v1/demo/items', 'get') },
    async (request): Promise<ItemListResponse> => {
      const { page, pageSize, q } = request.query;
      const query = q?.trim().toLocaleLowerCase('es');
      const filtered = query ? demoItems.filter((item) =>
        `${item.title} ${item.description}`.toLocaleLowerCase('es').includes(query)) : demoItems;
      const start = (page - 1) * pageSize;
      return { data: filtered.slice(start, start + pageSize), pagination: { page, pageSize, total: filtered.length } };
    },
  );
  app.get<{ Params: { id: string } }>(
    '/v1/demo/items/:id', { schema: routeSchema('/v1/demo/items/{id}', 'get') }, async (request) => {
      const item = demoItems.find((candidate) => candidate.id === request.params.id);
      if (!item) throw new RequestError(404, 'NOT_FOUND', 'El elemento solicitado no existe.');
      return item;
    },
  );
  app.post<{ Body: SubmitRequest }>(
    '/v1/demo/submit', { schema: routeSchema('/v1/demo/submit', 'post') }, async (request, reply) => {
      const title = request.body.title.trim();
      const body: SubmitResponse = {
        submissionId: randomUUID(), status: 'accepted', message: `Recibimos «${title}». Esta demo no guarda datos.`,
      };
      reply.status(202);
      return body;
    },
  );
  return app;
}
