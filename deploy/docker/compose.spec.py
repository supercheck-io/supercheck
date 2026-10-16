"""Rendered Compose routing regressions; run via validate.sh for placeholder env."""
import json
import os
from pathlib import Path
import subprocess
import unittest

DEPLOY = Path(__file__).resolve().parent


class ComposeTests(unittest.TestCase):
    def test_worker_queue_roles_are_forwarded_without_changing_self_hosted_defaults(self):
        for file in ('docker-compose.yml', 'docker-compose-local.yml',
                     'docker-compose-external.yml', 'docker-compose-secure.yml',
                     'docker-compose-worker.yml'):
            for queues in ('', 'monitor'):
                with self.subTest(file=file, queues=queues):
                    env = {key: value for key, value in os.environ.items()
                           if key not in ('COMPOSE_PROFILES', 'WORKER_QUEUES')}
                    env['WORKER_QUEUES'] = queues
                    result = subprocess.run(
                        ['docker', 'compose', '--env-file', '/dev/null', '-f', file,
                         'config', '--format', 'json'],
                        cwd=DEPLOY, env=env, text=True,
                        capture_output=True, check=True, timeout=30)
                    worker = json.loads(result.stdout)['services']['worker']
                    self.assertEqual(worker['environment']['WORKER_QUEUES'], queues)

    def test_traefik_selects_shared_network_without_losing_private_agent_access(self):
        for file in ('docker-compose.yml', 'docker-compose-secure.yml'):
            for project in ('default', 'environment', 'cli'):
                for private_agent in (False, True):
                    with self.subTest(file=file, project=project, private_agent=private_agent):
                        env = {key: value for key, value in os.environ.items()
                               if key not in ('COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES')}
                        command = ['docker', 'compose', '--env-file', '/dev/null',
                                   '-f', file, '--profile', 'https']
                        if project != 'default':
                            env['COMPOSE_PROJECT_NAME'] = 'env-project'
                        if project == 'cli':
                            command += ['--project-name', 'cli-project']
                        if private_agent:
                            command += ['--profile', 'private-agent']
                        result = subprocess.run(command + ['config', '--format', 'json'],
                                                cwd=DEPLOY, env=env, text=True,
                                                capture_output=True, check=True, timeout=30)
                        config = json.loads(result.stdout)
                        expected_project = {'default': 'supercheck', 'environment': 'env-project',
                                            'cli': 'cli-project'}[project]
                        self.assertEqual(config['name'], expected_project)
                        services = config['services']
                        network = config['networks']['supercheck-network']['name']
                        self.assertEqual(services['app']['labels'].get('traefik.docker.network'), network)
                        self.assertIn('supercheck-network', services['app']['networks'])
                        self.assertIn('supercheck-network', services['traefik']['networks'])
                        self.assertIn('private-agent-network', services['app']['networks'])
                        if private_agent:
                            self.assertIn('private-agent-network', services['private-agent']['networks'])


    def test_local_services_publish_only_on_loopback_with_port_overrides(self):
        defaults = {'postgres': 5432, 'redis': 6379, 'rustfs': 9000}
        variables = {'postgres': 'DB_HOST_PORT', 'redis': 'REDIS_HOST_PORT',
                     'rustfs': 'RUSTFS_HOST_PORT'}
        for overridden in (False, True):
            with self.subTest(overridden=overridden):
                env = {key: value for key, value in os.environ.items()
                       if key not in (*variables.values(), 'COMPOSE_PROFILES')}
                expected = {name: port + (10000 if overridden else 0)
                            for name, port in defaults.items()}
                if overridden:
                    env.update({variables[name]: str(port)
                                for name, port in expected.items()})
                result = subprocess.run(
                    ['docker', 'compose', '--env-file', '/dev/null',
                     '-f', 'docker-compose-local.yml', 'config', '--format', 'json'],
                    cwd=DEPLOY, env=env, text=True,
                    capture_output=True, check=True, timeout=30)
                services = json.loads(result.stdout)['services']
                for name, port in expected.items():
                    with self.subTest(service=name):
                        published = services[name]['ports']
                        self.assertEqual(len(published), 1)
                        self.assertEqual(published[0]['host_ip'], '127.0.0.1')
                        self.assertEqual(int(published[0]['published']), port)
                        self.assertEqual(published[0]['target'], defaults[name])
                        self.assertEqual(published[0]['protocol'], 'tcp')


if __name__ == '__main__':
    unittest.main()
