import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = async (name) => JSON.parse(await readFile(path.join(root, 'packages/design-tokens', name), 'utf8'));
const tokens = await read('tokens.json');
const brand = await read('brand.json');

// Validate before building or writing any output: the CSS and Dart generators
// deliberately support this small shared vocabulary rather than arbitrary JSON.
const fail = (name, expected) => { throw new Error(`Design tokens: ${name} debe ser ${expected}.`); };
const object = (value, name, required, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name, 'un objeto');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${name}.${key}`, 'definido');
  if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name}.${key}`, 'una categoría soportada');
  return Object.entries(value);
};
const textValue = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail(name, 'texto no vacío sin caracteres de control');
};
const cssValue = (value, name) => {
  textValue(value, name);
  if (/[;{}<>]/.test(value)) fail(name, 'un valor CSS sin declaraciones adicionales');
};
const number = (value, name, min, max = Infinity, integer = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(name, `un número ${integer ? 'entero ' : ''}entre ${min} y ${max}`);
  }
};
const scale = (name, value, required, validate, keyPattern = /^[a-zA-Z][a-zA-Z0-9]*$/) => {
  for (const [key, entry] of object(value, name, required)) {
    if (!keyPattern.test(key)) fail(`${name}.${key}`, 'un nombre de token válido');
    validate(entry, `${name}.${key}`);
  }
};
const categories = ['color', 'font', 'space', 'radius', 'shadow', 'breakpoint', 'duration', 'easing', 'state'];
object(tokens, 'tokens', categories, categories);
scale('color', tokens.color, ['background', 'surface', 'surfaceElevated', 'primary', 'secondary', 'accent', 'success', 'warning', 'error', 'textPrimary', 'textSecondary', 'border', 'onPrimary', 'onSecondary', 'focus', 'primaryHover', 'disabled'], (value, name) => {
  if (typeof value !== 'string' || !/^#[\dA-Fa-f]{6}$/.test(value)) fail(name, 'un color #RRGGBB');
});
const fontGroups = ['family', 'size', 'weight', 'lineHeight'];
object(tokens.font, 'font', fontGroups, fontGroups);
scale('font.family', tokens.font.family, ['sans', 'mono'], cssValue);
scale('font.size', tokens.font.size, ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'], (value, name) => number(value, name, 1, 256, true), /^[a-zA-Z0-9]+$/);
scale('font.weight', tokens.font.weight, ['regular', 'medium', 'semibold', 'bold'], (value, name) => number(value, name, 1, 1000, true));
scale('font.lineHeight', tokens.font.lineHeight, ['body', 'heading'], (value, name) => number(value, name, 1, 3));
scale('space', tokens.space, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '16', '20'], (value, name) => number(value, name, 0, Infinity, true), /^\d+$/);
scale('radius', tokens.radius, ['sm', 'md', 'lg', 'xl', 'full'], (value, name) => number(value, name, 0, Infinity, true));
scale('shadow', tokens.shadow, ['card', 'glow', 'elevated'], (value, name) => {
  cssValue(value, name);
  if (!/^(?:0|-?\d+(?:\.\d+)?px) (?:0|-?\d+(?:\.\d+)?px) (?:0|\d+(?:\.\d+)?px) #[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(value)) {
    fail(name, 'una sombra «x y blur #RRGGBB[AA]»');
  }
});
scale('breakpoint', tokens.breakpoint, ['sm', 'md', 'lg', 'xl'], (value, name) => number(value, name, 1, Infinity, true));
const breakpoints = Object.values(tokens.breakpoint);
if (breakpoints.some((value, index) => index > 0 && value <= breakpoints[index - 1])) fail('breakpoint', 'una escala ascendente');
scale('duration', tokens.duration, ['fast', 'normal', 'slow'], (value, name) => number(value, name, 0, Infinity, true));
scale('easing', tokens.easing, ['standard'], (value, name) => {
  cssValue(value, name);
  const curve = /^cubic-bezier\(([^)]+)\)$/.exec(value)?.[1].split(',').map((part) => part.trim());
  if (!curve || curve.length !== 4 || curve.some((part) => part === '' || !Number.isFinite(Number(part)))) fail(name, 'una curva cubic-bezier de cuatro números');
  for (const index of [0, 2]) number(Number(curve[index]), name, 0, 1);
});
scale('state', tokens.state, ['disabledOpacity', 'hoverOpacity', 'pressedOpacity'], (value, name) => number(value, name, 0, 1));
scale('brand', brand, ['team', 'name', 'subtitle', 'version', 'overviewTitle', 'description'], textValue);

const generated = '// GENERATED from packages/design-tokens. Do not edit.\n';
const pascal = (name) => name[0].toUpperCase() + name.slice(1);
const dartString = (value) => JSON.stringify(value).replaceAll('$', '\\$');
const xmlText = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const css = [generated.replace('//', '/*').trimEnd() + ' */', ':root {'];
for (const [group, values] of Object.entries(tokens)) {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'object') {
      for (const [subkey, subvalue] of Object.entries(value)) {
        css.push(`  --${group}-${key}-${subkey}: ${subvalue}${group === 'font' && key === 'size' ? 'px' : ''};`);
      }
    } else {
      const unit = ['space', 'radius', 'breakpoint'].includes(group) ? 'px' : group === 'duration' ? 'ms' : '';
      css.push(`  --${group}-${key}: ${value}${unit};`);
    }
  }
}
css.push('}', '@media (prefers-reduced-motion: reduce) {', '  :root { --duration-fast: 0ms; --duration-normal: 0ms; --duration-slow: 0ms; }', '}', '');
const dart = [generated, "import 'package:flutter/material.dart';", '', 'abstract final class SpookyTokens {'];
for (const [key, value] of Object.entries(tokens.color)) {
  dart.push(`  static const Color ${key} = Color(0xFF${value.slice(1)});`);
}
for (const [key, value] of Object.entries(tokens.space)) dart.push(`  static const double spacing${key} = ${value}.0;`);
for (const [key, value] of Object.entries(tokens.radius)) dart.push(`  static const double radius${pascal(key)} = ${value}.0;`);
for (const [key, value] of Object.entries(tokens.font.size)) dart.push(`  static const double fontSize${pascal(key.replace(/^(\d)/, 'n$1'))} = ${value}.0;`);
for (const [key, value] of Object.entries(tokens.duration)) dart.push(`  static const Duration duration${pascal(key)} = Duration(milliseconds: ${value});`);
// Native platform fonts avoid bundling or fetching an external font.
dart.push(`  static const String fontFamilySans = ${dartString(tokens.font.family.sans.split(',')[1]?.trim() === 'ui-sans-serif' ? 'sans-serif' : tokens.font.family.sans.split(',')[0])};`, '}', '');
const brandDart = [generated, 'abstract final class AppBrand {', ...Object.entries(brand).map(([key, value]) => `  static const String ${key} = ${dartString(value)};`), '}', ''].join('\n');
const outputs = {
  'packages/design-tokens/generated/tokens.css': css.join('\n'),
  'packages/design-tokens/generated/brand.ts': generated + `export const brand = ${JSON.stringify(brand, null, 2)} as const;\n`,
  'apps/mobile/lib/core/theme/tokens.g.dart': dart.join('\n'),
  'apps/mobile/lib/core/theme/brand.g.dart': brandDart,
  'apps/mobile/android/app/src/main/res/values/brand.xml': `<?xml version="1.0" encoding="utf-8"?>\n<!-- GENERATED from packages/design-tokens/brand.json. Do not edit. -->\n<resources>\n  <string name="app_name">${xmlText(JSON.stringify(brand.name))}</string>\n</resources>\n`,
};
for (const [name, value] of Object.entries(outputs)) {
  const destination = path.join(root, name);
  if (process.argv.includes('--check')) {
    const actual = await readFile(destination, 'utf8').catch(() => '');
    if (actual !== value) throw new Error(`${name} está desactualizado. Ejecuta npm run tokens:generate.`);
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, value);
  }
}
console.log(`Design tokens y marca: ${process.argv.includes('--check') ? 'sincronizados' : 'generados'}.`);
