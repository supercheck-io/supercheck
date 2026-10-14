"""Rendered Compose routing regressions; run via validate.sh for placeholder env."""
import json
import os
from pathlib import Path
import subprocess
import unittest

DEPLOY = Path(__file__).resolve().parent


class ComposeTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
