# ADR-004: persistencia de reportes ciudadanos

Estado: implementada. La decisión original precedió a FASE 4C; esta página
explica su aplicación actual, separada de las sesiones de simulación en RAM.

## Decisión

Uso un único escritor Go con snapshot JSON versionado, directorio privado,
permisos 0700/0600, exclusión `flock`, reemplazo atómico y sincronización a disco.
El éxito HTTP se devuelve después de persistir. Las claves idempotentes se guardan
como hashes privados; no se publican identidades de reporteros ni se guardan fotos.

El directorio es `services/evacuation/private/incidents` en desarrollo y un bind
mount escribible bajo `/var/lib/corodev/flood` en EC2. Queda fuera de imágenes,
binarios temporales y Git. La [guía de incidentes](../incidentes-ciudadanos.md)
documenta cuotas, caducidad y revisiones.

## Consecuencias

No se necesita una base administrada para este prototipo de un solo proceso.
Los archivos consumen espacio e I/O del EBS gp3 cifrado existente; no se atribuye
costo cero al alojamiento. No ofrece alta disponibilidad, varios escritores ni
respaldo automático. `DeleteOnTermination:true` significa que persistir tras un
reinicio no protege frente a pérdida del volumen o retirada de la instancia.

La corrupción impide iniciar el almacén; no se sustituye silenciosamente por uno
vacío. Cambiar a almacenamiento multiinstancia requiere migración explícita,
conservar idempotencia/contratos y preservar las revisiones nuevas al retroceder.
[Operación, copias y recuperación](../despliegue.md).
