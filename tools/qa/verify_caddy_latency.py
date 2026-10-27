#!/usr/bin/env python3
"""Local-only Caddy timing/redaction check; prints booleans, never canaries."""
import argparse
from datetime import datetime, timezone
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request

IMAGE = "caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checks = {}
    failure_location = None
    diagnostic_metadata = {}
    canary = secrets.token_urlsafe(40)
    name = "corodev-caddy-latency-" + secrets.token_hex(5)
    inflight_started = threading.Event()

    class Upstream(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path.startswith("/inflight"):
                inflight_started.set()
                time.sleep(.4)
            else:
                time.sleep(.02)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", "private=" + canary)
            self.send_header("X-Private-Canary", canary)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')

    def port():
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def docker(*arguments):
        return subprocess.run(["docker", *arguments], capture_output=True, timeout=30)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    caddy_port, missing_port = port(), port()
    try:
        with tempfile.TemporaryDirectory(prefix="corodev-caddy-latency-") as directory:
            private = Path(directory)
            candidate = Path(__file__).with_name("Caddyfile.latency").read_text()
            test_config = candidate.replace(
                "\treverse_proxy corodev-backend:8080",
                "\tbind 127.0.0.1\n\t@unreachable path /force-error\n"
                f"\treverse_proxy @unreachable 127.0.0.1:{missing_port}\n"
                f"\treverse_proxy 127.0.0.1:{server.server_port}")
            config = private / "Caddyfile"
            config.write_text(test_config)
            env = ["--env", f"API_DOMAIN=http://127.0.0.1:{caddy_port}",
                   "--env", "TLS_EMAIL=owner@example.invalid",
                   "--env", "XDG_CONFIG_HOME=/tmp/caddy-config"]
            mounts = ["--mount", f"type=bind,src={config},dst=/etc/caddy/Caddyfile,readonly",
                      "--mount", f"type=bind,src={private},dst=/data"]
            validated = docker("run", "--rm", "--network", "none",
                               "--user", f"{os.getuid()}:{os.getgid()}", *env, *mounts,
                               IMAGE, "caddy", "validate", "--config", "/etc/caddy/Caddyfile")
            checks["pinned_caddy_validate"] = validated.returncode == 0
            started = docker("run", "-d", "--name", name, "--network", "host",
                             "--user", f"{os.getuid()}:{os.getgid()}", *env,
                             *mounts, IMAGE, "caddy", "run", "--config", "/etc/caddy/Caddyfile")
            checks["local_caddy_started"] = started.returncode == 0
            if not checks["local_caddy_started"]:
                raise RuntimeError("local start failed")
            root = f"http://127.0.0.1:{caddy_port}"
            for _ in range(60):
                try:
                    with urllib.request.urlopen(root + "/ready", timeout=.3):
                        break
                except OSError:
                    time.sleep(.1)
            statuses = []
            for route in ("/healthy/" + canary, "/force-error", "/healthz", "/grafo", "/estado", "/paso"):
                req = urllib.request.Request(root + route + "?private=" + canary, headers={
                    "x-api-key": canary, "Authorization": "Bearer " + canary,
                    "Cookie": "private=" + canary, "X-Private-Canary": canary})
                try:
                    response = urllib.request.urlopen(req, timeout=3)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    statuses.append(response.code)
                    response.read()
            before = json.loads(docker("inspect", name).stdout)[0]
            reload_requests, reload_errors, saw_new_header, idle_reconnections = [], [], [], []
            inflight_status = []

            def inflight_request():
                connection = http.client.HTTPConnection("127.0.0.1", caddy_port, timeout=3)
                try:
                    connection.request("GET", "/inflight?private=" + canary,
                                       headers={"x-api-key": canary})
                    response = connection.getresponse()
                    response.read()
                    inflight_status.append(response.status)
                except Exception:
                    inflight_status.append(0)
                finally:
                    connection.close()

            def keep_alive_requests():
                connection = http.client.HTTPConnection("127.0.0.1", caddy_port, timeout=3)
                try:
                    for _ in range(30):
                        for retry in range(2):
                            try:
                                connection.request("GET", "/keepalive?private=" + canary,
                                                   headers={"x-api-key": canary, "Cookie": canary})
                                reply = connection.getresponse()
                                reply.read()
                                break
                            except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError):
                                if retry:
                                    raise
                                # Only this read-only GET is retried after idle recycling.
                                idle_reconnections.append(True)
                                connection.close()
                                connection = http.client.HTTPConnection("127.0.0.1", caddy_port, timeout=3)
                        reload_requests.append(reply.status)
                        saw_new_header.append(reply.getheader("X-Diagnostic-Reload") == "yes")
                        time.sleep(.015)
                except Exception as error:
                    reload_errors.append(type(error).__name__)
                finally:
                    connection.close()

            during_reload = threading.Thread(target=keep_alive_requests)
            during_reload.start()
            in_flight = threading.Thread(target=inflight_request)
            in_flight.start()
            if not inflight_started.wait(timeout=3):
                raise RuntimeError("upstream in-flight request not observed")
            # Truncate/write the same inode: matches the production bind-mount workflow.
            config.write_text(test_config.replace("\tencode gzip", "\theader X-Diagnostic-Reload yes\n\tencode gzip"))
            signaled = docker("kill", "--signal", "USR1", name)
            during_reload.join(timeout=10)
            in_flight.join(timeout=5)
            after = json.loads(docker("inspect", name).stdout)[0]
            checks.update({
                "sigusr1_delivered": signaled.returncode == 0,
                "sigusr1_new_configuration_observed": any(saw_new_header),
                "sigusr1_keeps_container_start_time": before["State"]["StartedAt"] == after["State"]["StartedAt"],
                "sigusr1_keeps_process_pid": before["State"]["Pid"] == after["State"]["Pid"],
                "sigusr1_inflight_request_completed": inflight_status == [200],
                "sigusr1_30_get_operations_with_safe_reconnection": len(reload_requests) == 30
                    and not reload_errors and all(code == 200 for code in reload_requests),
            })
            time.sleep(.2)
            access_path = private / "diagnostics/access.json"
            access_raw = access_path.read_bytes()
            default_raw = docker("logs", name)
            combined_default = default_raw.stdout + default_raw.stderr
            access = [json.loads(line) for line in access_raw.splitlines()]
            runtime = [json.loads(line) for line in combined_default.splitlines() if line.startswith(b"{")]
            diagnostic_metadata = {"reload_requests_completed": len(reload_requests),
                                   "reload_error_types": reload_errors,
                                   "idle_connection_reconnections": len(idle_reconnections),
                                   "idle_connection_note": "Graceful reload may close idle TCP connections; explicit retry is used only for this test's read-only GET, never POST.",
                                   "runtime_loggers": sorted({row.get("logger", "default") for row in runtime}),
                                   "runtime_messages": [row.get("msg") for row in runtime
                                                        if canary not in str(row.get("msg", ""))]}
            checks.update({
                "canary_http_200_and_502": statuses == [200, 502, 200, 200, 200, 200],
                "access_canary_absent": canary.encode() not in access_raw,
                "default_error_canary_absent": canary.encode() not in combined_default,
                "access_request_headers_identity_removed": all(
                    not {"request", "resp_headers", "user_id"}.intersection(row) for row in access),
                "default_request_headers_identity_removed": all(
                    not {"request", "resp_headers", "user_id"}.intersection(row) for row in runtime),
                "default_actual_proxy_error_exercised": any(
                    str(row.get("logger", "")).startswith("http.log.error") for row in runtime),
                "caddy_duration_status_size_preserved": all(
                    {"duration", "status", "size"}.issubset(row) for row in access),
                "upstream_timings_observed": any(
                    row.get("status") == 200 and float(row.get("upstream_duration_ms", 0)) >= 15
                    and float(row.get("upstream_latency_ms", 0)) >= 15 for row in access),
                "access_file_private_0600": access_path.stat().st_mode & 0o777 == 0o600,
                "routes_only_static_allowlist": all(row.get("route") in {
                    "/healthz", "/grafo", "/estado", "/paso", "other"} for row in access),
                "all_static_routes_and_unknown_canary_seen": {row.get("route") for row in access}
                    == {"/healthz", "/grafo", "/estado", "/paso", "other"},
            })
    except Exception as error:
        checks["completed_without_error"] = False
        frame = traceback.extract_tb(error.__traceback__)[-1]
        failure_location = {"type": type(error).__name__, "line": frame.lineno,
                            "function": frame.name}
    else:
        checks["completed_without_error"] = True
    finally:
        docker("rm", "-f", name)
        server.shutdown()
        server.server_close()
    report = {"recorded_at": datetime.now(timezone.utc).isoformat(),
              "scope": "isolated local Caddy; no AWS or production changes", "image": IMAGE,
              "checks": checks, "passed": bool(checks) and all(checks.values()),
              "diagnostic_metadata": diagnostic_metadata,
              "failure_location_without_exception_values": failure_location}
    args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    os.chmod(args.output, 0o600)
    print(json.dumps({"checks": checks, "passed": report["passed"]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
