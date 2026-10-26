#!/usr/bin/env python3
"""Probe an actual HTTPS API; run on a client outside the target EC2 instance.

API_KEY is read only from the environment and is never included in the report.
This command reads snapshots and requests decisions; it never mutates the world.
It does not provision AWS resources or infer an external vantage from a URL.
"""

import argparse
from datetime import datetime, timezone
import ipaddress
import json
import math
import os
from pathlib import Path
import socket
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="Real HTTPS API origin, without credentials")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--observe-seconds", type=float, default=3,
                        help="Wait for a live simulation turn to advance (0.1 to 60 seconds)")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    url = urllib.parse.urlsplit(base)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.path not in ("", "/")):
        parser.error("base_url must be an HTTPS origin without credentials, path or query")
    key = os.environ.get("API_KEY", "").strip()
    if not key:
        parser.error("Set API_KEY in the environment; do not pass a key on the command line")
    if not 1 <= args.samples <= 1000:
        parser.error("samples must be between 1 and 1000")
    if not math.isfinite(args.observe_seconds) or not .1 <= args.observe_seconds <= 60:
        parser.error("observe-seconds must be between 0.1 and 60")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(url.hostname, url.port or 443)}
    except OSError:
        parser.error("API hostname could not be resolved")
    if not addresses or not all(ipaddress.ip_address(address).is_global for address in addresses):
        parser.error("API hostname must resolve only to public IP addresses")

    opener = urllib.request.build_opener(NoRedirects())
    report = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "phase": "3A", "base_url": base,
        "vantage": "invoking client; execution outside target EC2 must be attested separately",
        "tls_verification": True, "redirects_followed": False,
        "checks": {}, "complete": False, "probe_errors": 0, "probe_timeouts": 0,
    }

    def request(route, payload=None, credential=None):
        headers = {"Accept": "application/json"}
        if credential is not None:
            headers["x-api-key"] = credential
        data = None if payload is None else json.dumps(payload).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        started = time.perf_counter()
        req = urllib.request.Request(base + route, data=data, headers=headers)
        try:
            response = opener.open(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(8 * 1024 * 1024 + 1)
            elapsed = (time.perf_counter() - started) * 1000
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("Response exceeded probe size limit")
            if key.encode() in raw:
                raise ValueError("API credential appeared in a response")
            body = json.loads(raw) if raw else None
            return response.code, body, elapsed

    def require(condition, message):
        if not condition:
            raise ValueError(message)

    latencies = []
    conflicts = attempts = errors = timeouts = 0
    decision_in_flight = False
    try:
        for route in ("/healthz", "/grafo", "/estado"):
            status, body, _ = request(route)
            report["checks"][route] = status
            require(status == 200 and isinstance(body, dict), "Public GET failed: " + route)
            if route == "/healthz":
                require(body.get("status") == "ok", "Health response is not healthy")
            elif route == "/grafo":
                graph = body
                require(bool(graph.get("nodes")) and bool(graph.get("edges")), "Graph is empty")
            else:
                initial = body
                require(not any(z.get("type") == "sleeper" and not z.get("awake")
                                for z in body.get("zombies", [])), "Dormant sleeper was exposed")
        payload = {"sobrevivienteId": "probe", "nodoActual": "probe", "turno": 0}
        for label, credential in (("missing_key", None), ("wrong_key", "intentionally-invalid")):
            status, _, _ = request("/paso", payload, credential)
            report["checks"][label] = status
            require(status == 401, "Unauthenticated request did not return 401")
        for route in ("/admin", "/reset", "/config", "/debug/pprof/"):
            status, _, _ = request(route)
            report["checks"][route] = status
            require(status == 404, "Unexpected administrative route: " + route)

        for _ in range(args.samples):
            for retry in range(3):
                status, state, _ = request("/estado")
                require(status == 200, "Snapshot unavailable while sampling")
                require(not any(z.get("type") == "sleeper" and not z.get("awake")
                                for z in state.get("zombies", [])), "Dormant sleeper was exposed")
                active = next((s for s in state.get("survivors", []) if s.get("status") == "active"), None)
                require(active is not None, "No active survivor: authenticated decision check remains pending")
                payload = {"sobrevivienteId": active["id"], "nodoActual": active["current_node"], "turno": state["turn"]}
                attempts += 1
                decision_in_flight = True
                status, decision, elapsed = request("/paso", payload, key)
                if status == 409:
                    conflicts += 1
                    decision_in_flight = False
                    continue
                require(status == 200 and isinstance(decision, dict)
                        and set(decision) == {"siguienteNodo"}, "Authenticated decision failed")
                target = decision["siguienteNodo"]
                require(target == active["current_node"] or any(
                    not edge.get("blocked") and edge["id"] not in state.get("blocked_edges", [])
                    and ((edge["from"] == active["current_node"] and edge["to"] == target)
                         or (not edge.get("directed") and edge["to"] == active["current_node"] and edge["from"] == target))
                    for edge in graph["edges"]), "Decision is not a transitable neighbor or wait")
                latencies.append(elapsed)
                decision_in_flight = False
                break
            else:
                raise ValueError("Snapshot changed during all authenticated retries")
        deadline = time.monotonic() + args.observe_seconds
        while state["turn"] == initial["turn"] and time.monotonic() < deadline:
            time.sleep(.2)
            status, state, _ = request("/estado")
            require(status == 200, "Snapshot unavailable while observing progress")
        report["checks"]["simulation"] = {
            "initial_turn": initial["turn"], "observed_turn": state["turn"],
            "turn_advanced": state["turn"] > initial["turn"],
            "requests_success": state["metrics"]["requests_success"],
            "requests_invalid": state["metrics"]["requests_invalid"],
            "requests_timeout": state["metrics"]["requests_timeout"],
        }
        require(state["turn"] > initial["turn"], "Simulation did not advance during the observation window")
        require(state["metrics"]["requests_success"] > 0, "No successful internal simulation requests")
        require(state["metrics"]["requests_invalid"] == 0 and state["metrics"]["requests_timeout"] == 0,
                "Simulation reports internal request failures")
        report["complete"] = True
    except (ValueError, KeyError, OSError, urllib.error.URLError) as error:
        # Never echo exception text: proxy/network errors can contain private configuration.
        timed_out = isinstance(getattr(error, "reason", error), TimeoutError)
        report["probe_errors"] = 1
        report["probe_timeouts"] = int(timed_out)
        if decision_in_flight:
            errors += 1
            timeouts += int(timed_out)
        report["failure"] = "Probe failed; inspect completed check statuses and the current active simulation without printing credentials"
    ordered = sorted(latencies)
    report["latency"] = {
        "endpoint": "POST /paso", "request_attempts": attempts,
        "successful_samples": len(ordered), "snapshot_conflicts": conflicts,
        "errors": errors, "timeouts": timeouts,
        "method": "HTTPS transport and JSON receipt; nearest-rank percentiles of successful samples",
        "p50_ms": ordered[math.ceil(.5 * len(ordered)) - 1] if ordered else None,
        "p95_ms": ordered[math.ceil(.95 * len(ordered)) - 1] if ordered else None,
        "p99_ms": ordered[math.ceil(.99 * len(ordered)) - 1] if ordered else None,
        "max_ms": ordered[-1] if ordered else None,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
