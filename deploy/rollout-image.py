#!/usr/bin/env python3
"""Replace the two existing EC2 containers, preserving their complete configuration.

Run locally on the Docker host. A private mode-600 recovery file never leaves
that host. Cleanup is a separate action after external HTTPS verification.
"""
import argparse
import copy
import http.client
import json
import os
from pathlib import Path
import socket
import time
from urllib.parse import quote


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=60)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class Docker:
    def __init__(self):
        self.version = ''
        self.version = '/v' + self.request('GET', '/version')['ApiVersion']

    def request(self, method, path, body=None, missing=False):
        connection = DockerConnection()
        raw = None if body is None else json.dumps(body).encode()
        try:
            connection.request(method, self.version + path, raw, {'Content-Type': 'application/json'})
            response = connection.getresponse()
            data = response.read()
            if missing and response.status == 404:
                return None
            if response.status >= 400:
                # Never emit private container configuration or daemon details.
                raise RuntimeError(f'Docker operation {method} failed ({response.status})')
            return json.loads(data) if data else None
        finally:
            connection.close()

    def inspect(self, name):
        return self.request('GET', '/containers/' + quote(name, safe='') + '/json', missing=True)

    def stop(self, name):
        self.request('POST', f'/containers/{quote(name, safe="")}/stop?t=10')

    def rename(self, old, new):
        self.request('POST', f'/containers/{quote(old, safe="")}/rename?name={quote(new, safe="")}')

    def start(self, name):
        self.request('POST', f'/containers/{quote(name, safe="")}/start')

    def remove(self, name):
        self.request('DELETE', f'/containers/{quote(name, safe="")}?v=false')

    def create(self, name, source, image, backend_id=None):
        config = copy.deepcopy(source['Config'])
        config['Image'] = image
        config['HostConfig'] = copy.deepcopy(source['HostConfig'])
        if backend_id:
            config['HostConfig']['NetworkMode'] = 'container:' + backend_id
            # Inspect resolves an inherited hostname; Docker create forbids
            # an explicit hostname for a shared network namespace.
            config['Hostname'] = ''
            config['Domainname'] = ''
            config['ExposedPorts'] = {}
        return self.request('POST', '/containers/create?name=' + quote(name, safe=''), config)['Id']


def healthy(docker, backend, laboratory):
    backend_state = docker.inspect(backend)['State']
    lab_state = docker.inspect(laboratory)['State']
    if not backend_state['Running'] or not lab_state['Running']:
        return False
    if backend_state.get('Health', {}).get('Status') != 'healthy':
        return False
    connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=5)
    try:
        connection.request('GET', '/lab/catalog')
        response = connection.getresponse()
        response.read()
        return response.status == 200
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['replace', 'cleanup'])
    parser.add_argument('--image', required=True)
    parser.add_argument('--recovery', type=Path, required=True)
    parser.add_argument('--suffix', default='before-mantasim')
    parser.add_argument('--backend', default='corodev-backend')
    parser.add_argument('--laboratory', default='corodev-flood-lab')
    args = parser.parse_args()
    docker = Docker()
    target_image = docker.request('GET', '/images/' + quote(args.image, safe='') + '/json')['Id']
    backend, laboratory = args.backend, args.laboratory
    previous_backend, previous_lab = backend + '-' + args.suffix, laboratory + '-' + args.suffix
    if args.action == 'cleanup':
        recovery = json.loads(args.recovery.read_text())
        if recovery['target_image'] != target_image or not healthy(docker, backend, laboratory):
            raise RuntimeError('Cleanup requires the verified replacement image and healthy services')
        if docker.inspect(backend)['Image'] != target_image or docker.inspect(laboratory)['Image'] != target_image:
            raise RuntimeError('Active containers changed; refusing cleanup')
        for name in [previous_lab, previous_backend]:
            item = docker.inspect(name)
            if item:
                if item['State']['Running']:
                    raise RuntimeError('Previous container still running; refusing cleanup')
                docker.remove(name)
        old_images = {recovery['backend']['Image'], recovery['laboratory']['Image']} - {target_image}
        for image in old_images:
            docker.request('DELETE', '/images/' + quote(image, safe='') + '?force=false&noprune=true')
        # The private configuration remains only in the existing host config;
        # the recovery file is unnecessary after removal of previous containers.
        args.recovery.unlink()
        print(json.dumps({'cleanup': 'complete', 'previous_images_removed': sorted(old_images), 'active_image': target_image}))
        return
    if args.recovery.exists() or docker.inspect(previous_backend) or docker.inspect(previous_lab):
        raise RuntimeError('Existing recovery artifacts require review before another replacement')
    old_backend, old_lab = docker.inspect(backend), docker.inspect(laboratory)
    if not old_backend or not old_lab or not old_backend['State']['Running'] or not old_lab['State']['Running']:
        raise RuntimeError('Both original containers must exist and run')
    if old_backend['Image'] == target_image and old_lab['Image'] == target_image:
        raise RuntimeError('Replacement image is already active')
    args.recovery.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(args.recovery, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump({'backend': old_backend, 'laboratory': old_lab, 'target_image': target_image}, stream)
    try:
        docker.stop(laboratory)
        docker.rename(laboratory, previous_lab)
        docker.stop(backend)
        docker.rename(backend, previous_backend)
        new_backend = docker.create(backend, old_backend, args.image)
        docker.start(backend)
        docker.create(laboratory, old_lab, args.image, new_backend)
        docker.start(laboratory)
        for _ in range(60):
            try:
                if healthy(docker, backend, laboratory):
                    print(json.dumps({'replacement': 'healthy', 'active_image': target_image, 'previous_images_retained_for_external_verification': True}))
                    return
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(1)
        raise RuntimeError('Replacement did not become healthy')
    except Exception:
        # Roll back only names which were actually moved; leave unrelated data.
        for original, previous in [(laboratory, previous_lab), (backend, previous_backend)]:
            if docker.inspect(previous):
                current = docker.inspect(original)
                if current:
                    if current['State']['Running']:
                        docker.stop(original)
                    docker.remove(original)
                docker.rename(previous, original)
        for name in [backend, laboratory]:
            if not docker.inspect(name)['State']['Running']:
                docker.start(name)
        raise


if __name__ == '__main__':
    main()
