// GENERATED from packages/contracts/openapi.yaml. Do not edit.
export interface paths {
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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
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
            code: "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR" | "UNAUTHORIZED" | "CONFLICT" | "UNAVAILABLE" | "TIMEOUT" | "METHOD_NOT_ALLOWED";
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
    };
    responses: {
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
}

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
