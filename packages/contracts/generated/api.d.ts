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
    getWorldGraph: {
        parameters: {
            query?: never;
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
