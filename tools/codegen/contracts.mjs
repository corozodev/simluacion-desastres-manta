import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const contractPath = path.join(root, 'packages/contracts/openapi.yaml');
await SwaggerParser.validate(contractPath);
console.log('OpenAPI válido.');
if (process.argv.includes('--validate')) process.exit(0);
const contract = parse(await readFile(contractPath, 'utf8'));
const schemas = contract.components.schemas;
const named = Object.keys(schemas);
// The mobile application consumes only the evacuation API. Keep the shared
// contract intact while generating the models reachable from those operations.
const mobileSchemas = new Set();
function collectMobileSchemas(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    const prefix = '#/components/schemas/';
    const responsesPrefix = '#/components/responses/';
    if (value.$ref.startsWith(prefix)) {
      const name = value.$ref.slice(prefix.length);
      if (!schemas[name]) throw new Error(`Unknown mobile schema ${name}`);
      if (!mobileSchemas.has(name)) {
        mobileSchemas.add(name);
        collectMobileSchemas(schemas[name]);
      }
    } else if (value.$ref.startsWith(responsesPrefix)) {
      collectMobileSchemas(contract.components.responses[value.$ref.slice(responsesPrefix.length)]);
    }
  }
  for (const entry of Object.values(value)) collectMobileSchemas(entry);
}
for (const route of ['/healthz', '/grafo', '/estado', '/paso', '/v1/incidents/config', '/v1/incidents/resolve', '/v1/incidents', '/v1/incidents/{incident_id}']) {
  if (!contract.paths[route]) throw new Error(`Missing evacuation operation ${route}`);
  collectMobileSchemas(contract.paths[route]);
}
const header = '// GENERATED from packages/contracts/openapi.yaml. Do not edit.\n';
const ts = header + astToString(await openapiTS(contract)) + '\n' + named.map((name) => `export type ${name} = components['schemas']['${name}'];`).join('\n') + '\n';

// Deliberately bounded Dart model generator: fail on unsupported schema forms
// rather than silently generating an incorrect client. Transport stays in Dio.
function dartType(schema) {
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    if (!named.includes(name)) throw new Error(`Unsupported reference ${schema.$ref}`);
    return name;
  }
  if (schema.nullable || schema.oneOf || schema.anyOf || schema.allOf) throw new Error('Dart generator: composition/nullable schemas require an explicit generator extension.');
  switch (schema.type) {
    case 'string': return 'String';
    case 'integer': return 'int';
    case 'number': return 'double';
    case 'boolean': return 'bool';
    case 'array': return `List<${dartType(schema.items)}>`;
    default: throw new Error(`Unsupported Dart schema ${JSON.stringify(schema)}`);
  }
}
function fromJson(schema, expression) {
  if (schema.$ref) return `${dartType(schema)}.fromJson(Map<String, dynamic>.from(${expression} as Map))`;
  if (schema.type === 'array') return `(${expression} as List).map((value) => ${fromJson(schema.items, 'value')}).toList()`;
  if (schema.type === 'number') return `(${expression} as num).toDouble()`;
  return `${expression} as ${dartType(schema)}`;
}
function toJson(schema, expression) {
  if (schema.$ref) return `${expression}.toJson()`;
  if (schema.type === 'array') return `${expression}.map((value) => ${toJson(schema.items, 'value')}).toList()`;
  return expression;
}
const dartField = (name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const dart = [header, '// ignore_for_file: always_put_required_named_parameters_first, use_null_aware_elements', ''];
for (const [name, schema] of Object.entries(schemas).filter(([name]) => mobileSchemas.has(name))) {
  if (schema.type !== 'object' || !schema.properties) throw new Error(`Expected named object schema: ${name}`);
  const fields = Object.entries(schema.properties);
  const required = new Set(schema.required || []);
  dart.push(`class ${name} {`, `  const ${name}({`);
  for (const [field] of fields) dart.push(`    ${required.has(field) ? 'required ' : ''}this.${dartField(field)},`);
  dart.push('  });', '');
  for (const [field, fieldSchema] of fields) dart.push(`  final ${dartType(fieldSchema)}${required.has(field) ? '' : '?'} ${dartField(field)};`);
  dart.push('', `  factory ${name}.fromJson(Map<String, dynamic> json) => ${name}(`);
  for (const [field, fieldSchema] of fields) {
    const expression = `json['${field}']`;
    dart.push(`    ${dartField(field)}: ${required.has(field) ? fromJson(fieldSchema, expression) : `${expression} == null ? null : ${fromJson(fieldSchema, expression)}`},`);
  }
  dart.push('  );', '', '  Map<String, dynamic> toJson() => {');
  for (const [field, fieldSchema] of fields) dart.push(`    ${required.has(field) ? '' : `if (${dartField(field)} != null) `}'${field}': ${toJson(fieldSchema, dartField(field) + (required.has(field) ? '' : '!'))},`);
  dart.push('  };', '}', '');
}
// Convert the bounded OpenAPI 3.0 schema subset to standard draft-07 JSON
// Schema. Both representations are generated from the same source of truth.
function jsonSchema(value) {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (value === null || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === '$ref' ? entry.replace('#/components/schemas/', '#/definitions/') : jsonSchema(entry)]));
  for (const bound of ['Minimum', 'Maximum']) {
    const key = `exclusive${bound}`;
    const inclusive = bound.toLowerCase();
    if (result[key] === true) {
      result[key] = result[inclusive];
      delete result[inclusive];
    } else if (result[key] === false) delete result[key];
  }
  return result;
}
const schemaHeader = { $schema: 'http://json-schema.org/draft-07/schema#' };
const outputs = {
  'packages/contracts/generated/api.d.ts': ts,
  'packages/contracts/generated/schemas.json': JSON.stringify({ ...schemaHeader, definitions: jsonSchema(schemas) }, null, 2) + '\n',
  'apps/mobile/lib/core/api/generated/models.dart': dart.join('\n'),
};
for (const [file, model] of Object.entries({ world: 'WorldSnapshot', graph: 'Graph', 'paso-request': 'StepRequest', 'paso-response': 'StepResponse' })) {
  outputs[`packages/contracts/generated/${file}.schema.json`] = JSON.stringify({ ...schemaHeader, $ref: `schemas.json#/definitions/${model}` }, null, 2) + '\n';
}
for (const [name, value] of Object.entries(outputs)) {
  const destination = path.join(root, name);
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8').catch(() => '') !== value) throw new Error(`${name} desactualizado: ejecuta npm run contracts:generate.`);
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, value);
  }
}
console.log(`Modelos TypeScript/Dart: ${process.argv.includes('--check') ? 'sincronizados' : 'generados'}.`);
