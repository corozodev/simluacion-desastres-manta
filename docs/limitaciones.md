# Limitaciones y pendientes de entrega

[Índice](INDEX.md) · [Pruebas](pruebas.md) · [Nivel PRO](nivel-pro.md) · [Costos](costos.md)

Estado al **27 de octubre de 2026, Ecuador**. La [matriz de pruebas](pruebas.md)
delimita las capacidades verificadas.
El repositorio público y su historial real fueron confirmados durante la
auditoría; los cambios de esta consolidación siguen locales, sin commits ni push.

## Modelo y alcance

- BASE tiene 300 intersecciones/383 aristas reales derivadas de OSM; no representa
  toda la red vial de Manta. FULL_MANTA (9.179/13.452) es experimental y requiere
  habilitación/cupos. Las cuatro zonas son orígenes, no barreras de navegación.
- Refugios ficticios sobre nodos reales; cantidades de zombies, cierres y
  condiciones iniciales son configuraciones del proyecto, no datos confirmados
  del jurado ni indicaciones oficiales de evacuación.
- Peatones avanzan una arista por turno. Distancia y velocidad vial influyen en
  el costo de routing, pero no se integra movimiento físico en m/s. Camionetas
  avanzan hasta dos aristas: doble avance topológico, sin demostrar doble velocidad
  física para calles de distinta longitud/tipo.
- La predicción usa posiciones/recorridos observados, hasta dos turnos. No conoce
  sleepers dormidos, eventos privados, PRNG ni decisiones futuras. Probabilidades
  sin calibrar pueden causar desvíos innecesarios. A* temporal es acotado y no
  garantiza el óptimo sobre todos los paseos posibles.
- Flota 5×4 experimental, excluida de `official`. Abordar no implica evacuar:
  sólo entregar con plaza en refugio incrementa evacuados. Pasajeros siguen
  expuestos. Las mediciones incluyen regresiones; implementar PRO no garantiza
  mayor supervivencia ni evacuación.
- La hidráulica conserva masa en malla separada del grafo vial; relieve, costa,
  cauce y lluvia son sintéticos. Susceptibilidad oficial es contexto independiente,
  no elevación verificada ni inundación actual. Reportes ciudadanos nuevos quedan
  pendientes y no modifican motores automáticamente.

## Operación y evidencia

- Sesiones, PRNG, cachés y publicación viven en RAM. Reiniciar pierde ejecuciones;
  los reportes ciudadanos tienen persistencia privada independiente. Cuotas/TTL
  limitan retención y los espectadores no prolongan la sesión.
- `/estado` y `/paso` públicos conservan el runtime preparado e inactivo. Las
  sesiones React tienen estado propio y decisiones HTTP loopback internas: no
  asociar una petición pública a `/paso` con el mapa de otra sesión.
- El token opaco de una simulación propia sólo se conserva en `sessionStorage`.
  Claves administrativas y `x-api-key` nunca van en frontend, enlaces o exports.
  La clave del jurado se entrega fuera del repositorio público.
- P95/disponibilidad documentados proceden de HTTP local. No certifican WAN,
  disponibilidad mensual ni capacidad EC2 de 2 vCPU/8 GiB. `GOMAXPROCS=2` sólo
  limita paralelismo Go. La prueba de quince minutos nominales está documentada;
  esta consolidación midió escenarios acelerados completos.
- Chromium con perfiles iPhone/Pixel no es Safari real. APK debug construido no
  implica validación física ni distribución Android firmada.
- Informes de fases son evidencia histórica; no sustituyen las pruebas de la
  versión de entrega. El evaluador zombie FASE 1 permanece congelado.

## Entrega obligatoria y campos del propietario

| Requisito | Evidencia / estado | Acción antes de enviar |
| --- | --- | --- |
| Repositorio público | CONFIRMADO mediante lectura GitHub `get_repo` | Publicar los cambios revisados de esta consolidación |
| Historial real | CONFIRMADO: 80 commits existentes, HEAD de partida `b26ff44`; intactos | Revisar diff y autorizar commits/push; no se crearon automáticamente |
| README completo | LISTO LOCAL | Revisar y publicar con la versión de entrega |
| Arquitectura enlazada | LISTO LOCAL: documento, fuente editable y SVG | Publicar junto con README |
| Captura AWS Budget | PENDIENTE: no existe `docs/budget.png` | Incorporar captura auténtica sanitizada y verificar alerta |
| Costos mensuales | MODELO DOCUMENTADO: USD 77,68/mes bajo los supuestos de [costos](costos.md) | Validar recursos, horas, tarifas y rubros variables; no equivale a factura |
| Gasto real del evento | PENDIENTE: Budget consultado a nivel de cuenta, sin atribución al proyecto | Completar cifra, período, fecha y fuente de consola |
| URL pública | CONFIRMADO: web y health previos devolvieron HTTP 200; versión nueva sin publicar | Revisar desde otra red; desplegar sólo con autorización y verificar artefacto elegido |
| `POST /paso` documentado | LISTO LOCAL, autenticación preservada | Provisionar clave fuera del repositorio y acordar runtime de evaluación |
| Simulador documentado | LISTO LOCAL, rondas completas aceleradas medidas | Ejecutar los quince minutos nominales si se requiere esa evidencia |
| Método de medición | LISTO LOCAL en [pruebas](pruebas.md) | Confirmar definición del jurado para supervivencia/eficiencia y aceptación del modelo vehicular |
| Presentación PDF/PPT/PPTX ≤20 MB | PENDIENTE: no hay archivo de presentación | Preparar y adjuntar; no se generaron diapositivas |

Antes de publicar, revisar el diff, completar los campos pendientes y ejecutar
`make verify` sobre la versión final. Después del push autorizado, comprobar los
enlaces y archivos públicos. El despliegue requiere autorización independiente;
no confundir una verificación HTTP con publicación de esta consolidación.

Entrega indicada: **miércoles 28 de octubre de 2026, 10:00 (Ecuador)**.
Pitch indicado: **viernes 30 de octubre, ULEAM**. Fechas proporcionadas por el
propietario; no se afirma verificación externa del calendario del evento.
Cualquier push o despliegue requiere autorización expresa.
