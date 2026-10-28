#!/usr/bin/env python3
"""Verify a local hardened image via real HTTP; ephemeral secret, no AWS calls."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='corodev-backend:delivery')
    parser.add_argument('--output', type=Path, default=Path('.local/verification/docker-runtime.json'))
    args = parser.parse_args()
    environment = dict(os.environ, API_KEY=secrets.token_urlsafe(32))
    container = ''

    def docker(*arguments):
        return subprocess.check_output(['docker', *arguments], env=environment, text=True).strip()

    def get(base, path):
        with urllib.request.urlopen(base + path, timeout=3) as response:
            return json.load(response)

    def session_request(base, route, token=None, body=None):
        request = urllib.request.Request(base + route, data=json.dumps(body or {}).encode(), headers={
            'Content-Type': 'application/json',
            **({'Authorization': 'Bearer ' + token} if token else {'Idempotency-Key': secrets.token_hex(16)}),
        })
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    try:
        container = docker('run', '-d', '--name', 'corodev-delivery-verify-' + secrets.token_hex(4),
                           '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                           '--restart', 'unless-stopped', '--memory', '1g', '--cpus', '2', '--pids-limit', '256',
                           '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-p', '127.0.0.1::8080',
                           '-e', 'API_KEY', '-e', 'SCENARIO_PATH=scenarios/urban/round3.json',
                           '-e', 'SIM_INTERVAL=1h', args.image)
        port = docker('port', container, '8080/tcp').rsplit(':', 1)[1]
        base = 'http://127.0.0.1:' + port
        state = None
        for _ in range(60):
            try:
                state = get(base, '/estado')
            except (OSError, ValueError):
                time.sleep(.15)
                continue
            break
        else:
            raise RuntimeError('Container HTTP readiness timed out')
        assert state['turn'] == 0 and state['simulation']['state'] == 'idle'
        assert state['metrics']['requests_success'] == 0, 'Startup must not execute a turn'
        created = session_request(base, '/v1/simulations', body={
            'scenario': 'zombie_outbreak', 'graph_profile': 'BASE', 'seed': 42,
            'max_ticks': 150, 'tick_interval_ms': 2000,
            'config': {'mode': 'official', 'round': 'round3', 'survivors': 200},
        })
        route = '/v1/simulations/' + created['simulation_id']
        token = created['access_token']
        for _ in range(60):
            request = urllib.request.Request(base + route + '/state', headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=5) as response:
                observed = json.load(response)
            if observed['tick'] >= 1:
                break
            time.sleep(.15)
        else:
            raise RuntimeError('Explicit session never completed its first HTTP turn')
        metrics = observed['snapshot']['metrics']
        assert metrics['requests_success'] >= 200 and metrics['requests_invalid'] == 0 and metrics['requests_timeout'] == 0
        session_request(base, route + '/cancel', token)
        assert get(base, '/estado')['turn'] == 0, 'Session changed isolated compatibility runtime'
        graph = get(base, '/grafo')
        assert graph['version'] == 'manta-v2-0ab03290b16a'
        assert len(graph['nodes']) == 300 and len(graph['edges']) == 383
        assert len(graph['spawn_zones']) == 4 and len(state['survivors']) == 200
        assert all(z['type'] != 'sleeper' or z['awake'] for z in state['zombies'])
        assert all(s['occupancy'] + s['reserved'] + s['available'] == s['capacity'] for s in state['shelters'])
        survivor = next(s for s in state['survivors'] if s['status'] == 'active')
        request = urllib.request.Request(base + '/paso', data=json.dumps({
            'sobrevivienteId': survivor['id'], 'nodoActual': survivor['current_node'], 'turno': state['turn']
        }).encode(), headers={'Content-Type': 'application/json', 'x-api-key': environment['API_KEY']})
        with urllib.request.urlopen(request, timeout=1) as response:
            decision = json.load(response)
        assert list(decision) == ['siguienteNodo']
        current, following = survivor['current_node'], decision['siguienteNodo']
        assert following == current or any(
            not edge['blocked'] and edge['id'] not in state['blocked_edges'] and (
                edge['from'] == current and edge['to'] == following or
                not edge['directed'] and edge['to'] == current and edge['from'] == following
            ) for edge in graph['edges'])
        docker('exec', container, '/usr/local/bin/healthcheck')
        info = json.loads(docker('inspect', container))[0]
        assert info['Config']['User'] == '65532:65532' and info['HostConfig']['ReadonlyRootfs']
        assert info['HostConfig']['RestartPolicy']['Name'] == 'unless-stopped'
        image = json.loads(docker('image', 'inspect', args.image))[0]
        result = {
            'deployment': 'local_docker_verified_not_aws', 'image': args.image,
            'image_id': image['Id'], 'image_size_bytes': image['Size'],
            'graph_version': graph['version'], 'nodes': 300, 'edges': 383, 'survivors': 200,
            'checks': {name: 'passed' for name in [
                'nonroot_readonly_restart', 'health_probe', 'idle_startup', 'explicit_session_200_real_internal_http_decisions',
                'authenticated_exact_paso', 'neighbor_and_blocks', 'zones_and_reservations', 'hidden_sleepers_excluded'
            ]},
            'regression_fixed': 'explicit IPv4 wildcard must not advertise unusable IPv6 loopback',
            'aws_deployed': False, 'aws_budget_created': False,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    finally:
        if container:
            subprocess.run(['docker', 'rm', '-f', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
