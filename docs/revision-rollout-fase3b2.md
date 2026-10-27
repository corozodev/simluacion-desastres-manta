# Revisión del rollout FASE 3B.2

**Ejecutado en AWS con autorización expresa el 26 de octubre de 2026.** La instrucción posterior del propietario exige no conservar imágenes de respaldo: se retiraron el contenedor y la imagen anteriores en EC2, además de los archivos duplicados de instalación de imagen. El prompt exige: «No desplegar una modificación que interrumpa la instancia actual sin autorización». El script existente detiene el backend; por ello esta intervención requiere aprobación expresa del propietario.

## Artefactos concretos

| Artefacto | Identidad / SHA-256 |
| --- | --- |
| Imagen `corodev-evacuation:phase3b2`, linux/amd64 | `sha256:83d45642f9974f1744b54f1c6303c86ef09a1a8b9e3e8d0dee8b1299c6164ffb` |
| `deploy/releases/phase3b2-20261026/backend-image.tar.gz` | `05c807e02b07dfc11a581166ecd03333a0fd61794b7fe18ab897cac628b4ac9d` |
| `deploy/releases/phase3b2-20261026/frontend.tar.gz` | `4dbe2c28bda9bd34b4c7ce9c6a3c6dde61cc623b2232a1ea4ba106fc03848357` |
| `apps/web/dist/index.html` | `e3a8a575e3868e0f9a829c3f92e71df654dad81c225ad06bb9f38d3814b267c5` |

El bundle conserva `SHA256SUMS` de imagen y scripts. El frontend contiene la URL HTTPS de Go y ningún secreto. Los archivos privados del operador se generaron aparte con modo 0600; no forman parte del release ni de Git. No se generó o rotó una clave AWS.

## Cambio propuesto al aprobar

1. Volver a comprobar salud, estado final actual y hashes; exportar el snapshot observable vigente. Si existe una ronda activa o cambió el artefacto, detener el procedimiento para revisión.
2. Transferir la imagen verificada por el bucket privado de artefactos existente, sin crear recursos, y verificarla en EC2 antes de cargar Docker.
3. Conservar la clave de `/paso` y actualizar el entorno privado 0600 con identidad/verificador de operador separados, origen HTTPS exacto y `ADMIN_ALLOW_INSECURE_LOOPBACK=false`. Mantener Competición, ronda 3, semilla 20261028, 150 turnos, 2 s, concurrencia interna 16 y dos hilos Go. **`ENABLE_FULL_MODE=false`; `ENABLE_EXPANDED_MODE=false`.**
4. Ejecutar `deploy/rollout.sh` y sus comprobaciones de salud, conservando `LOG_DRIVER=awslogs`, región Ohio y el grupo existente `/corodev/corodev-phase2/backend`. La ejecución detuvo el contenedor anterior, produjo una interrupción breve y reinició Competición desde semilla. La RAM anterior no se recupera; el snapshot exportado conserva sólo observaciones públicas. No se ejecutarán dos simulaciones activas a la vez.
5. Publicar el build React revisado en el bucket web existente: assets antes de `index.html`, políticas de caché actuales e invalidación CloudFront. Preservar versiones y assets anteriores para rollback.
6. Validar públicamente HTTPS/CORS, observaciones, acceso administrativo sin credenciales rechazado y previsualización del maestro. No iniciar otra ronda desde el panel mientras siga activa la de arranque. Revisar logs de ciclo de vida sin exponer secretos.

Caddy, certificados, DNS, IAM, tamaño EC2, límites Docker, stack, plantilla y parámetros CloudFormation permanecen iguales. No hay change set nuevo, ampliación de permisos ni habilitación pública del experimento. Los cargos habituales y transferencia de la infraestructura existente continúan.

## Rollback y límites

El script general contempla un contenedor anterior durante la sustitución. Tras verificar el nuevo, el propietario ordenó eliminar ese respaldo: ya no existen el contenedor anterior ni su imagen en EC2, y tampoco quedan los archivos de imagen de instalación en ese host. La imagen activa permanece porque el contenedor la necesita. La recuperación futura requiere cargar una imagen verificada y arrancar desde semilla; no hay rollback inmediato de imagen anterior ni restauración de RAM. Para React, restaurar el índice/assets previos e invalidar CloudFront. No destruir el stack ante un fallo parcial.

Las rondas locales del maestro funcionaron con concurrencia interna 16; su estrés de 200 clientes saturó el presupuesto y se informa como costo experimental, sin exigirle el objetivo del preset oficial. Este rollout habilitó el selector y el control de Competición; cualquier activación experimental pública será una decisión separada.

Las pruebas, ventanas y limitaciones están en [informe-fase3b2.md](informe-fase3b2.md). La identidad operadora AWS conserva los permisos amplios que el propietario decidió en FASE 3A.2; este trabajo no modifica esa política ni la del rol EC2.

La ronda nueva terminó en 150 turnos con 132/41/27 y cero solicitudes internas inválidas/timeouts. Los hashes revisados se conservaron, CloudFront completó la invalidación y Chromium externo validó selector/autenticación. [Recibo público](../deploy/validation-phase3b2-rollout.json).
