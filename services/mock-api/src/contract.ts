import { readFileSync } from 'node:fs';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import type { FastifySchema } from 'fastify';

type Schema = Record<string, unknown>;
type Parameter = { name: string; in: string; required?: boolean; schema: Schema };
type Response = { $ref?: string; content?: Record<string, { schema: Schema }> };
type Operation = {
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, Response>;
};
type ContractDocument = {
  info: { version: string };
  paths: Record<string, Partial<Record<'get' | 'post', Operation>>>;
  components: { schemas: Record<string, Schema>; responses: Record<string, Response> };
};

// src/ and dist/ are siblings, so this location works in development and the build.
export const contract = parse(
  readFileSync(new URL('../../../packages/contracts/openapi.yaml', import.meta.url), 'utf8'),
) as ContractDocument;

const contractId = 'https://corodev.local/contracts';
// OpenAPI 3.0 uses boolean exclusive bounds; Ajv draft-07 needs numeric bounds.
// Translate schema syntax, retaining the shared YAML as the source of truth.
function normalize<T>(value: T): T {
  const translated: unknown = JSON.parse(JSON.stringify(value).replaceAll('#/components/schemas/', `${contractId}#/definitions/`));
  function convert(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(convert);
    if (typeof node !== 'object' || node === null) return node;
    const result = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, convert(child)]));
    for (const [exclusive, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
      if (typeof result[exclusive] === 'boolean') {
        if (result[exclusive]) { result[exclusive] = result[bound]; delete result[bound]; }
        else delete result[exclusive];
      }
    }
    return result;
  }
  return convert(translated) as T;
}

export const contractDefinitions = {
  $id: contractId,
  definitions: normalize(contract.components.schemas),
};

function responseSchema(response: Response): Schema {
  if (response.$ref) {
    const name = response.$ref.split('/').at(-1) ?? '';
    const resolved = contract.components.responses[name];
    if (!resolved) throw new Error(`Unknown contract response: ${name}`);
    return responseSchema(resolved);
  }
  const schema = response.content?.['application/json']?.schema;
  if (!schema) throw new Error('Contract response is missing a JSON schema');
  return normalize(schema);
}

export function routeSchema(path: string, method: 'get' | 'post'): FastifySchema {
  const operation = contract.paths[path]?.[method];
  if (!operation) throw new Error(`Unknown contract operation: ${method} ${path}`);
  const result: FastifySchema = {
    response: Object.fromEntries(
      Object.entries(operation.responses).map(([status, response]) => [status, responseSchema(response)]),
    ),
  };
  for (const [location, key] of [['query', 'querystring'], ['path', 'params']] as const) {
    const parameters = operation.parameters?.filter((parameter) => parameter.in === location) ?? [];
    if (parameters.length) {
      result[key] = normalize({
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.schema])),
        required: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
      });
    }
  }
  const body = operation.requestBody?.content['application/json']?.schema;
  if (body) result.body = normalize(body);
  return result;
}

function makeAjv(coerceTypes: boolean): Ajv {
  const ajv = new Ajv({ allErrors: true, coerceTypes, useDefaults: coerceTypes, strict: false });
  addFormats.default(ajv);
  ajv.addSchema(contractDefinitions);
  return ajv;
}

export const inputAjv = makeAjv(true);
export const bodyAjv = makeAjv(false);
const responseAjv = makeAjv(false);
const responseValidators = new Map<unknown, ValidateFunction>();

export function validateResponse(schema: unknown, payload: unknown): boolean {
  let validate = responseValidators.get(schema);
  if (!validate) {
    validate = responseAjv.compile(schema as Schema);
    responseValidators.set(schema, validate);
  }
  return Boolean(validate(payload));
}

export const errorSchema = normalize({ $ref: '#/components/schemas/ErrorResponse' });

export function validationDetails(errors: readonly ErrorObject[] | undefined): { field: string; message: string }[] {
  return (errors ?? []).map((error) => ({
    field: [error.instancePath.replaceAll('/', '.').replace(/^\./, ''),
      typeof error.params.missingProperty === 'string' ? error.params.missingProperty : '',
      typeof error.params.additionalProperty === 'string' ? error.params.additionalProperty : '',
    ].filter(Boolean).join('.') || 'request',
    message: error.message ?? 'Valor inválido',
  }));
}
