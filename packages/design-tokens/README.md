# Spooky Cloud: tokens e identidad

`tokens.json` es la fuente visual compartida y `brand.json` concentra el equipo,
nombre del producto, subtítulo, versión y textos globales de presentación. Edita
estas fuentes y regenera desde la raíz; no modifiques las salidas a mano.

```bash
npm run tokens:generate
npm run generated:check
```

El segundo comando también comprueba los contratos HTTP. Para comprobar solo
tokens y marca, sin escribir archivos: `node tools/codegen/tokens.mjs --check`.
El generador no requiere servicios externos y rechaza categorías ausentes,
colores inválidos, escalas numéricas incorrectas, opacidades fuera de rango y
textos vacíos antes de escribir sus salidas. Si se añade una categoría nueva,
hay que ampliar su validación y su transformación en el generador.

## Vocabulario compartido

| Categoría | Contenido y unidades |
| --- | --- |
| `color` | Los 12 colores base de la propuesta, más `onPrimary`, `onSecondary`, `focus`, `primaryHover` y `disabled`; valores `#RRGGBB`. |
| `font` | Familias sans/mono, tamaños en píxeles, pesos y alturas de línea sin unidad. |
| `space` | Escala en múltiplos de 4 px, de 4 a 80 px. |
| `radius` | Radios de 8, 12, 18, 24 y 999 px. |
| `shadow` | Tarjeta, brillo y elevación; formato CSS `x y blur #RRGGBB[AA]`. |
| `breakpoint` | Referencias web `sm`, `md`, `lg`, `xl` en píxeles. |
| `duration`, `easing` | Duraciones de 120/200/350 ms y curva de transición moderada. |
| `state` | Opacidades para deshabilitado, hover y pulsación, entre 0 y 1. |

La semántica de éxito, advertencia y error pertenece a la misma paleta. El
naranja identifica acciones principales, el violeta añade profundidad y el
cian identifica conexión o foco. Los estados llevan texto o iconos además de
color. Las decoraciones se construyen con CSS e iconos locales.

## Salidas y consumo

| Salida generada | Uso |
| --- | --- |
| `generated/tokens.css` | Todas las categorías como variables `--color-primary`, `--space-4`, `--font-size-base`, etc.; se importa mediante `@corodev/design-tokens/styles.css` en React. Incluye duraciones cero para `prefers-reduced-motion`. |
| `generated/brand.ts` | Objeto `brand` tipado, importable mediante `@corodev/design-tokens/brand`; también alimenta título y descripción HTML en Vite. |
| `apps/mobile/lib/core/theme/tokens.g.dart` | `SpookyTokens`: toda la paleta, espaciado, radios, tamaños de texto, duraciones y familia sans. `app_theme.dart` adapta estos valores a Material 3. |
| `apps/mobile/lib/core/theme/brand.g.dart` | `AppBrand`: identidad y textos usados en widgets y título de `MaterialApp`. |
| `apps/mobile/android/app/src/main/res/values/brand.xml` | Nombre del launcher Android; el manifiesto referencia `@string/app_name`. |

React y Flutter no mantienen paletas independientes: ambos reciben exactamente
los mismos colores desde JSON. Las composiciones usan mezclas u opacidades de
esos colores. El tema Flutter conserva métricas y comportamiento de Material 3;
las sombras CSS, breakpoints, pesos, interlineados, curva CSS y opacidades de
estado no se convierten a constantes Dart en esta iteración. Los layouts web
también incluyen umbrales propios para ajustar su contenido; las referencias
de breakpoint no son una sustitución automática de las media queries.

No se descarga ni empaqueta Inter. La web emplea la primera fuente disponible
en su stack y Flutter usa la familia sans del sistema. La consistencia se basa
en jerarquía, color y escala, con las adaptaciones propias de cada plataforma.
La web desactiva animaciones y transiciones si el usuario solicita menos
movimiento; Flutter conserva el comportamiento de accesibilidad de Material.

## Cambiar el nombre o la marca

1. Edita `brand.json` y, si cambia la identidad visual, `tokens.json`.
2. Ejecuta `npm run tokens:generate` y `npm run generated:check`.
3. Revisa ambos clientes y su metadata después de reconstruirlos.

La metadata estática de Flutter web (`apps/mobile/web/index.html` y
`manifest.json`) y los SVG de favicon de ambos clientes son fuentes manuales:
revisa sus textos y colores al cambiar la marca. El manifiesto web conserva los
colores de arranque equivalentes al fondo del token. No los cambia el generador.
Los recursos de launcher Android en `mipmap-*` también se reemplazan manualmente
si cambia el símbolo; el nombre Android sí se genera. Los identificadores de
paquete, versiones de distribución y permisos nativos no se derivan de la marca.

Al añadir componentes, usa los tokens existentes, conserva foco visible y
etiquetas accesibles, y representa carga, vacío, error y éxito explícitamente.
Evita introducir hexadecimales en los estilos o widgets de la interfaz.
