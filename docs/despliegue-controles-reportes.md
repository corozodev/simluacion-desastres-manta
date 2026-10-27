# Publicación de controles y moderación de reportes

El 27 de octubre de 2026 se publicó el código en `main` y se desplegaron los
binarios Go y el frontend de producción del commit
[`e4863a9`](https://github.com/corozodev/simluacion-desastres-manta/commit/e4863a9b35be4b7768a7c3c4e4f51f59e7733525).

- [Laboratorio publicado](https://sistemamanta.lexinnovate.com/flood-lab).
- [Cambios, archivos y limitaciones](refinamiento-controles-reportes.md).
- [Registro de publicación](../deploy/deployment-report-controls-20261027.json).

Se usó la EC2 existente de Ohio y la imagen Docker ya instalada, con los nuevos
binarios montados en sólo lectura. Se conservaron variables privadas, límites,
redes, volúmenes ciudadanos y caducidad. Los contenedores anteriores se retienen
para recuperación. Docker informa backend saludable y laboratorio en ejecución.

El frontend se publicó en el bucket existente, con `index.html` al final y los
recursos anteriores conservados. La invalidación de CloudFront terminó.

La autorización posterior de despliegue permitió las compilaciones de producción:
Go estático para Linux/amd64 y Vite, sin ejecutar el typecheck del script habitual.
No se ejecutaron tests, lint, formateadores, codegen, benchmarks ni pruebas de
navegador. No se compiló Flutter ni se iniciaron simulaciones para comprobar la
funcionalidad. El estado de los contenedores y la publicación de artefactos no
acreditan la corrección funcional de esta modificación.

El primer intento se revirtió al rechazar Docker los puertos EXPOSE explícitos
con un namespace de red compartido. Se corrigió la recreación, conservando la
herencia de la imagen y la configuración de recursos. El segundo intento terminó
correctamente; los datos ciudadanos no se sustituyeron ni se ejecutaron migraciones.
