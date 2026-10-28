fields @timestamp, @logStream, process_started_at, attempted, emitted, dropped, write_errors, queued
| filter event = "paso_http_log_status"
| sort @timestamp desc
| dedup @logStream, process_started_at
