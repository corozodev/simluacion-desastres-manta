fields @timestamp, timestamp_ms, run_id, scope, duration_ms, status, outcome
| filter event = "paso_http" and method = "POST" and route = "/paso"
| filter run_id = "REEMPLAZAR_ID_DE_EJECUCION"
| filter ispresent(duration_ms)
| stats count(*) as requests, pct(duration_ms, 50) as p50_ms,
        pct(duration_ms, 95) as p95_ms, pct(duration_ms, 99) as p99_ms
