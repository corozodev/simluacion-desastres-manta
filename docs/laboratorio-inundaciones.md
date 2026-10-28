# Laboratorio de inundaciones

[Desarrollo local](despliegue.md#desarrollo-local) · [Contrato HTTP](contratos.md) · [Modelo hidráulico](informe-fase8.md)

El laboratorio extiende la evacuación sobre OSM a escenarios de lluvia y agua
superficial. Es un experimento con relieve, costa, cauce y meteorología sintéticos;
no es un sistema oficial de alerta ni una recomendación de navegación.

## Uso desde React

1. Ejecuta `make setup` y `make dev`; abre `http://127.0.0.1:5173/flood-lab`.
2. Explora BASE o el maestro experimental y configura lluvia, agentes, duración,
   comportamiento y semilla. La vista previa no inicia un motor.
3. Pulsa **Iniciar tormenta**. El mapa recibe estado, profundidades, vías, agentes,
   rutas y plazas calculados por Go. La ruta seleccionada sigue aristas publicadas.
4. Usa pausa y continuación. Cancelar exige confirmación y conserva un final;
   la cancelación repetida no vuelve a cerrar el motor. Reiniciar prepara el paso
   cero; repetir vuelve a ejecutar la configuración activa. Las ediciones del
   formulario se aplican al iniciar otra tormenta, con confirmación de reemplazo.
5. Abre `/mobile` o Android para observar la misma tormenta publicada. El visor
   no crea motores ni controla el reloj.

El laboratorio tiene un motor compartido independiente de las sesiones zombie.
Una sesión `urban_flood` de `/v1/simulations` es otro runtime: no se confunde con
la tormenta de `/lab/published`. Los controles públicos conservan Origin/Host,
cuotas, exclusión mutua y `expected_run_id`; una respuesta atrasada no autoriza
modificar una ejecución nueva. La moderación mantiene autorización independiente.

## Parámetros y relojes

`rainfall_runoff_2d` es el modelo predeterminado; `compound_flood_2d` añade mar y
cauce. No existe un runtime radial alternativo. La malla conserva masa y se
preprocesa aparte del grafo; el snapshot publica profundidades y balance.

Los perfiles son `storm`, `constant` y `pulse`; los comportamientos de evacuación,
`preventive`, `late` y `adaptive`. La intensidad 0–1 representa 0–120 mm/h de
escenario, sin calibración meteorológica. Los límites públicos de duración son
**30–3.000 turnos**, predeterminado 150, sin terminar antes por agentes terminales.

Distingue tres tiempos: turnos de evacuación, segundos hidrológicos por turno
(predeterminado 60) e intervalo de reproducción. Cambiar la reproducción no
multiplica la lluvia ni el tiempo físico. El reloj real activo incluye cálculo y
esperas y excluye pausas. [Ecuaciones, umbrales, resolución y límites](informe-fase8.md).

## Cuatro refugios candidatos

El editor propone ubicaciones sobre la red y solicita validación real al backend:
cuatro IDs y nodos distintos, coordenadas finitas, capacidad de 1–200, calle base
transitable, ajuste máximo de 500 m y accesibilidad dirigida desde la red validada.
Un punto alejado, duplicado o inaccesible se rechaza; una edición invalida la
validación previa. Las propuestas requieren confirmación y sólo se aplican al
crear otra ejecución, sin trasladar ocupantes de una ronda activa.

Una conexión vial válida no certifica elevación, seguridad o uso oficial del lugar.
Los refugios originales y personalizados son supuestos del escenario.

## Comparación conservada en la API

`POST /lab/comparisons` conserva la comparación asíncrona de refugios originales
frente a candidatos validados. La interfaz actual retiró el panel A/B; la capacidad
sigue disponible por HTTP, sin añadir un simulador en React. La comparación usa
población/orígenes congelados, semilla y configuración común y conserva hashes.
Para aislar ubicación, mantén iguales grafo y capacidades; cambiar cobertura o
capacidad cambia también las condiciones del experimento.

Los tiempos de `Step` completo no son latencias de `/paso`. Una mayor evacuación
en una configuración no prueba superioridad general ni habilita los refugios.
Los resultados y métricas históricas permanecen en los JSON de `deploy/`.

## Capas, datos y verificación

El mapa separa profundidad sintética, condiciones viales, ruta seleccionada,
agentes, refugios, reportes ciudadanos y referencia histórica SNGR. La referencia
no añade agua ni cambia elevaciones. Los reportes pendientes tampoco alteran
motores automáticamente. [Fuentes](datos-oficiales-y-demo.md) · [Incidentes](incidentes-ciudadanos.md).

La geografía se cachea por versión y se obtiene aparte del polling; el historial
acota métricas, sin guardar un mapa completo por turno. Los fallos del raster
opcional conservan vectores OSM y atribución. Las lecturas no descargan fuentes
externas por turno.

`npm run test:contracts:flood`, `npm run test:lab:flood` y
`npm run bench:hydrology` reproducen verificaciones distintas: transporte,
interfaz/controles y escenarios hidráulicos completos. Sus ejecuciones previas y
límites están en [pruebas](pruebas.md); esta limpieza no volvió a ejecutarlas.
