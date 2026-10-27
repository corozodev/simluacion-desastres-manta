# ADR-004 — persistencia del MVP de novedades

Estado: decisión previa a la implementación de FASE 4C.

No existe una base de datos ni persistencia de dominio en el backend actual. Las simulaciones son procesos con RAM autoritativa. El despliegue conservado define un volumen raíz EBS gp3 cifrado de 20 GiB (`deploy/aws/stack.yaml`); el contenedor actual tiene raíz de sólo lectura y no monta un directorio de datos persistente para incidentes.

El MVP utilizará un único escritor Go con un snapshot JSON versionado en un directorio privado explícito, permisos 0700/0600, exclusión entre procesos y reemplazo atómico con sincronización a disco. El éxito HTTP se devolverá sólo después de persistir. Las claves de idempotencia se guardarán como hashes privados y no se publicarán identificadores de reporteros. No se almacenarán fotografías.

En desarrollo, el directorio será `services/evacuation/private/incidents`, fuera de Git y fuera del directorio temporal de binarios del launcher. Sobrevive al reinicio del servicio. En una futura ejecución EC2 se necesita un bind mount escribible y persistente sobre el EBS existente; no se modifica ni despliega ahora el servicio publicado.

Impacto: no se crea una base administrada, bucket, rol, servicio o ampliación de disco en esta fase. Los archivos consumen espacio e I/O del volumen ya aprovisionado; no se atribuye costo cero al alojamiento AWS. Ampliaciones, snapshots, copias externas o más tráfico podrían añadir cargos y requieren una decisión posterior. Esta elección evita contratar nueva infraestructura para el prototipo y se limita mediante cuotas y retención documentadas.

No proporciona alta disponibilidad, acceso concurrente desde varios procesos, respaldo automático ni supervivencia a pérdida/eliminación del volumen. `DeleteOnTermination:true` en la plantilla importa: persistir tras reinicio no equivale a resistir destrucción de la instancia. Un archivo corrupto debe impedir el arranque del servicio de incidentes; no se sustituye silenciosamente por un almacén vacío. Una futura base de datos requerirá mantener los contratos e idempotencia, y una migración explícita del archivo validado.
