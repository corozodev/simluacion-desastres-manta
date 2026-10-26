# Design system: Spooky Cloud

La identidad usa fondo oscuro, superficies elevadas, naranja, violeta y cian. La decoración se construye con CSS y recursos locales; no necesita imágenes ni fuentes descargadas desde terceros. La tipografía web declara una pila que comienza por Inter y continúa con fuentes del sistema; no implica que Inter esté instalada. Flutter utiliza la fuente de plataforma.

## Fuentes y derivados

| Origen editable | Derivados; no editar |
| --- | --- |
| `packages/design-tokens/tokens.json` | `packages/design-tokens/generated/tokens.css`, `apps/mobile/lib/core/theme/tokens.g.dart` |
| `packages/design-tokens/brand.json` | `packages/design-tokens/generated/brand.ts`, `apps/mobile/lib/core/theme/brand.g.dart`, `apps/mobile/android/app/src/main/res/values/brand.xml` |

```sh
npm run tokens:generate
npm run generated:check
```

`tools/codegen/tokens.mjs` genera variables CSS de todas las categorías, constantes Dart de colores, espacios, radios, tamaños de texto y duraciones, y la marca en ambos lenguajes. Sombras, breakpoints, pesos y estados también existen en el origen, pero no todas esas categorías se emiten como constantes Dart; Material 3 adapta componentes nativos. No hay dos paletas mantenidas manualmente.

## Paleta

| Token | Valor | Uso |
| --- | --- | --- |
| `background` | `#0B0D14` | Fondo principal |
| `surface` / `surfaceElevated` | `#171B29` / `#222738` | Tarjetas y zonas elevadas |
| `primary` | `#F59E0B` | Acción principal y marca |
| `secondary` | `#8B5CF6` | Acento secundario |
| `accent` | `#22D3EE` | Foco e información técnica |
| `success` / `warning` / `error` | `#22C55E` / `#FBBF24` / `#EF4444` | Estados semánticos |
| `textPrimary` / `textSecondary` | `#F8FAFC` / `#94A3B8` | Texto y metadatos |
| `border` | `#32384B` | Separadores y contornos |

El JSON también define `onPrimary`, `onSecondary`, foco, hover y deshabilitado. Usa texto oscuro sobre el botón naranja y acompaña estados con texto o icono: el color por sí solo no explica un error.

## Escalas y consumo

La unidad base de espacio es 4; los radios van de 8 a 24, más el radio completo. Las duraciones son 120, 200 y 350 ms. CSS genera una regla `prefers-reduced-motion` que reduce las duraciones a cero. Los breakpoints web del origen son 640, 768, 1024 y 1280 px.

React consume variables como `var(--color-primary)` y la marca exportada por `@corodev/design-tokens`. `apps/web/src/components/ui.tsx` concentra botones, tarjetas, campos y estados. Flutter construye `ThemeData` en `apps/mobile/lib/core/theme/app_theme.dart`, con `SpookyTokens` y Material 3; los estados y contenedores compartidos están en `lib/shared/widgets.dart`.

Para renombrar el producto, cambia `brand.json`, regenera y revisa título del navegador, encabezados y diagnóstico de ambos clientes. Los textos globales están centralizados; las etiquetas específicas de cada pantalla siguen en sus componentes.

## Convenciones de interfaz

- Etiqueta visible y error asociado en campos; un placeholder no sustituye la etiqueta.
- Foco visible y acciones accesibles por teclado en web.
- Carga, vacío, error y reintento explícitos para consultas.
- Confirmación del formulario con referencia devuelta por la API.
- Controles deshabilitados durante envío; objetivos táctiles acordes con Material 3.
- Sidebar adaptable en web y navegación inferior en móvil; no se exige una copia de píxeles.

Al cambiar tokens, revisa ambas interfaces con anchuras pequeñas y grandes, textos extensos y estado de error. La coherencia visual no equivale a una auditoría completa de accesibilidad; los resultados ejecutados pertenecen a [validación](../development/validation.md).
