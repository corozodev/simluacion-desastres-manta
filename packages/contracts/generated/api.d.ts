// GENERATED from packages/contracts/openapi.yaml. Do not edit.
export interface paths {
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Métricas agregadas del ejecutor; sin IDs de sesión ni credenciales. */
        get: operations["getSimulationMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Comprueba la disponibilidad del proceso Go. */
        get: operations["getEvacuationHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/estado": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Snapshot público observable; nunca revela sleepers dormidos. */
        get: operations["getWorldState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/scenario": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Estado experimental de inundación urbana para polling.
         * @description Snapshot observable del mismo turno publicado por /estado. No incluye el grafo estático; road_conditions referencia sus aristas mediante edge_id. Las exposiciones son índices sintéticos normalizados, no profundidades del agua ni umbrales certificados de seguridad. El escenario zombie devuelve 404. Consultar graph_version y world_version para sincronizar.
         */
        get: operations["getScenarioState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/grafo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Grafo estático versionado; bloqueos dinámicos se consultan en /estado. */
        get: operations["getWorldGraph"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/paso": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Decide un vecino transitable o espera en el nodo actual.
         * @description No muta el mundo. El turno y nodo deben coincidir con el sobreviviente activo del snapshot publicado. Tiempo máximo de la llamada 500 ms.
         */
        post: operations["decideNextStep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Comprueba la disponibilidad de la API. */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/demo/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista elementos de demostración con búsqueda y paginación. */
        get: operations["listDemoItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/demo/items/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Obtiene un elemento por su identificador. */
        get: operations["getDemoItem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/demo/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Valida y acepta un formulario de demostración sin persistencia. */
        post: operations["submitDemo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/simulation/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catálogo aprobado; previsualizar no inicia una ronda. */
        get: operations["getSimulationCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/simulation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Ejecución actual y configuración pública. */
        get: operations["getSimulationInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/estado": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Snapshot observable conservado de una ronda terminada; historial acotado en memoria. */
        get: operations["getCompletedRunState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Estado de sesión; sólo una sesión válida recibe token CSRF. */
        get: operations["getOperatorSession"];
        put?: never;
        /** Intercambia un código independiente generado en servidor por cookie HttpOnly. Requiere Origin permitido y JSON; tiene límite de intentos. */
        post: operations["createOperatorSession"];
        /** Revoca la sesión y su cookie; requiere Origin y CSRF. */
        delete: operations["deleteOperatorSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inicia sólo entre rondas; no interrumpe una ejecución ni permite rutas de archivo arbitrarias. */
        post: operations["startSimulationRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Crea o recupera una sesión efímera local del laboratorio. */
        get: operations["getLabSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Configuraciones experimentales y grafos revisados del laboratorio. */
        get: operations["getLabCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/graph": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Geografía real del modo o de la ejecución del laboratorio. */
        get: operations["getLabGraph"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Estado real, reloj, timeline y comparación del laboratorio. */
        get: operations["getLabState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Inicia una tormenta con configuración validada.
         * @description Sólo servidor experimental loopback. Requiere sesión HttpOnly, Origin permitido y cabecera X-CSRF-Token.
         */
        post: operations["startLabRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pausa, continúa, reinicia, repite o cambia el intervalo real.
         * @description Sólo servidor experimental loopback. Requiere sesión HttpOnly, Origin permitido y cabecera X-CSRF-Token.
         */
        post: operations["controlLabRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/candidates/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Valida y ajusta cuatro candidatos a la red vial.
         * @description Sólo servidor experimental loopback. Requiere sesión HttpOnly, Origin permitido y cabecera X-CSRF-Token.
         */
        post: operations["validateLabCandidates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/comparisons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Compara originales y personalizados con orígenes y amenaza congelados.
         * @description Sólo servidor experimental loopback. Requiere sesión HttpOnly, Origin permitido y cabecera X-CSRF-Token.
         */
        post: operations["compareLabShelters"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/incidents/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Área y límites del servicio experimental de reportes. */
        get: operations["getIncidentServiceInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/incidents/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Relaciona coordenadas declaradas con calles OSM; no certifica su veracidad. */
        post: operations["resolveIncidentLocation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/incidents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulta novedades declaradas; no son hechos oficiales confirmados. */
        get: operations["listIncidents"];
        put?: never;
        /** Registra un reporte ciudadano pendiente; fuerza procedencia citizen. */
        post: operations["createCitizenIncident"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/incidents/{incident_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detalle público con ubicación aproximada y sin identidad del reportero. */
        get: operations["getIncident"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/incidents/synthetic": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Genera una novedad sintética sólo con autorización local. */
        post: operations["createSyntheticIncident"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/incidents/{incident_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Actualiza revisión del prototipo; no convierte citizen en official. */
        post: operations["reviewIncident"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/incidents/{incident_id}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Aplica explícitamente un reporte a una sola ejecución urban_flood. */
        post: operations["applyIncidentToExperimentalRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/reference/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Disponibilidad y procedencia de referencias oficiales; nunca consulta Internet en esta solicitud */
        get: operations["getReferenceStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/reference/susceptibility": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Polígonos oficiales en WGS84 desde caché validada, acotados a Manta */
        get: operations["getSusceptibilityReference"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/reference/rain-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Eventos históricos oficiales; no generan cierres ni emergencias activas */
        get: operations["getOfficialRainEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/telemetry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Métricas operativas separadas de resultados deterministas */
        get: operations["getLabTelemetry"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lab/reference/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Solicita actualización asíncrona acotada; requiere sesión local, Origin y CSRF */
        post: operations["refreshOfficialReferences"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Escenarios, grafos, opciones y límites disponibles; no crea ejecuciones. */
        get: operations["getSimulationCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Valida, reserva capacidad y crea una ejecución privada independiente.
         * @description No se inicia ninguna ejecución mediante GET. Idempotency-Key evita duplicados por reintentos: misma clave y configuración repiten el ID y token originales; otra configuración con la misma clave devuelve 409. El token opaco sólo se entrega al crear o repetir esta respuesta; no es una clave administrativa.
         */
        post: operations["createSimulation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Metadatos privados; consultar no avanza turnos. */
        get: operations["getSimulation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Snapshot privado versionado sin repetir la topología estática. */
        get: operations["getSimulationState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}/results": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Resultado privado final para comparación reproducible. */
        get: operations["getSimulationResults"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pausa sin descartar el estado ni avanzar turnos. */
        post: operations["pauseSimulation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Continúa la sesión desde el mismo turno. */
        post: operations["resumeSimulation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancela definitivamente y libera el cupo de ejecución. */
        post: operations["cancelSimulation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/simulations/{simulation_id}/restart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Crea otra sesión con la misma configuración y semilla; conserva la anterior. */
        post: operations["restartSimulation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description Opciones inmutables por sesión zombie. Flota sólo experimental. Omisión conserva predicción y asignación activas, flota apagada. */
        SimulationProOptions: {
            runner_prediction?: boolean;
            shelter_assignment?: boolean;
            rescue_fleet?: boolean;
        };
        RescueVehicle: {
            id: string;
            current_node: string;
            path: string[];
            passenger_ids: string[];
            target_survivor_id: string;
            target_shelter_id: string;
            state: string;
            capacity: number;
        };
        RescueFleetMetrics: {
            pickups: number;
            delivered: number;
            moves: number;
            useful_trips: number;
        };
        /** @description Probabilidades de un modelo observable limitado, no un futuro cierto ni calibración empírica; no incluye sleepers. */
        RunnerForecast: {
            turn: number;
            horizon: number;
            node_risks: {
                node_id: string;
                one_turn_probability: number;
                two_turn_probability: number;
            }[];
            edge_risks: {
                from: string;
                to: string;
                probability: number;
            }[];
        };
        SimulationAnalytics: {
            deaths_by_type: {
                [key: string]: number;
            };
            deaths_by_cause: {
                [key: string]: number;
            };
            replans: number;
            oscillations: number;
            mean_arrival_turn: number;
            mean_route_efficiency: number;
            agents: {
                id: string;
                arrival_turn: number;
                moves: number;
                oscillations: number;
                replans: number;
                route_efficiency: number;
            }[];
            prediction: {
                samples: number;
                hits: number;
                misses: number;
                false_positives: number;
                brier_score: number;
            };
        };
        /** @description Refugio experimental sobre un nodo real transitable y accesible. Reemplaza la ubicación sin modificar la topología ni los orígenes del brote. */
        SimulationCustomShelter: {
            id: string;
            node_id: string;
            capacity: number;
        };
        /** @description Configuración acotada; refuge_ids vacío usa los predeterminados. custom_shelters reemplaza exactamente los cuatro originales, conservando sus IDs; no se combina con una selección parcial de refuge_ids. El snapshot publica sus ubicaciones efectivas sobre la topología estática del perfil. */
        SimulationConfigInput: {
            /** @enum {string} */
            mode?: "official" | "experimental";
            /** @enum {string} */
            zombie_policy?: "classic_random" | "correlated_random_walk" | "adaptive_exploration";
            /** @enum {string} */
            evacuation_algorithm?: "legacy_current" | "baseline_shortest_path" | "dynamic_risk_astar" | "predictive_temporal_astar";
            pro?: components["schemas"]["SimulationProOptions"];
            survivors?: number;
            /** @enum {string} */
            round?: "round1" | "round2" | "round3";
            refuge_ids?: string[];
            custom_shelters?: components["schemas"]["SimulationCustomShelter"][];
            /** @description Parámetro sintético exclusivo de urban_flood; no representa lluvia observada ni un pronóstico. */
            rainfall_intensity?: number;
        };
        SimulationConfig: {
            /** @enum {string} */
            mode?: "official" | "experimental";
            /** @enum {string} */
            zombie_policy?: "classic_random" | "correlated_random_walk" | "adaptive_exploration";
            /** @enum {string} */
            evacuation_algorithm?: "legacy_current" | "baseline_shortest_path" | "dynamic_risk_astar" | "predictive_temporal_astar";
            pro?: components["schemas"]["SimulationProOptions"];
            survivors: number;
            /** @enum {string} */
            round: "round1" | "round2" | "round3";
            refuge_ids: string[];
            custom_shelters?: components["schemas"]["SimulationCustomShelter"][];
            rainfall_intensity?: number;
        };
        SimulationCreateRequest: {
            /** @enum {string} */
            scenario: "zombie_outbreak" | "urban_flood";
            /**
             * @default BASE
             * @enum {string}
             */
            graph_profile: "BASE" | "FULL_MANTA";
            /** @default 20261026 */
            seed: number;
            /** @default 150 */
            max_ticks: number;
            /** @default 2000 */
            tick_interval_ms: number;
            config?: components["schemas"]["SimulationConfigInput"];
        };
        SimulationMetadata: {
            simulation_id: string;
            /** @enum {string} */
            status: "CREATED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";
            tick: number;
            max_ticks: number;
            state_version: number;
            /** @enum {string} */
            scenario: "zombie_outbreak" | "urban_flood";
            /** @enum {string} */
            graph_profile: "BASE" | "FULL_MANTA";
            graph_version: string;
            seed: number;
            tick_interval_ms: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: date-time */
            ended_at?: string;
            /** Format: date-time */
            expires_at: string;
            config: components["schemas"]["SimulationConfig"];
        };
        SimulationCreated: {
            simulation_id: string;
            /** @enum {string} */
            status: "CREATED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";
            tick: number;
            max_ticks: number;
            state_version: number;
            /** @enum {string} */
            scenario: "zombie_outbreak" | "urban_flood";
            /** @enum {string} */
            graph_profile: "BASE" | "FULL_MANTA";
            graph_version: string;
            seed: number;
            tick_interval_ms: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: date-time */
            ended_at?: string;
            /** Format: date-time */
            expires_at: string;
            config: components["schemas"]["SimulationConfig"];
            /** @description Credencial opaca; sólo creación, reinicio o replay idempotente. Nunca se devuelve en consultas ni controles normales. */
            access_token: string;
        };
        SimulationState: {
            runner_forecast?: components["schemas"]["RunnerForecast"];
            simulation_id: string;
            /** @enum {string} */
            status: "CREATED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";
            tick: number;
            max_ticks: number;
            state_version: number;
            /** @enum {string} */
            scenario: "zombie_outbreak" | "urban_flood";
            /** @enum {string} */
            graph_profile: "BASE" | "FULL_MANTA";
            graph_version: string;
            seed: number;
            tick_interval_ms: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: date-time */
            ended_at?: string;
            /** Format: date-time */
            expires_at: string;
            config: components["schemas"]["SimulationConfig"];
            snapshot: components["schemas"]["WorldSnapshot"];
            scenario_state?: components["schemas"]["ScenarioSnapshot"];
        };
        SimulationResults: {
            runner_forecast?: components["schemas"]["RunnerForecast"];
            simulation_id: string;
            /** @enum {string} */
            status: "CREATED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";
            tick: number;
            max_ticks: number;
            state_version: number;
            /** @enum {string} */
            scenario: "zombie_outbreak" | "urban_flood";
            /** @enum {string} */
            graph_profile: "BASE" | "FULL_MANTA";
            graph_version: string;
            seed: number;
            tick_interval_ms: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: date-time */
            ended_at?: string;
            /** Format: date-time */
            expires_at: string;
            config: components["schemas"]["SimulationConfig"];
            snapshot: components["schemas"]["WorldSnapshot"];
            scenario_state?: components["schemas"]["ScenarioSnapshot"];
            results: components["schemas"]["SimulationResultMetrics"];
        };
        SimulationResultMetrics: {
            analytics?: components["schemas"]["SimulationAnalytics"];
            initial_survivors: number;
            evacuated: number;
            bitten: number;
            active: number;
            survival_rate: number;
            refuges_used: number;
        };
        SimulationScenarioCapability: {
            /** @enum {string} */
            id: "zombie_outbreak" | "urban_flood";
            name: string;
            available: boolean;
            synthetic: boolean;
        };
        SimulationGraphProfile: {
            /** @enum {string} */
            id: "BASE" | "FULL_MANTA";
            name: string;
            available: boolean;
            graph_version: string;
            nodes: number;
            edges: number;
            disabled_reason?: string;
        };
        SimulationDefaults: {
            /** @enum {string} */
            scenario: "zombie_outbreak" | "urban_flood";
            /** @enum {string} */
            graph_profile: "BASE" | "FULL_MANTA";
            seed: number;
            max_ticks: number;
            tick_interval_ms: number;
            survivors: number;
            /** @enum {string} */
            round: "round1" | "round2" | "round3";
        };
        SimulationLimits: {
            max_active: number;
            max_full_active: number;
            max_retained: number;
            max_memory_bytes: number;
            min_tick_interval_ms: number;
            max_tick_interval_ms: number;
            max_ticks: number;
            max_survivors: number;
        };
        SimulationCapabilities: {
            scenarios: components["schemas"]["SimulationScenarioCapability"][];
            graph_profiles: components["schemas"]["SimulationGraphProfile"][];
            defaults: components["schemas"]["SimulationDefaults"];
            limits: components["schemas"]["SimulationLimits"];
            rounds: components["schemas"]["SimulationRound"][];
        };
        GraphNode: {
            id: string;
            lat: number;
            lng: number;
        };
        GeoPoint: {
            lat: number;
            lng: number;
        };
        SpawnZone: {
            id: string;
            name: string;
            source: string;
            geometry: components["schemas"]["GeoPoint"][];
            node_ids: string[];
            weight: number;
        };
        GraphEdge: {
            id: string;
            from: string;
            to: string;
            distance_m: number;
            road_type: string;
            speed_mps: number;
            blocked: boolean;
            directed: boolean;
            bridge?: boolean;
            geometry?: components["schemas"]["GeoPoint"][];
        };
        Shelter: {
            id: string;
            node_id: string;
            capacity: number;
            occupancy: number;
            reserved?: number;
            available?: number;
        };
        Graph: {
            version: string;
            source: string;
            nodes: components["schemas"]["GraphNode"][];
            edges: components["schemas"]["GraphEdge"][];
            shelters: components["schemas"]["Shelter"][];
            spawn_zones?: components["schemas"]["SpawnZone"][];
            coverage?: components["schemas"]["GeoPoint"][];
        };
        Zombie: {
            id: string;
            /** @enum {string} */
            type: "walker" | "runner" | "horde" | "sleeper";
            current_node: string;
            movement_state: string;
            awake: boolean;
            /** @description Recorrido del turno incluyendo origen, nodos intermedios y destino. */
            path: string[];
        };
        Survivor: {
            id: string;
            current_node: string;
            /** @enum {string} */
            status: "active" | "bitten" | "evacuated";
            target_shelter_id: string;
            spawn_zone_id?: string;
            vehicle_id?: string;
            planned_route: string[];
        };
        WorldEvent: {
            turn: number;
            type: string;
            entity_id: string;
            edge_id: string;
            message: string;
        };
        WorldMetrics: {
            evacuated: number;
            bitten: number;
            active: number;
            turns: number;
            requests_success: number;
            requests_invalid: number;
            requests_timeout: number;
            http_p50_ms: number;
            http_p95_ms: number;
            http_p99_ms: number;
            availability: number;
        };
        WorldSnapshot: {
            fleet?: components["schemas"]["RescueVehicle"][];
            fleet_metrics?: components["schemas"]["RescueFleetMetrics"];
            /**
             * @description Presente en inundación experimental; ausente en zombie histórico.
             * @enum {string}
             */
            scenario_type?: "urban_flood";
            turn: number;
            world_version: number;
            graph_version: string;
            /** @description Solo zombies visibles; los sleepers dormidos se excluyen completamente. */
            zombies: components["schemas"]["Zombie"][];
            survivors: components["schemas"]["Survivor"][];
            shelters: components["schemas"]["Shelter"][];
            blocked_edges: string[];
            events: components["schemas"]["WorldEvent"][];
            metrics: components["schemas"]["WorldMetrics"];
            simulation?: components["schemas"]["SimulationInfo"];
        };
        FloodZone: {
            id: string;
            center: components["schemas"]["GeoPoint"];
            radius_m: number;
            /** @description Exposición sintética normalizada, no profundidad del agua. */
            intensity: number;
        };
        RoadCondition: {
            edge_id: string;
            /** @enum {string} */
            state: "passable" | "caution" | "blocked";
            risk_score: number;
            risk_source: string;
            updated_at_simulation_step: number;
            cost_multiplier: number;
        };
        ShelterCondition: {
            shelter_id: string;
            /** @enum {string} */
            state: "available" | "full" | "exposed" | "inaccessible";
            risk_score: number;
            updated_at_simulation_step: number;
        };
        FloodAgent: {
            id: string;
            current_node: string;
            /** @enum {string} */
            state: "waiting" | "moving" | "isolated" | "evacuated";
            /** @enum {string} */
            behavior: "preventive" | "late" | "adaptive";
            target_shelter_id: string;
            planned_route: string[];
            /** @description Tiempo simulado de llegada al refugio; ausente hasta evacuar. */
            evacuation_time?: number;
        };
        EvacuationMetrics: {
            total_agents: number;
            evacuated_agents: number;
            isolated_agents: number;
            waiting_agents: number;
            /** @description Media entre agentes evacuados, en unidades del reloj simulado; cero si no hay evacuados. */
            average_evacuation_time: number;
            blocked_edges: number;
            caution_edges: number;
            shelters_at_capacity: number;
            reroute_count: number;
            /** @description Tiempo transcurrido en el reloj simulado, separado del rendimiento del proceso. */
            simulation_total_duration: number;
        };
        SimulationPerformance: {
            /** @description Duración de procesamiento del último paso en milisegundos de reloj real. */
            simulation_step_latency_ms: number;
            /** @description Duración de procesamiento acumulada en milisegundos de reloj real; no determinista. */
            simulation_total_duration_ms: number;
        };
        DataProvenance: {
            graph_source: string;
            model: string;
            /** @description Fuente verificable de elevación o indicación explícita de que no se usaron elevaciones. */
            elevation_source: string;
            /** @description Limitación científica del modelo sintético de inundación. */
            disclaimer: string;
            geographic_reference?: components["schemas"]["ReferenceUse"];
        };
        ScenarioSnapshot: {
            /** @enum {string} */
            scenario_type: "urban_flood";
            simulation_step: number;
            world_version: number;
            graph_version: string;
            /** @description Reloj simulado; simulation_step multiplicado por time_step. */
            simulation_time: number;
            /** @description Duración configurada en unidades del reloj simulado. */
            simulation_duration: number;
            time_step: number;
            /** @description Intensidad sintética normalizada del paso actual; no precipitación medida. */
            rainfall: number;
            flood_zones: components["schemas"]["FloodZone"][];
            /** @description Overlay por ID sobre /grafo, sin duplicar geometrías viales. */
            road_conditions: components["schemas"]["RoadCondition"][];
            shelter_conditions: components["schemas"]["ShelterCondition"][];
            agents: components["schemas"]["FloodAgent"][];
            evacuation_metrics: components["schemas"]["EvacuationMetrics"];
            performance: components["schemas"]["SimulationPerformance"];
            data_provenance: components["schemas"]["DataProvenance"];
        };
        StepRequest: {
            sobrevivienteId: string;
            nodoActual: string;
            turno: number;
        };
        StepResponse: {
            siguienteNodo: string;
        };
        HealthResponse: {
            /** @enum {string} */
            status: "ok";
            service: string;
            version: string;
        };
        DemoItem: {
            id: string;
            title: string;
            description: string;
            /** @enum {string} */
            status: "active" | "pending" | "completed";
            /** Format: date-time */
            createdAt: string;
        };
        Pagination: {
            page: number;
            pageSize: number;
            total: number;
        };
        ItemListResponse: {
            data: components["schemas"]["DemoItem"][];
            pagination: components["schemas"]["Pagination"];
        };
        SubmitRequest: {
            /** @description Se recortan espacios exteriores; debe contener al menos un carácter no blanco. */
            title: string;
            description?: string;
        };
        SubmitResponse: {
            submissionId: string;
            /** @enum {string} */
            status: "accepted";
            message: string;
        };
        ErrorDetail: {
            field: string;
            message: string;
        };
        ErrorResponse: {
            error: components["schemas"]["ErrorResponseError"];
        };
        ErrorResponseError: {
            /** @enum {string} */
            code: "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR" | "UNAUTHORIZED" | "CONFLICT" | "UNAVAILABLE" | "TIMEOUT" | "METHOD_NOT_ALLOWED" | "EXPIRED" | "RATE_LIMITED";
            message: string;
            requestId: string;
            details: components["schemas"]["ErrorDetail"][];
        };
        SimulationInfo: {
            run_id: string;
            /** @enum {string} */
            mode: "competition" | "full" | "expanded";
            /** @enum {string} */
            round: "round1" | "round2" | "round3";
            /** @enum {string} */
            state: "idle" | "starting" | "running" | "finished" | "failed";
            /** Format: int64 */
            seed: number;
            graph_version: string;
            /** @enum {integer} */
            turn_limit: 150;
            interval_ms: number;
            started_at?: string;
            ended_at?: string;
            failure?: string;
        };
        GraphPreset: {
            /** @enum {string} */
            id: "competition" | "full" | "expanded";
            name: string;
            nodes: number;
            edges: number;
            graph_version: string;
            source: string;
            coverage: string;
            experimental: boolean;
            enabled: boolean;
            preview_available: boolean;
            disabled_reason: string;
        };
        SimulationRound: {
            /** @enum {string} */
            id: "round1" | "round2" | "round3";
            name: string;
            /** @enum {integer} */
            survivors: 20 | 80 | 200;
            /** @enum {integer} */
            turns: 150;
        };
        SimulationCatalog: {
            /** @enum {string} */
            default_mode: "competition";
            presets: components["schemas"]["GraphPreset"][];
            rounds: components["schemas"]["SimulationRound"][];
            admin_enabled: boolean;
            history_limit: number;
        };
        OperatorSession: {
            enabled: boolean;
            authenticated: boolean;
            operator?: string;
            csrf_token?: string;
            expires_at?: string;
        };
        OperatorLogin: {
            operator: string;
            /** @description Código aleatorio de256bits introducido por el operador. Nunca se incluye en bundles. */
            access_code: string;
        };
        StartSimulation: {
            /** @enum {string} */
            mode: "competition" | "full" | "expanded";
            /** @enum {string} */
            round: "round1" | "round2" | "round3";
            /** Format: int64 */
            seed: number;
            expected_run_id: string;
        };
        LabCandidate: {
            id: string;
            label: string;
            lat: number;
            lng: number;
            capacity: number;
        };
        LabRunConfig: {
            /** @enum {string} */
            mode: "competition" | "full";
            /** Format: int64 */
            seed: number;
            /** @enum {string} */
            rainfall_profile: "storm" | "constant" | "pulse";
            rainfall_intensity: number;
            simulation_duration: number;
            /** @enum {string} */
            evacuation_behavior: "preventive" | "late" | "adaptive";
            agents: number;
            interval_ms: number;
            shelters: components["schemas"]["LabCandidate"][];
            geographic_reference?: components["schemas"]["LabGeographicReference"];
        };
        LabRunRequest: {
            config: components["schemas"]["LabRunConfig"];
            expected_run_id: string;
        };
        LabAction: {
            /** @enum {string} */
            action: "pause" | "resume" | "restart" | "repeat" | "speed";
            expected_run_id: string;
            interval_ms?: number;
        };
        LabCandidateRequest: {
            /** @enum {string} */
            mode: "competition" | "full";
            candidates: components["schemas"]["LabCandidate"][];
        };
        LabValidatedCandidate: {
            id: string;
            label: string;
            lat: number;
            lng: number;
            capacity: number;
            node_id: string;
            snapped_lat: number;
            snapped_lng: number;
            snap_distance_m: number;
            valid: boolean;
            message: string;
        };
        LabCandidateValidation: {
            valid: boolean;
            candidates: components["schemas"]["LabValidatedCandidate"][];
        };
        LabSession: {
            enabled: boolean;
            authenticated: boolean;
            csrf_token: string;
        };
        LabPreset: {
            id: string;
            name: string;
            description: string;
            config: components["schemas"]["LabRunConfig"];
        };
        LabCatalog: {
            modes: components["schemas"]["GraphPreset"][];
            presets: components["schemas"]["LabPreset"][];
            default_config: components["schemas"]["LabRunConfig"];
            original_shelters: components["schemas"]["LabCandidate"][];
            max_snap_distance_m: number;
            disclaimer: string;
        };
        LabOrigin: {
            id: string;
            node_id: string;
            lat: number;
            lng: number;
            snap_distance_m: number;
        };
        LabTimelineEntry: {
            step: number;
            simulation_time: number;
            evacuation_metrics: components["schemas"]["EvacuationMetrics"];
            step_latency_ms: number;
        };
        LabComparisonResult: {
            /** @enum {string} */
            strategy: "original" | "custom";
            /** @enum {string} */
            mode: "competition" | "full";
            /** Format: int64 */
            seed: number;
            graph_version: string;
            total_agents: number;
            evacuated_percentage: number;
            evacuation_metrics: components["schemas"]["EvacuationMetrics"];
            step_latency_ms: number;
            origins_hash: string;
            config_hash: string;
        };
        LabComparison: {
            id: string;
            /** @enum {string} */
            state: "running" | "finished" | "failed";
            progress: number;
            message: string;
            results: components["schemas"]["LabComparisonResult"][];
        };
        LabState: {
            run_id: string;
            /** @enum {string} */
            state: "idle" | "running" | "paused" | "finished" | "failed";
            /** @enum {string} */
            mode: "competition" | "full";
            graph_version: string;
            config: components["schemas"]["LabRunConfig"];
            scenario: components["schemas"]["ScenarioSnapshot"];
            shelters: components["schemas"]["Shelter"][];
            timeline: components["schemas"]["LabTimelineEntry"][];
            origins: components["schemas"]["LabOrigin"][];
            comparison?: components["schemas"]["LabComparison"];
            incident_applications?: components["schemas"]["IncidentApplication"][];
        };
        IncidentBounds: {
            min_latitude: number;
            min_longitude: number;
            max_latitude: number;
            max_longitude: number;
        };
        IncidentEvidenceMetadata: {
            /** @enum {integer} */
            attachment_count: 0;
            /** @enum {string} */
            storage_status: "not_supported";
        };
        IncidentServiceInfo: {
            enabled: boolean;
            /** @enum {integer} */
            schema_version: 1;
            bounds: components["schemas"]["IncidentBounds"];
            max_description_length: number;
            max_snap_distance_m: number;
            verification_notice: string;
            photo_uploads_enabled: boolean;
        };
        IncidentLocation: {
            latitude: number;
            longitude: number;
            edge_id_hint?: string;
        };
        IncidentEdgeMatch: {
            edge_id: string;
            road_type: string;
            distance_m: number;
            from_node_id: string;
            to_node_id: string;
            latitude: number;
            longitude: number;
        };
        IncidentResolution: {
            matched: boolean;
            ambiguous: boolean;
            candidates: components["schemas"]["IncidentEdgeMatch"][];
            message: string;
            graph_version: string;
            max_snap_distance_m: number;
        };
        IncidentCreate: {
            /** @enum {string} */
            incident_type: "flooded_road" | "road_closed" | "landslide" | "fallen_tree" | "bridge_damage" | "other";
            latitude: number;
            longitude: number;
            description: string;
            /** @enum {string} */
            severity_reported: "low" | "moderate" | "high" | "unknown";
            /** @enum {string} */
            road_passability_reported: "passable" | "restricted" | "blocked" | "unknown";
            /** Format: date-time */
            event_time: string;
            /** @enum {string} */
            location_method: "manual" | "device";
            edge_id_hint?: string;
            evidence_metadata?: components["schemas"]["IncidentEvidenceMetadata"];
        };
        Incident: {
            /** @enum {integer} */
            schema_version: 1;
            incident_id: string;
            /** @enum {string} */
            incident_type: "flooded_road" | "road_closed" | "landslide" | "fallen_tree" | "bridge_damage" | "other";
            latitude: number;
            longitude: number;
            description: string;
            /** @enum {string} */
            severity_reported: "low" | "moderate" | "high" | "unknown";
            /** @enum {string} */
            road_passability_reported: "passable" | "restricted" | "blocked" | "unknown";
            /** Format: date-time */
            event_time: string;
            /** Format: date-time */
            received_at: string;
            /** @enum {string} */
            source_type: "citizen" | "synthetic" | "official";
            /** @enum {string} */
            verification_status: "pending" | "corroborated" | "verified" | "rejected" | "expired";
            evidence_metadata: components["schemas"]["IncidentEvidenceMetadata"];
            affected_edge_ids: string[];
            graph_version: string;
            snap_distance_m: number;
            /** @enum {string} */
            location_method: "manual" | "device";
            /** @description Resolución aproximada de las coordenadas públicas redondeadas; no representa exactitud GPS ni verifica la ubicación declarada. */
            location_precision_m: number;
            /** Format: date-time */
            expires_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        IncidentList: {
            incidents: components["schemas"]["Incident"][];
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
        IncidentStatusUpdate: {
            /** @enum {string} */
            verification_status: "pending" | "corroborated" | "verified" | "rejected";
            /** Format: date-time */
            expected_updated_at: string;
        };
        IncidentApply: {
            expected_run_id: string;
            duration_steps: number;
            /** @enum {string} */
            effect: "blocked" | "caution";
            /** @enum {boolean} */
            experimental_ack: true;
        };
        IncidentApplication: {
            application_id: string;
            incident_id: string;
            run_id: string;
            affected_edge_ids: string[];
            simulation_step: number;
            world_version: number;
            /** @enum {string} */
            source_type: "citizen" | "synthetic" | "official";
            /** @enum {string} */
            verification_status_at_application: "pending" | "corroborated" | "verified" | "rejected" | "expired";
            /** @enum {string} */
            effect: "blocked" | "caution";
            expires_at_simulation_step: number;
            /** Format: date-time */
            applied_at: string;
        };
        IncidentApplyResult: {
            incident: components["schemas"]["Incident"];
            application: components["schemas"]["IncidentApplication"];
            state: components["schemas"]["LabState"];
            already_applied: boolean;
        };
        ReferenceProvenance: {
            /** @enum {string} */
            category: "synthetic" | "official_reference" | "official_observation" | "citizen_report";
            source: string;
            /** Format: uri */
            url: string;
            /** Format: date-time */
            consulted_at: string;
            publication_date?: string;
            /** Format: date-time */
            declared_updated_at?: string;
            /** Format: date-time */
            portal_modified_at?: string;
            attribution: string;
            license: string;
            original_crs: string;
            /** @enum {string} */
            output_crs: "EPSG:4326";
            dataset_version: string;
            temporal_scope: string;
            source_years: number[];
            /** @description Máxima fecha declarada entre registros consultados; no acredita actualización de todo el servicio. */
            declared_update_date?: string;
        };
        ReferenceGeometry: {
            /** @enum {string} */
            type: "MultiPolygon";
            coordinates: number[][][][];
        };
        ReferenceProperties: {
            object_id: string;
            /** @enum {string} */
            susceptibility: "ALTA" | "MEDIA" | "BAJA";
            source_year?: number;
        };
        ReferenceFeature: {
            /** @enum {string} */
            type: "Feature";
            id: string;
            properties: components["schemas"]["ReferenceProperties"];
            geometry: components["schemas"]["ReferenceGeometry"];
        };
        ReferenceCollection: {
            /** @enum {integer} */
            schema_version: 1;
            /** @enum {string} */
            type: "FeatureCollection";
            bbox: number[];
            features: components["schemas"]["ReferenceFeature"][];
            provenance: components["schemas"]["ReferenceProvenance"];
            feature_count: number;
            vertex_count: number;
            generalization_degrees: number;
        };
        OfficialRainEvent: {
            object_id: string;
            event: string;
            canton: string;
            event_date: string;
            closed_date: string;
            latitude: number;
            longitude: number;
            declared_update_date?: string;
        };
        OfficialRainEvents: {
            /** @enum {integer} */
            schema_version: 1;
            events: components["schemas"]["OfficialRainEvent"][];
            provenance: components["schemas"]["ReferenceProvenance"];
        };
        ReferenceProviderMetrics: {
            queries: number;
            provider_errors: number;
            cache_hits: number;
            cache_misses: number;
            last_query_ms: number;
            total_query_ms: number;
            response_bytes: number;
            last_refresh_ms: number;
        };
        ReferenceStatus: {
            /** @enum {integer} */
            schema_version: 1;
            /** @enum {string} */
            mode: "offline" | "online" | "disabled";
            /** @enum {string} */
            availability: "cached" | "stale" | "unavailable" | "disabled";
            refreshing: boolean;
            /** @enum {string} */
            provider_status: "unknown" | "ok" | "error" | "offline";
            message: string;
            dataset_version?: string;
            provenance?: components["schemas"]["ReferenceProvenance"];
            feature_count: number;
            vertex_count: number;
            last_refresh_error?: string;
            metrics: components["schemas"]["ReferenceProviderMetrics"];
            event_dataset_version?: string;
        };
        LabGeographicReference: {
            enabled: boolean;
            dataset_version?: string;
            strength: number;
        };
        ReferenceZoneUse: {
            zone_id: string;
            /** @enum {string} */
            susceptibility: "ALTA" | "MEDIA" | "BAJA" | "NONE";
            factor: number;
            feature_ids: string[];
        };
        ReferenceUse: {
            /** @enum {string} */
            category: "official_reference";
            dataset_version: string;
            /** Format: uri */
            source_url: string;
            /** Format: date-time */
            consulted_at: string;
            strength: number;
            zones: components["schemas"]["ReferenceZoneUse"][];
        };
        LabTelemetry: {
            run_id: string;
            simulation_step: number;
            world_version: number;
            agents: number;
            edges: number;
            overlay_edges: number;
            overlay_update_ms: number;
            replanning_ms: number;
            simulation_step_ms: number;
            planning_calls: number;
            reference: components["schemas"]["ReferenceProviderMetrics"];
        };
    };
    responses: {
        /** @description Sesión caducada conocida temporalmente; después de retirar su tombstone devuelve 404. */
        SimulationExpired: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Presupuesto de solicitudes agotado; Retry-After indica cuándo reintentar. */
        RateLimited: {
            headers: {
                "Retry-After"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Cupos activos, sesiones retenidas o presupuesto de memoria agotados; no se crea trabajo. */
        SimulationCapacity: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Falta la credencial privada o no es válida. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Turno, nodo o estado del sobreviviente incoherente con el snapshot. */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Aún no existe un snapshot disponible. */
        Unavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Se agotó el tiempo para decidir el movimiento. */
        Timeout: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Entrada inválida; details identifica los campos con problemas. */
        ValidationError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description El recurso solicitado no existe. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Error interno; no expone detalles privados de implementación. */
        InternalError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getSimulationMetrics: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Exposición Prometheus de contadores, sesiones, memoria estimada y tiempos acumulados. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Presupuesto de solicitudes agotado; consultar Retry-After. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getEvacuationHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Proceso disponible. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    getWorldState: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado inmutable del turno publicado. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldSnapshot"];
                };
            };
            503: components["responses"]["Unavailable"];
        };
    };
    getScenarioState: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado inmutable de urban_flood. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioSnapshot"];
                };
            };
            404: components["responses"]["NotFound"];
            503: components["responses"]["Unavailable"];
        };
    };
    getWorldGraph: {
        parameters: {
            query?: {
                /** @description Previsualización pública de un preset; no cambia la ronda activa. */
                mode?: "competition" | "full" | "expanded";
                /** @description Rechaza con409 si la ronda activa cambió; no se combina con mode. */
                run_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Grafo geográfico cargado y validado. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Graph"];
                };
            };
            /** @description La ronda cambió; volver a consultar /estado. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: components["responses"]["Unavailable"];
        };
    };
    decideNextStep: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepRequest"];
            };
        };
        responses: {
            /** @description Siguiente movimiento válido para el snapshot. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            503: components["responses"]["Unavailable"];
            504: components["responses"]["Timeout"];
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description API disponible. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            500: components["responses"]["InternalError"];
        };
    };
    listDemoItems: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de resultados; una búsqueda sin coincidencias devuelve data vacío. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ItemListResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            500: components["responses"]["InternalError"];
        };
    };
    getDemoItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Elemento encontrado. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DemoItem"];
                };
            };
            400: components["responses"]["ValidationError"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["InternalError"];
        };
    };
    submitDemo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitRequest"];
            };
        };
        responses: {
            /** @description Formulario aceptado; la demo no persiste datos. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubmitResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            500: components["responses"]["InternalError"];
        };
    };
    getSimulationCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Respuesta pública. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationCatalog"];
                };
            };
            /** @description El estado no está preparado. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getSimulationInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Respuesta pública. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationInfo"];
                };
            };
            /** @description El estado no está preparado. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getCompletedRunState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Snapshot público conservado. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldSnapshot"];
                };
            };
            /** @description Ronda no conservada. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getOperatorSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sesión o visitante. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatorSession"];
                };
            };
        };
    };
    createOperatorSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperatorLogin"];
            };
        };
        responses: {
            /** @description Sesión autenticada; cookie Secure HttpOnly SameSite=Strict. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatorSession"];
                };
            };
            /** @description JSON no válido. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Acceso rechazado. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Origin rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Demasiados intentos. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Administración no configurada. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteOperatorSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sesión cerrada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatorSession"];
                };
            };
            /** @description Sesión requerida. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description CSRF u Origin rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    startSimulationRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StartSimulation"];
            };
        };
        responses: {
            /** @description Nueva ronda; estado anterior conservado. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationInfo"];
                };
            };
            /** @description Configuración no válida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sesión requerida. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description CSRF, Origin o modo no habilitado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Ronda activa, inicio en progreso o identificador anterior obsoleto. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No pudo prepararse la ronda; estado anterior intacto. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getLabSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabSession"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    getLabCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabCatalog"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    getLabGraph: {
        parameters: {
            query?: {
                mode?: "competition" | "full";
                run_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Graph"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    getLabState: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabState"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    startLabRun: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabRunRequest"];
            };
        };
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabState"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    controlLabRun: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabAction"];
            };
        };
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabState"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    validateLabCandidates: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabCandidateRequest"];
            };
        };
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabCandidateValidation"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    compareLabShelters: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabRunRequest"];
            };
        };
        responses: {
            /** @description Estado observable del laboratorio sintético. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabState"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    getIncidentServiceInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operación completada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IncidentServiceInfo"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    resolveIncidentLocation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IncidentLocation"];
            };
        };
        responses: {
            /** @description Operación completada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IncidentResolution"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listIncidents: {
        parameters: {
            query?: {
                /** @description minLongitude,minLatitude,maxLongitude,maxLatitude. */
                bbox?: string;
                incident_type?: "flooded_road" | "road_closed" | "landslide" | "fallen_tree" | "bridge_damage" | "other";
                verification_status?: "pending" | "corroborated" | "verified" | "rejected" | "expired";
                /** @description Fecha declarada de evento mínima. */
                since?: string;
                until?: string;
                received_after?: string;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operación completada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IncidentList"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createCitizenIncident: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IncidentCreate"];
            };
        };
        responses: {
            /** @description Repetición idempotente o duplicado detectado. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Incident"];
                };
            };
            /** @description Operación completada. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Incident"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getIncident: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                incident_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operación completada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Incident"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createSyntheticIncident: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IncidentCreate"];
            };
        };
        responses: {
            /** @description Repetición idempotente o duplicado detectado. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Incident"];
                };
            };
            /** @description Operación completada. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Incident"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reviewIncident: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                incident_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IncidentStatusUpdate"];
            };
        };
        responses: {
            /** @description Operación completada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Incident"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    applyIncidentToExperimentalRun: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                incident_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IncidentApply"];
            };
        };
        responses: {
            /** @description Operación completada. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IncidentApplyResult"];
                };
            };
            /** @description Datos o asociación geográfica no válidos. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Se requiere autorización del laboratorio. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Incidente no encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicto de idempotencia o versión. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de recepción alcanzado. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Almacén persistente no disponible. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getReferenceStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copia local validada o estado operativo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReferenceStatus"];
                };
            };
            /** @description Consulta fuera del área o inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Copia no disponible; el motor sintético sigue operativo */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getSusceptibilityReference: {
        parameters: {
            query?: {
                /** @description Versión de la copia local; no inicia consultas externas. */
                version?: string;
                /** @description minLng,minLat,maxLng,maxLat; debe permanecer dentro de la envolvente del maestro de Manta. Sólo filtra la copia local. */
                bbox?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copia local validada o estado operativo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReferenceCollection"];
                };
            };
            /** @description Copia identificada por ETag sin cambios; sin cuerpo. */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Consulta fuera del área o inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Copia no disponible; el motor sintético sigue operativo */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getOfficialRainEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copia local validada o estado operativo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfficialRainEvents"];
                };
            };
            /** @description Consulta fuera del área o inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Copia no disponible; el motor sintético sigue operativo */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getLabTelemetry: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Copia local validada o estado operativo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabTelemetry"];
                };
            };
            /** @description Consulta fuera del área o inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Copia no disponible; el motor sintético sigue operativo */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    refreshOfficialReferences: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Trabajo programado; ninguna simulación espera al proveedor */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReferenceStatus"];
                };
            };
            /** @description Sesión local o CSRF inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Modo online deshabilitado */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getSimulationCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Capacidades públicas del proceso; ambos motores son sintéticos. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationCapabilities"];
                };
            };
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Presupuesto de solicitudes agotado; consultar Retry-After. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createSimulation: {
        parameters: {
            query?: never;
            header: {
                /** @description Clave opaca de solicitud; el replay exige el mismo cuerpo normalizado. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SimulationCreateRequest"];
            };
        };
        responses: {
            /** @description Ejecución creada; conservar la credencial sólo en sessionStorage. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationCreated"];
                };
            };
            400: components["responses"]["ValidationError"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: components["responses"]["Conflict"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["SimulationCapacity"];
        };
    };
    getSimulation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sesión autorizada; nunca incluye access_token. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationMetadata"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
        };
    };
    getSimulationState: {
        parameters: {
            query?: never;
            header?: {
                /** @description ETag de la versión ya recibida; la autorización se verifica antes del 304. */
                "If-None-Match"?: string;
            };
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sesión autorizada; nunca incluye access_token. */
            200: {
                headers: {
                    /** @description Versión opaca del snapshot y estado de ejecución. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationState"];
                };
            };
            /** @description Snapshot sin cambios; sin cuerpo JSON. */
            304: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
        };
    };
    getSimulationResults: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sesión autorizada; nunca incluye access_token. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationResults"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: components["responses"]["Conflict"];
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
        };
    };
    pauseSimulation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Comando aplicado; repeticiones válidas no crean bucles adicionales. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationMetadata"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: components["responses"]["Conflict"];
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["SimulationCapacity"];
        };
    };
    resumeSimulation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Comando aplicado; repeticiones válidas no crean bucles adicionales. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationMetadata"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: components["responses"]["Conflict"];
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["SimulationCapacity"];
        };
    };
    cancelSimulation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Comando aplicado; repeticiones válidas no crean bucles adicionales. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationMetadata"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: components["responses"]["Conflict"];
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["SimulationCapacity"];
        };
    };
    restartSimulation: {
        parameters: {
            query?: never;
            header: {
                /** @description Clave opaca de solicitud; el replay exige el mismo cuerpo normalizado. */
                "Idempotency-Key": string;
            };
            path: {
                simulation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Comando aplicado; repeticiones válidas no crean bucles adicionales. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulationCreated"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            /** @description Origen CORS rechazado. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description Método no permitido. */
            405: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: components["responses"]["Conflict"];
            410: components["responses"]["SimulationExpired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["SimulationCapacity"];
        };
    };
}

export type SimulationProOptions = components['schemas']['SimulationProOptions'];
export type RescueVehicle = components['schemas']['RescueVehicle'];
export type RescueFleetMetrics = components['schemas']['RescueFleetMetrics'];
export type RunnerForecast = components['schemas']['RunnerForecast'];
export type SimulationAnalytics = components['schemas']['SimulationAnalytics'];
export type SimulationCustomShelter = components['schemas']['SimulationCustomShelter'];
export type SimulationConfigInput = components['schemas']['SimulationConfigInput'];
export type SimulationConfig = components['schemas']['SimulationConfig'];
export type SimulationCreateRequest = components['schemas']['SimulationCreateRequest'];
export type SimulationMetadata = components['schemas']['SimulationMetadata'];
export type SimulationCreated = components['schemas']['SimulationCreated'];
export type SimulationState = components['schemas']['SimulationState'];
export type SimulationResults = components['schemas']['SimulationResults'];
export type SimulationResultMetrics = components['schemas']['SimulationResultMetrics'];
export type SimulationScenarioCapability = components['schemas']['SimulationScenarioCapability'];
export type SimulationGraphProfile = components['schemas']['SimulationGraphProfile'];
export type SimulationDefaults = components['schemas']['SimulationDefaults'];
export type SimulationLimits = components['schemas']['SimulationLimits'];
export type SimulationCapabilities = components['schemas']['SimulationCapabilities'];
export type GraphNode = components['schemas']['GraphNode'];
export type GeoPoint = components['schemas']['GeoPoint'];
export type SpawnZone = components['schemas']['SpawnZone'];
export type GraphEdge = components['schemas']['GraphEdge'];
export type Shelter = components['schemas']['Shelter'];
export type Graph = components['schemas']['Graph'];
export type Zombie = components['schemas']['Zombie'];
export type Survivor = components['schemas']['Survivor'];
export type WorldEvent = components['schemas']['WorldEvent'];
export type WorldMetrics = components['schemas']['WorldMetrics'];
export type WorldSnapshot = components['schemas']['WorldSnapshot'];
export type FloodZone = components['schemas']['FloodZone'];
export type RoadCondition = components['schemas']['RoadCondition'];
export type ShelterCondition = components['schemas']['ShelterCondition'];
export type FloodAgent = components['schemas']['FloodAgent'];
export type EvacuationMetrics = components['schemas']['EvacuationMetrics'];
export type SimulationPerformance = components['schemas']['SimulationPerformance'];
export type DataProvenance = components['schemas']['DataProvenance'];
export type ScenarioSnapshot = components['schemas']['ScenarioSnapshot'];
export type StepRequest = components['schemas']['StepRequest'];
export type StepResponse = components['schemas']['StepResponse'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type DemoItem = components['schemas']['DemoItem'];
export type Pagination = components['schemas']['Pagination'];
export type ItemListResponse = components['schemas']['ItemListResponse'];
export type SubmitRequest = components['schemas']['SubmitRequest'];
export type SubmitResponse = components['schemas']['SubmitResponse'];
export type ErrorDetail = components['schemas']['ErrorDetail'];
export type ErrorResponse = components['schemas']['ErrorResponse'];
export type ErrorResponseError = components['schemas']['ErrorResponseError'];
export type SimulationInfo = components['schemas']['SimulationInfo'];
export type GraphPreset = components['schemas']['GraphPreset'];
export type SimulationRound = components['schemas']['SimulationRound'];
export type SimulationCatalog = components['schemas']['SimulationCatalog'];
export type OperatorSession = components['schemas']['OperatorSession'];
export type OperatorLogin = components['schemas']['OperatorLogin'];
export type StartSimulation = components['schemas']['StartSimulation'];
export type LabCandidate = components['schemas']['LabCandidate'];
export type LabRunConfig = components['schemas']['LabRunConfig'];
export type LabRunRequest = components['schemas']['LabRunRequest'];
export type LabAction = components['schemas']['LabAction'];
export type LabCandidateRequest = components['schemas']['LabCandidateRequest'];
export type LabValidatedCandidate = components['schemas']['LabValidatedCandidate'];
export type LabCandidateValidation = components['schemas']['LabCandidateValidation'];
export type LabSession = components['schemas']['LabSession'];
export type LabPreset = components['schemas']['LabPreset'];
export type LabCatalog = components['schemas']['LabCatalog'];
export type LabOrigin = components['schemas']['LabOrigin'];
export type LabTimelineEntry = components['schemas']['LabTimelineEntry'];
export type LabComparisonResult = components['schemas']['LabComparisonResult'];
export type LabComparison = components['schemas']['LabComparison'];
export type LabState = components['schemas']['LabState'];
export type IncidentBounds = components['schemas']['IncidentBounds'];
export type IncidentEvidenceMetadata = components['schemas']['IncidentEvidenceMetadata'];
export type IncidentServiceInfo = components['schemas']['IncidentServiceInfo'];
export type IncidentLocation = components['schemas']['IncidentLocation'];
export type IncidentEdgeMatch = components['schemas']['IncidentEdgeMatch'];
export type IncidentResolution = components['schemas']['IncidentResolution'];
export type IncidentCreate = components['schemas']['IncidentCreate'];
export type Incident = components['schemas']['Incident'];
export type IncidentList = components['schemas']['IncidentList'];
export type IncidentStatusUpdate = components['schemas']['IncidentStatusUpdate'];
export type IncidentApply = components['schemas']['IncidentApply'];
export type IncidentApplication = components['schemas']['IncidentApplication'];
export type IncidentApplyResult = components['schemas']['IncidentApplyResult'];
export type ReferenceProvenance = components['schemas']['ReferenceProvenance'];
export type ReferenceGeometry = components['schemas']['ReferenceGeometry'];
export type ReferenceProperties = components['schemas']['ReferenceProperties'];
export type ReferenceFeature = components['schemas']['ReferenceFeature'];
export type ReferenceCollection = components['schemas']['ReferenceCollection'];
export type OfficialRainEvent = components['schemas']['OfficialRainEvent'];
export type OfficialRainEvents = components['schemas']['OfficialRainEvents'];
export type ReferenceProviderMetrics = components['schemas']['ReferenceProviderMetrics'];
export type ReferenceStatus = components['schemas']['ReferenceStatus'];
export type LabGeographicReference = components['schemas']['LabGeographicReference'];
export type ReferenceZoneUse = components['schemas']['ReferenceZoneUse'];
export type ReferenceUse = components['schemas']['ReferenceUse'];
export type LabTelemetry = components['schemas']['LabTelemetry'];
