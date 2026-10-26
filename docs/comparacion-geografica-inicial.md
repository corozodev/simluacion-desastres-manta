# Comparación geográfica inicial — motor original

Se ejecutó el motor FASE 1 congelado antes de activar el planificador nuevo. Se preservaron semillas, cantidades,150turnos,reglas y capacidades. Para v2 se remapearon posiciones originales y refugios a nodos válidos próximos, registrando cada distancia; las calles de eventos también se relacionan con segmentos reales. No se añadieron carreteras. El puente físico original se conserva por ID.

El grafo comparado es `manta-v2-0ab03290b16a` (300/383). Los refugios de esta comparación son los originales remapeados, no los nuevos destinos distribuidos de los escenarios urbanos. Cambiar topología puede cambiar persecuciones aunque las coordenadas iniciales se mantengan próximas; estos experimentos no son trayectorias idénticas.

**E/M/A = evacuados / mordidos / vivos activos no evacuados**. Vivo incluye evacuado+activo. Distancias en metros, media/máximo del remapeo de sobrevivientes y zombies.

| Ronda | Semilla | v1 E/M/A | v2 E/M/A | v1 proporción viva | v2 proporción viva | Remapeo media/máximo m |
| --- | --- | --- | --- | --- | --- | --- |
| Ronda 1 — Anochecer | 20261026 | 20/0/0 | 20/0/0 | 1.000 | 1.000 | 318.0 / 1081.1 |
| Ronda 1 — Anochecer | 7 | 14/1/5 | 17/0/3 | 0.950 | 1.000 | 510.9 / 1591.7 |
| Ronda 1 — Anochecer | 42 | 18/0/2 | 20/0/0 | 1.000 | 1.000 | 487.3 / 1516.5 |
| Ronda 2 — Medianoche | 20261027 | 23/22/35 | 50/30/0 | 0.725 | 0.625 | 408.5 / 1591.7 |
| Ronda 2 — Medianoche | 7 | 32/30/18 | 44/36/0 | 0.625 | 0.550 | 447.0 / 1591.7 |
| Ronda 2 — Medianoche | 42 | 32/26/22 | 64/16/0 | 0.675 | 0.800 | 382.1 / 1544.7 |
| Ronda 3 — Apocalipsis | 20261028 | 38/150/12 | 58/141/1 | 0.250 | 0.295 | 381.6 / 1591.7 |
| Ronda 3 — Apocalipsis | 7 | 39/147/14 | 35/165/0 | 0.265 | 0.175 | 393.4 / 1591.7 |
| Ronda 3 — Apocalipsis | 42 | 16/135/49 | 65/134/1 | 0.325 | 0.330 | 397.8 / 1544.7 |

No se atribuye automáticamente una mejora de evacuación a una mejora de supervivencia. Cada semilla se publica, incluidas regresiones. La variante intermedia b07b46b93168 se conserva separada y fue sustituida porque omitía conectores troncales de la fuente urbana, no por su puntuación.

Artefactos privados: `reports/phase2/baseline/results.{json,csv}` y `reports/phase2/geography/results.{json,csv}`. Las versiones de código/escenario y posiciones iniciales están incluidas por ejecución. El índice de llamadasHTTP y las latencias se registran aparte del tiempo de planificación/snapshot/turno.

```sh
npm run evaluate -- -graphs data/manta-v1.json -strategies phase1 -output reports/phase2/baseline
npm run evaluate -- -graphs data/manta-v2.json -strategies phase1 -output reports/phase2/geography
```

Las rutas anteriores son relativas al directorio backend por el wrapper npm. No se aplica una fórmula oficial de puntuación porque el enunciado aportado no especifica sus pesos completos; solo se reportan proporciones medidas.
