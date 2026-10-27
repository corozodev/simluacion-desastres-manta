# Backend Track A

Lee el AGENTS raíz. FASE 2 está autorizada: geografía urbana, diagnóstico, predicción, coordinación y preparación AWS. Biblioteca estándar Go; no añadir almacenamiento ni servicios externos de decisión. Despliegue solo con acceso, cuenta y región autorizados; no iniciar FASE 3.

`internal/world` define modelos y snapshots observables. OpenAPI sigue siendo la fuente de verdad del JSON; cualquier cambio de transporte comienza allí y regenera TypeScript, Dart y JSON Schema. `graph` valida/carga datos; `simulation` es el único escritor; `decision` solo observa; `httpapi` autentica y valida consultas; `application` y `cmd` componen el proceso y HTTP real.

Nunca publicar sleepers dormidos, estado de PRNG ni credenciales. No modificar el mundo desde `/paso`. Toda arista debe existir, ser vecina y transitable, o se conserva el nodo actual. Las goroutines de solicitudes no alteran el orden determinista de resultados. Los fallos y solicitudes de más de 500 ms producen espera.

`data/manta.json` y `manta-v1.*` son históricos y deben permanecer intactos. `tools/geo/urban_manta.py` genera maestro urbano, operativo `manta-v2` (~300 nodos) y experimental ampliado; conservar caché, geometría, checksum y procedencia. No contraer intersecciones reales como un movimiento. Las cuatro zonas son orígenes, no fronteras de navegación. Las fixtures sintéticas pertenecen a pruebas; los refugios son ficticios sobre nodos reales.

El planificador global prepara destinos/reservas antes de publicar. Las consultas HTTP leen el plan coherente y no reservan plazas. `internal/evaluation/phase1` está congelado para comparación, no es una estrategia de producción alternativa. Los diagnósticos privados pueden incluir posiciones de sleepers iniciales y jamás deben servirse desde endpoints, S3 público o clientes. Aislar cambios de mapa/refugios/aparición frente a cambios algorítmicos y publicar también regresiones.

Ejecutar desde aquí `go test ./...`, `go test -race ./...`, `go vet ./...` y `go build ./...`; desde la raíz existen scripts npm equivalentes. Formatear Go. Las pruebas de integración deben usar HTTP con `x-api-key`; no sustituirlas por llamadas directas. No comparar percentiles para verificar determinismo. Documentar reglas ambiguas en `docs/reglas-simulacion.md` y limitaciones de rutas en `docs/algoritmo.md`.

## FASE 3B.2 autorizada
El catálogo aprobado distingue competition (300/383), full (9179/13452) y expanded (1000/1599). Competición conserva los escenarios originales. No cambiar `/paso`, geografía fuente, reglas zombie ni algoritmos al modificar el control. `internal/control` serializa rondas, autentica operador con una credencial independiente y conserva diez finales observables en RAM. Los experimentales están deshabilitados por defecto; no habilitarlos en producción si fallan las mediciones. Despliegues que interrumpan la instancia requieren autorización expresa del propietario.
