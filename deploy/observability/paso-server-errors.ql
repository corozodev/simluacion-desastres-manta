fields @timestamp, run_id, scope, route, status, duration_ms, outcome
| filter event = "paso_http" and method = "POST" and route = "/paso"
| filter status >= 500 or outcome in ["cancelled", "timeout", "write_error", "panic"]
| stats count(*) as requests by status, outcome, bin(1m)
