.PHONY: help setup dev stop test smoke verify

help: ## Mostrar comandos locales
	@node tools/scripts/local.mjs help
setup: ## Verificar herramientas, instalar dependencias y preparar configuración
	@node tools/scripts/local.mjs setup
dev: ## Iniciar Go, laboratorio y React; Ctrl+C para detener
	@npm run dev:lab
stop: ## Detener únicamente los procesos de make dev, sin borrar datos
	@node tools/scripts/local.mjs stop
test: ## Ejecutar pruebas JavaScript y Go
	@node tools/scripts/local.mjs test
smoke: ## Comprobar el entorno local activo, incluido /paso autenticado
	@node tools/scripts/local.mjs smoke
verify: ## Contratos, derivados, pruebas, race, integraciones y builds web/Go
	@node tools/scripts/local.mjs verify
