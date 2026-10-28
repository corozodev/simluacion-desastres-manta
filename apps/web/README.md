# Cliente React — MantaSim

Experiencia web principal del proyecto. [Inicio local](../../docs/development/local-setup.md),
[arquitectura](../../docs/arquitectura.md) y [verificación](../../docs/pruebas.md).
Desde la raíz, `make setup` prepara las dependencias y `make dev` inicia ambos
servicios Go y Vite sin ejecutar simulaciones.

| Ruta | Uso |
| --- | --- |
| `/escape` | Explorar el grafo y crear explícitamente una sesión zombie; pausa, continuación, cancelación y resultados |
| `/flood-lab` | Laboratorio hidráulico independiente; tormenta iniciada explícitamente, refugios candidatos y capas separadas |
| `/mobile` | Espectador táctil de la última ejecución publicada y mapa ciudadano con envío de reportes |

`src/services/api.ts` traduce HTTP usando el contrato generado. TanStack Query
comparte cachés, evita mezclar geografías y conserva el último snapshot ante fallos.
Sólo el token opaco de una sesión propia se conserva en `sessionStorage`; las
claves de `/paso` y administración nunca pertenecen a variables `VITE_`, al
navegador ni a exports. Actualizar una página recupera su sesión y no crea otra.

La API pública permite iniciar simulaciones sin credencial de operador. Moderar
reportes y administrar referencias conserva permisos independientes. El panel de
reportes permite verificar/rechazar/retirar o documentar respaldo oficial; no
ofrece el antiguo control de aplicación experimental al motor. Los pendientes no
representan hechos verificados ni modifican la tormenta automáticamente.

El mapa SVG conserva geometrías OSM, rutas observables y capas diferenciadas.
[Nivel PRO](../../docs/nivel-pro.md): pronóstico optativo de riesgo por nodo,
capacidad con ocupación/reservas y cinco camionetas experimentales con carga y
recorrido real del último turno. La geografía y los refugios de laboratorio no
constituyen navegación oficial de emergencia.

```sh
npm run test -w @corodev/web
npm run typecheck -w @corodev/web
npm run build:web
npm run test:spectators:browser
npm run test:simulations:browser
```

Los dobles HTTP sólo existen en pruebas. Las pruebas de navegador contra Go real
se documentan en la matriz; Chromium y un viewport móvil no acreditan Safari en
un iPhone físico. Flutter Android es un cliente complementario, no una dependencia
de la demo React ni un build Flutter Web.
