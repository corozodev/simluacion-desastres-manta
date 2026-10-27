# Catálogo visual compartido — FASE 6A

`catalog.json` es la fuente portable para React y futuros consumidores Flutter.
Los PNG están en `apps/web/public/visualization/`; las rutas del catálogo son
relativas a ese directorio. Flutter conserva símbolos Canvas estáticos y no
requiere descargar ni registrar estos atlas para observar el runtime legacy.

Cada entrada incluye dimensiones de celda, frames, FPS, anclaje normalizado,
filas cardinales, estados gráficos (idle/moving, no estados nuevos del motor),
URL de publicación y descarga, autor, declaración CC0, SHA-256 de origen y salida,
transformaciones y fallback. El catálogo no contiene posiciones ni credenciales.

| Recurso incorporado | Autor / fuente | Salida |
| --- | --- | --- |
| zombie | [SpriteAttack / FreeArt](https://opengameart.org/content/freeart-topdown-zombies) | 256×256, 4×4 celdas, 19.048 B |
| survivor | [Danilo Mattos / Sora](https://opengameart.org/content/simple-animated-character) | 256×256, 4×4 celdas, 5.763 B |
| ripples | [AmberFallStudio / Lake](https://opengameart.org/content/pixel-art-lake-assets) | 128×32, 4 celdas, 387 B |

Las cinco páginas solicitadas se consultaron el 27/10/2026 y declaran CC0. Los
archivos descargados no contienen otro texto de licencia: la evidencia es la
declaración enlazada en la página de cada autor. Se conserva esa distinción;
no se inventó un LICENSE original. [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
permite redistribuir y adaptar los recursos.

También se inspeccionaron y descartaron del runtime:

- [Animated Top Down Zombie / Riley Gombart](https://opengameart.org/content/animated-top-down-zombie): alternativa CC0; no se incorporaron ataques.
- [Animated Water Texture / YCbCr](https://opengameart.org/content/animated-water-texture-128px): CC0, ZIP con 40 PNG de 128² aunque su página anuncia 30. Se prefirieron ondas pequeñas sobre segmentos afectados para no sugerir superficies observadas de agua.

Optimización: zombie usa frames GIF 0/2/4/6, convertidos a PNG indexado de 256
colores con transparencia; sus direcciones se derivan por rotación (no son
animaciones adicionales del autor). Sora conserva cuatro frames y sus cuatro
direcciones originales; se excluyen ataques. Las ondas conservan sus cuatro
frames transparentes. Total: **25.198 bytes**, sin GIF ni dependencias de juegos.

React comparte símbolos SVG por recurso/dirección, cambia únicamente sus frames
a 4 FPS y conserva un símbolo vectorial estático si falla una imagen. Los hashes,
transparencia y dimensiones se comprueban en `visualization.test.tsx`.
