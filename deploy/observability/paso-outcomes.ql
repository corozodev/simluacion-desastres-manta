fields @timestamp, route, status, outcome
| filter event = "paso_http" and method = "POST" and route = "/paso"
| stats count(*) as requests by status, outcome, bin(1m)
