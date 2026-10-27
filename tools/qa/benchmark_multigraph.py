#!/usr/bin/env python3
"""Local Docker measurements only. No AWS calls, host ports, credentials or hidden spawns."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

IMAGE = 'debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8'


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True, help='Built cmd/multigraph-bench Linux binary')
    parser.add_argument('--output', type=Path, required=True, help='New private report directory')
    parser.add_argument('--modes', nargs='+', choices=['competition', 'full', 'expanded'], default=['competition', 'full'])
    parser.add_argument('--phase', choices=['http', 'round', 'all'], default='all')
    parser.add_argument('--accelerate-reference', action='store_true', help='Explicitly run non-full rounds at interval 0 for deterministic outcomes, not pacing comparisons')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    binary = args.binary.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    (output / 'method.json').write_text(json.dumps({
        'binary_sha256': digest, 'image': IMAGE, 'cpus': 2, 'memory_bytes': 1073741824,
        'gomaxprocs': 2, 'accelerate_reference': args.accelerate_reference,
        'comparison_limit': 'Local capped Docker, not EC2 hardware or AWS latency. Other host tasks may contend. Round pacing is stated separately from HTTP stress.',
    }, indent=2) + '\n')
    failed = False
    for mode in args.modes:
        jobs = [('round3', 'http', '0')] if args.phase != 'round' else []
        if args.phase != 'http':
            interval = '0' if args.accelerate_reference and mode != 'full' else '2s'
            jobs += [('round' + str(n), 'round', interval) for n in (1, 2, 3)]
        for rnd, phase, interval in jobs:
            label = f'{mode}-{rnd}-{phase}'
            name = 'corodev-bench-' + os.urandom(6).hex()
            command = [
                'docker', 'run', '--name', name, '--cpus', '2', '--memory', '1g',
                '--memory-swap', '1g', '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512',
                '--user', f'{os.getuid()}:{os.getgid()}', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
                '--mount', f'type=bind,src={root}/services/evacuation/data,dst=/app/data,readonly',
                '--mount', f'type=bind,src={root}/services/evacuation/scenarios,dst=/app/scenarios,readonly',
                '--mount', f'type=bind,src={binary},dst=/usr/local/bin/bench,readonly',
                '--mount', f'type=bind,src={output},dst=/reports', '--env', 'GOMAXPROCS=2',
                '--workdir', '/app', IMAGE, 'bench', '-mode', mode, '-round', rnd,
                '-phase', phase, '-interval', interval, '-output', '/reports/' + label + '.json',
            ]
            started = time.monotonic()
            try:
                with (output / (label + '.log')).open('w') as log:
                    try:
                        code = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=720, check=False).returncode
                    except subprocess.TimeoutExpired:
                        subprocess.run(['docker', 'kill', name], capture_output=True, check=False)
                        code = 124
                inspect = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True, check=False)
                if inspect.returncode == 0:
                    container = json.loads(inspect.stdout)[0]
                    receipt = {'exit_code': code, 'wall_seconds': time.monotonic() - started,
                               'state': container['State'], 'image': container['Image'],
                               'limits': {key: container['HostConfig'][key] for key in ('Memory', 'MemorySwap', 'NanoCpus', 'NetworkMode', 'ReadonlyRootfs')}}
                    (output / (label + '-container.json')).write_text(json.dumps(receipt, indent=2) + '\n')
                failed = failed or code != 0
                print(label, 'exit', code, flush=True)
            finally:
                subprocess.run(['docker', 'rm', '-f', name], capture_output=True, check=False)

    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
