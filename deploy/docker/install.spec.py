"""Installer regressions using isolated files and stubbed host commands."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parent


class InstallerTests(unittest.TestCase):
    def test_execution_tcp_egress_excludes_private_overlay_peers(self):
        import ipaddress
        source = (DEPLOY / 'setup-k3s.sh').read_text()
        policy = source.split('name: execution-egress', 1)[1].split('\nYAML', 1)[0]
        exclusions = policy.split('except:', 1)[1].split('      ports:', 1)[0]
        networks = [ipaddress.ip_network(line.strip()[2:])
                    for line in exclusions.splitlines() if line.strip().startswith('- ')]
        for address in ('10.0.0.1', '172.16.0.1', '192.168.0.1',
                        '169.254.169.254', '100.64.0.1', '100.127.255.254'):
            with self.subTest(address=address):
                self.assertTrue(any(ipaddress.ip_address(address) in network for network in networks))
        self.assertFalse(any(ipaddress.ip_address('1.1.1.1') in network for network in networks))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        source = (DEPLOY / "install.sh").read_text()
        self.assertTrue(source.endswith('main "$@"\n'))
        source = source.rsplit('main "$@"', 1)[0]
        source = source.replace('$EUID', '$INSTALL_TEST_EUID')
        source = source.replace('/var/log/supercheck', str(self.root / 'logs'))
        source = source.replace('/run/supercheck-install.lock', str(self.root / 'lock'))
        (self.root / 'functions.sh').write_text(source)

    def run_shell(self, body, code=0):
        result = subprocess.run(['bash', '-c', 'source "$TEST_ROOT/functions.sh"\n'
                                 'COMPOSE_DIR="$TEST_ROOT/compose"\n'
                                 'mkdir -p "$COMPOSE_DIR"\n' + body],
                                # Port overrides from the caller's shell would mask the .env fixtures.
                                env={**{k: v for k, v in os.environ.items() if k not in ('DB_HOST_PORT', 'REDIS_HOST_PORT')}, 'TEST_ROOT': str(self.root),
                                     'INSTALL_TEST_EUID': '0', 'NO_COLOR': '1', 'TMPDIR': str(self.root)},
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def test_custom_project_rerun_uses_labels(self):
        self.run_shell(r'''COMPOSE_PROJECT_NAME=acme
port_in_use() { [[ "$1" == 3000 ]]; }
docker() {
  [[ "$*" == *"label=com.docker.compose.project=acme"* ]] || return 1
  echo '0.0.0.0:3000->3000/tcp'
}
check_ports
''')

    def test_unrelated_listener_is_rejected(self):
        self.run_shell(r'''port_in_use() { [[ "$1" == 3000 ]]; }
docker() { :; }
check_ports
''', 1)

    def test_local_postgres_listener_is_rejected(self):
        output = self.run_shell(r'''port_in_use() { [[ "$1" == 5432 ]]; }
docker() { :; }
check_ports
''', 1)
        self.assertIn('Port 5432', output)
        self.assertIn('DB_HOST_PORT', output)

    def test_moved_database_and_redis_ports_are_checked(self):
        output = self.run_shell(r'''printf 'DB_HOST_PORT=15432\nREDIS_HOST_PORT=16379\n' > "$COMPOSE_DIR/.env"
port_in_use() { [[ "$1" == 16379 ]]; }
docker() { :; }
check_ports
''', 1)
        self.assertIn('Port 16379', output)
        self.run_shell(r'''printf 'DB_HOST_PORT=15432\n' > "$COMPOSE_DIR/.env"
port_in_use() { [[ "$1" == 5432 ]]; }
docker() { :; }
check_ports
''')

    def test_env_port_with_carriage_return_is_checked(self):
        output = self.run_shell(r'''printf 'DB_HOST_PORT=15432\r\n' > "$COMPOSE_DIR/.env"
port_in_use() { [[ "$1" == 15432 ]]; }
docker() { :; }
check_ports
''', 1)
        self.assertIn('Port 15432', output)

    def test_exported_database_port_overrides_env_file(self):
        self.run_shell(r'''export DB_HOST_PORT=15432
port_in_use() { [[ "$1" == 5432 ]]; }
docker() { :; }
check_ports
''')

    def test_failed_migration_volume_does_not_unlock_install(self):
        output = self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { if [[ "$*" == *MemTotal* ]]; then echo 8000000; else cat >/dev/null; echo 20; fi; }
nproc() { echo 2; }
df() { echo placeholder; }
curl() { :; }
docker() { [[ "$*" == 'volume ls -q' ]] && printf '%s\n' supercheck_minio-data supercheck_rustfs-data || true; }
echo 'S3_ENDPOINT=http://minio:9000' > "$COMPOSE_DIR/.env"
preflight
''', 1)
        self.assertIn('MinIO', output)

    def test_domain_switch_updates_only_previous_origins(self):
        self.run_shell(r'''cat > "$COMPOSE_DIR/.env" <<'EOF'
BETTER_AUTH_SECRET=fixture
COMPOSE_PROFILES=private-agent,https
APP_DOMAIN=old.example.com
ACME_EMAIL=old@example.com
STATUS_PAGE_DOMAIN=status.example.com
NEXT_PUBLIC_APP_URL=https://old.example.com
APP_URL=https://old.example.com
BETTER_AUTH_URL=https://custom-auth.example.com
EOF
DOMAIN=new.example.com
EMAIL=new@example.com
apply_public_config
''')
        config = (self.root / 'compose/.env').read_text()
        self.assertIn('NEXT_PUBLIC_APP_URL=https://new.example.com', config)
        self.assertIn('APP_URL=https://new.example.com', config)
        self.assertIn('BETTER_AUTH_URL=https://custom-auth.example.com', config)
        self.assertIn('STATUS_PAGE_DOMAIN=status.example.com', config)
        self.assertIn('BETTER_AUTH_SECRET=fixture', config)
        self.assertEqual((self.root / 'compose/.env').stat().st_mode & 0o777, 0o600)

    def test_selected_version_is_saved_without_changing_secrets(self):
        self.run_shell(r'''printf '%s\n' BETTER_AUTH_SECRET=fixture SUPERCHECK_VERSION=1.3.6 > "$COMPOSE_DIR/.env"
USING_THIS_CHECKOUT=false
VERSION_SET=true
VERSION=1.4.0
persist_version
''')
        self.assertEqual((self.root / 'compose/.env').read_text(),
                         'BETTER_AUTH_SECRET=fixture\nSUPERCHECK_VERSION=1.4.0\n')

    def test_checkout_version_flag_is_ignored(self):
        self.run_shell(r'''echo SUPERCHECK_VERSION=1.3.6 > "$COMPOSE_DIR/.env"
USING_THIS_CHECKOUT=true
VERSION_SET=true
VERSION=1.4.0
persist_version
''')
        self.assertEqual((self.root / 'compose/.env').read_text(), 'SUPERCHECK_VERSION=1.3.6\n')

    def test_invalid_release_fails_before_installing_packages(self):
        output = self.run_shell(r'''USING_THIS_CHECKOUT=false
VERSION=9.9.9
curl() { return 22; }
INSTALL_DIR="$TEST_ROOT/target"
COMPOSE_DIR=""
MODE=local
preflight() { :; }
check_ports() { :; }
docker_ready() { return 1; }
git() { return 2; }
install_prerequisites() { touch "$TEST_ROOT/packages-installed"; }
main
''', 1)
        self.assertIn('Release v9.9.9', output)
        self.assertFalse((self.root / 'packages-installed').exists())

    def test_no_flag_rerun_does_not_pin_a_new_default(self):
        self.run_shell(r'''echo BETTER_AUTH_SECRET=fixture > "$COMPOSE_DIR/.env"
USING_THIS_CHECKOUT=false
SOURCE_FETCHED=false
VERSION_SET=false
VERSION=1.4.0
persist_version
''')
        self.assertEqual((self.root / 'compose/.env').read_text(), 'BETTER_AUTH_SECRET=fixture\n')

    def test_https_and_version_changes_keep_separate_backups(self):
        self.run_shell(r'''printf '%s\n' BETTER_AUTH_SECRET=fixture APP_DOMAIN=old.example.com > "$COMPOSE_DIR/.env"
date() { echo 20261013120000; }
DOMAIN=new.example.com
EMAIL=admin@example.com
apply_public_config
USING_THIS_CHECKOUT=false
VERSION_SET=true
VERSION=1.4.0
persist_version
''')
        backups = list((self.root / 'compose').glob('.env.bak-*'))
        self.assertEqual(len(backups), 2)
        self.assertTrue(any('APP_DOMAIN=old.example.com' in p.read_text() for p in backups))
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in backups))

    def test_quoted_local_urls_follow_https_configuration(self):
        self.run_shell(r'''cat > "$COMPOSE_DIR/.env" <<'EOF'
BETTER_AUTH_SECRET=fixture
APP_URL="http://localhost:3000"
BETTER_AUTH_URL='http://127.0.0.1:3000'
NEXT_PUBLIC_APP_URL=https://custom.example.com
EOF
DOMAIN=new.example.com
EMAIL=admin@example.com
apply_public_config
''')
        config = (self.root / 'compose/.env').read_text()
        self.assertNotIn('localhost', config)
        self.assertNotIn('127.0.0.1', config)
        self.assertIn('APP_URL=https://new.example.com', config)
        self.assertIn('NEXT_PUBLIC_APP_URL=https://custom.example.com', config)

    def test_stale_env_temporary_files_are_private_before_writes(self):
        self.run_shell(r'''printf '%s\n' BETTER_AUTH_SECRET=fixture APP_URL=https://old.example.com APP_DOMAIN=old.example.com > "$COMPOSE_DIR/.env"
touch "$COMPOSE_DIR/.env.new" "$COMPOSE_DIR/.env.filtered"
chmod 644 "$COMPOSE_DIR/.env.new" "$COMPOSE_DIR/.env.filtered"
grep() {
  if [[ "$1" == -v ]] && [[ "$*" == *SUPERCHECK_VERSION* || "$*" == *COMPOSE_PROFILES* ]]; then
    [[ $(find .env.new -perm -004 -print) == '' ]] || exit 90
  fi
  command grep "$@"
}
sed() {
  if [[ "$*" == *'.env.new'* ]]; then
    [[ $(find .env.filtered -perm -004 -print) == '' ]] || exit 90
  fi
  command sed "$@"
}
DOMAIN=new.example.com
EMAIL=admin@example.com
apply_public_config
touch .env.new
chmod 644 .env.new
USING_THIS_CHECKOUT=false
VERSION_SET=true
VERSION=1.4.0
persist_version
''')

    def test_existing_admin_permissions_fixed_before_gvisor_failure(self):
        k3s = (DEPLOY / 'setup-k3s.sh').read_text().replace('$EUID', '$INSTALL_TEST_EUID')
        for prefix in ['/etc/rancher/k3s', '/etc/systemd/system', '/usr/local/bin']:
            k3s = k3s.replace(prefix, str(self.root / prefix.lstrip('/')))
        (self.root / 'setup-fixture.sh').write_text(k3s)
        admin = self.root / 'etc/rancher/k3s/k3s.yaml'
        admin.parent.mkdir(parents=True)
        admin.write_text('fixture')
        admin.chmod(0o644)
        service = self.root / 'etc/systemd/system/k3s.service'
        service.parent.mkdir(parents=True)
        service.write_text("ExecStart=k3s \\\n '--write-kubeconfig-mode' \\\n '644' \\\n")
        self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
sha512sum() { :; }
bzip2() { :; }
ip() { echo '1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.2'; }
k3s() { :; }
systemctl() { :; }
curl() { return 22; }
source "$TEST_ROOT/setup-fixture.sh"
''', 22)
        self.assertEqual(admin.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("'644'", service.read_text())

    def test_completed_migration_and_explicit_ignore_are_accepted(self):
        for endpoint, ignore in [('http://rustfs:9000', 'false'), ('http://minio:9000', 'true')]:
            with self.subTest(endpoint=endpoint, ignore=ignore):
                self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { if [[ "$*" == *MemTotal* ]]; then echo 8000000; else cat >/dev/null; echo 20; fi; }
nproc() { echo 2; }
df() { echo placeholder; }
curl() { :; }
docker() { [[ "$*" == 'volume ls -q' ]] && printf '%s\n' supercheck_minio-data supercheck_rustfs-data || true; }
''' + f'IGNORE_MINIO={ignore}\necho S3_ENDPOINT={endpoint} > "$COMPOSE_DIR/.env"\npreflight\n')

    def test_new_source_version_is_persisted_and_idempotent(self):
        self.run_shell(r'''echo BETTER_AUTH_SECRET=fixture > "$COMPOSE_DIR/.env"
USING_THIS_CHECKOUT=false
SOURCE_FETCHED=true
VERSION_SET=false
VERSION=1.4.0
unset SUPERCHECK_VERSION
persist_version
persist_version
''')
        self.assertIn('SUPERCHECK_VERSION=1.4.0', (self.root / 'compose/.env').read_text())
        self.assertEqual(len(list((self.root / 'compose').glob('.env.bak-*'))), 1)

    def test_existing_docker_still_installs_missing_network_tools(self):
        self.run_shell(r'''touch "$TEST_ROOT/docker-compose.yml" "$TEST_ROOT/init-secrets.sh" "$TEST_ROOT/setup-k3s.sh"
echo BETTER_AUTH_SECRET=fixture > "$TEST_ROOT/.env"
MODE=local
preflight() { :; }
check_ports() { :; }
docker_ready() { return 0; }
command() {
  [[ "$*" != '-v ip' ]] || return 1
  builtin command "$@"
}
install_prerequisites() { touch "$TEST_ROOT/packages-installed"; }
setup_sandbox() { :; }
pull_images() { :; }
start_stack() { :; }
dc() { [[ "$*" == config ]] && echo 'WORKER_IMAGE: worker:latest' || true; }
curl() { echo '{"status":"ok"}'; }
main
''')
        self.assertTrue((self.root / 'packages-installed').exists())

    def test_worker_credential_is_private_before_final_chmod(self):
        source = (DEPLOY / 'setup-k3s.sh').read_text()
        start = source.index('WORKER_KUBECONFIG_TMP="$(mktemp')
        end = source.index('log "Restricted worker kubeconfig', start)
        snippet = source[start:end]
        self.run_shell(r'''WORKER_KUBECONFIG="$TEST_ROOT/worker.kubeconfig"
API_SERVER=https://fixture
CA_DATA=fixture
TOKEN=fixture
chgrp() { :; }
chmod() {
  [[ $(find "$2" -perm -004 -print) == '' ]] || exit 90
  command chmod "$@"
}
umask 022
''' + snippet)
        self.assertEqual((self.root / 'worker.kubeconfig').stat().st_mode & 0o777, 0o440)
        self.assertEqual(len(list(self.root.glob('worker.kubeconfig.*'))), 0)

    def test_demo_deployment_requires_completed_storage_migration(self):
        source = (DEPLOY.parent.parent / '.github/scripts/deploy-demo.sh').read_text()
        start = source.index('ensure_storage_migrated() {')
        end = source.index('\n}', start) + 2
        function = source[start:end]
        for legacy, orphan, code in [('minio', '', 78), ('rustfs', 'old-minio-id', 78), ('rustfs', '', 0)]:
            with self.subTest(legacy=legacy, orphan=orphan):
                self.run_shell(function + r'''
COMPOSE_FILE=docker-compose-secure.yml
docker() {
  case "$*" in
    *'config --services'*) printf '%s\n' app worker "$LEGACY_SERVICE" ;;
    *'config'*) echo 'name: custom-demo' ;;
    *'ps -aq'*)
      [[ "$*" == *'label=com.docker.compose.project=custom-demo'* ]] || return 1
      printf '%s' "$ORPHAN" ;;
    *) return 1 ;;
  esac
}
''' + f'LEGACY_SERVICE={legacy}\nORPHAN={orphan}\nensure_storage_migrated || exit 78\n', code)

    def test_admin_mode_upgrade_handles_systemd_argument_formats(self):
        source = (DEPLOY / 'setup-k3s.sh').read_text()
        start = source.index('secure_kubeconfig() {')
        end = source.index('\n}', start) + 2
        function = source[start:end]
        for option in ["--write-kubeconfig-mode 0644", "'--write-kubeconfig-mode' '644'", '"--write-kubeconfig-mode=0644"']:
            with self.subTest(option=option):
                service = self.root / 'k3s.service'
                service.write_text(f'ExecStart=k3s server {option} --tls-san 192.168.0.64\n')
                admin = self.root / 'admin.yaml'
                admin.write_text('fixture')
                admin.chmod(0o644)
                self.run_shell(function + '\nsystemctl() { :; }\nsecure_kubeconfig "$TEST_ROOT/k3s.service" "$TEST_ROOT/admin.yaml"\n')
                self.assertNotIn('644', service.read_text())
                self.assertIn('600', service.read_text())
                self.assertIn('--tls-san 192.168.0.64', service.read_text())
                self.assertEqual(admin.stat().st_mode & 0o777, 0o600)

    def test_migration_keeps_private_unique_rollback_backups(self):
        migration = self.root / 'migration'
        migration.mkdir()
        (migration / 'migrate.sh').write_text((DEPLOY / 'migrate-minio-to-rustfs.sh').read_text())
        binaries = self.root / 'bin'
        binaries.mkdir()
        (binaries / 'docker').write_text(r'''#!/usr/bin/env bash
case "$*" in
  'compose ps -q minio') echo minio-id ;;
  inspect*) [[ "$*" == *com.docker.compose.project* ]] && echo fixture-project || echo fixture-network ;;
  *) exit 0 ;;
esac
''')
        (binaries / 'date').write_text('#!/bin/sh\necho 20261013120000\n')
        (binaries / 'chmod').write_text(r'''#!/usr/bin/env bash
if [[ "$*" == '600 .env.pre-rustfs' ]]; then
  [[ $(find .env.pre-rustfs -perm -004 -print) == '' ]] || touch "$TEST_ROOT/exposed-backup"
fi
exec /bin/chmod "$@"
''')
        for binary in binaries.iterdir():
            binary.chmod(0o755)
        original = 'S3_ENDPOINT=http://minio:9000\nAWS_ACCESS_KEY_ID=fixture\nAWS_SECRET_ACCESS_KEY=fixture\n'
        for attempt in range(3):
            expected_backup = original + ('COMPOSE_PROJECT_NAME=previous-project\n' if attempt else '')
            config = migration / '.env'
            config.write_text(expected_backup)
            config.chmod(0o644)
            self.run_shell('export PATH="$TEST_ROOT/bin:$PATH"\nbash "$TEST_ROOT/migration/migrate.sh" --yes\n')
            self.assertEqual((migration / '.env.pre-rustfs').read_text(), expected_backup)
            self.assertIn('COMPOSE_PROJECT_NAME=fixture-project\n', config.read_text())
            self.assertEqual(config.read_text().count('COMPOSE_PROJECT_NAME='), 1)
            self.assertEqual((migration / '.env.pre-rustfs').stat().st_mode & 0o777, 0o600)
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertFalse((self.root / 'exposed-backup').exists())
            self.assertEqual(len(list(migration.glob('.env.pre-rustfs.*'))), attempt)

    def test_admin_permission_upgrade_allows_interrupted_first_start(self):
        source = (DEPLOY / 'setup-k3s.sh').read_text()
        start = source.index('secure_kubeconfig() {')
        end = source.index('\n}', start) + 2
        service = self.root / 'k3s.service'
        service.write_text('ExecStart=k3s server --write-kubeconfig-mode=644\n')
        self.run_shell(source[start:end] + '\nsystemctl() { :; }\nsecure_kubeconfig "$TEST_ROOT/k3s.service" "$TEST_ROOT/not-created.yaml"\n')
        self.assertIn('--write-kubeconfig-mode=600', service.read_text())
        self.assertFalse((self.root / 'not-created.yaml').exists())

    def test_invalid_version_does_not_modify_an_existing_standalone_install(self):
        self.run_shell(r'''INSTALL_DIR="$TEST_ROOT/target"
COMPOSE_DIR=""
mkdir -p "$INSTALL_DIR/deploy/docker"
touch "$INSTALL_DIR/deploy/docker/init-secrets.sh"
printf '%s\n' BETTER_AUTH_SECRET=fixture SUPERCHECK_VERSION=1.3.6 > "$INSTALL_DIR/deploy/docker/.env"
MODE=local
VERSION_SET=true
VERSION=9.9.9
preflight() { :; }
check_ports() { :; }
docker_ready() { return 1; }
curl() { return 22; }
install_prerequisites() { touch "$TEST_ROOT/packages-installed"; }
setup_sandbox() { :; }
pull_images() { return 1; }
main
''', 1)
        self.assertEqual((self.root / 'target/deploy/docker/.env').read_text(),
                         'BETTER_AUTH_SECRET=fixture\nSUPERCHECK_VERSION=1.3.6\n')
        self.assertFalse((self.root / 'packages-installed').exists())

    def test_rustfs_configuration_without_its_volume_still_blocks_minio_upgrade(self):
        output = self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { if [[ "$*" == *MemTotal* ]]; then echo 8000000; else cat >/dev/null; echo 20; fi; }
nproc() { echo 2; }
df() { echo placeholder; }
curl() { :; }
docker() { [[ "$*" == 'volume ls -q' ]] && echo supercheck_minio-data || true; }
echo S3_ENDPOINT=http://rustfs:9000 > "$COMPOSE_DIR/.env"
preflight
''', 1)
        self.assertIn('MinIO', output)

    def test_demo_guard_handles_a_quoted_numeric_project_name(self):
        source = (DEPLOY.parent.parent / '.github/scripts/deploy-demo.sh').read_text()
        start = source.index('ensure_storage_migrated() {')
        end = source.index('\n}', start) + 2
        self.run_shell(source[start:end] + r'''
COMPOSE_FILE=docker-compose-secure.yml
docker() {
  case "$*" in
    *'config --services'*) printf '%s\n' app worker rustfs ;;
    *'config'*) echo 'name: "00123"' ;;
    *'ps -aq'*)
      [[ "$*" != *'label=com.docker.compose.project=00123'* ]] || echo old-minio-id
      return 0 ;;
    *) return 1 ;;
  esac
}
ensure_storage_migrated || exit 78
''', 78)

    def test_explicit_ignore_rejects_retained_minio_container(self):
        output = self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { if [[ "$*" == *MemTotal* ]]; then echo 8000000; else cat >/dev/null; echo 20; fi; }
nproc() { echo 2; }
df() { echo placeholder; }
curl() { :; }
docker() {
  case "$*" in
    'volume ls -q') echo supercheck_minio-data ;;
    *'ps -aq'*'label=com.docker.compose.service=minio'*) echo retained-minio ;;
    *) return 0 ;;
  esac
}
IGNORE_MINIO=true
preflight
''', 1)
        self.assertIn("Remove the old project's MinIO container", output)

    def test_explicit_ignore_fails_closed_when_container_query_fails(self):
        output = self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { if [[ "$*" == *MemTotal* ]]; then echo 8000000; else cat >/dev/null; echo 20; fi; }
nproc() { echo 2; }
df() { echo placeholder; }
curl() { :; }
docker() {
  case "$*" in
    'volume ls -q') echo supercheck_minio-data ;;
    *'ps -aq'*'label=com.docker.compose.service=minio'*) return 1 ;;
    *) return 0 ;;
  esac
}
IGNORE_MINIO=true
preflight
''', 1)
        self.assertIn("Cannot verify whether", output)

    def test_explicit_fresh_storage_preserves_secrets_and_creates_missing_keys(self):
        self.run_shell(r'''cat > "$COMPOSE_DIR/.env" <<'EOF'
BETTER_AUTH_SECRET=fixture
POSTGRES_PASSWORD=database-fixture
ENCRYPTION_KEY=encryption-fixture
S3_ENDPOINT=http://minio:9000
AWS_ACCESS_KEY_ID=existing-key
AWS_SECRET_ACCESS_KEY=
EOF
IGNORE_MINIO=true
apply_fresh_storage_config
''')
        env = (self.root / 'compose/.env').read_text()
        for line in ['BETTER_AUTH_SECRET=fixture', 'POSTGRES_PASSWORD=database-fixture',
                     'ENCRYPTION_KEY=encryption-fixture', 'AWS_ACCESS_KEY_ID=existing-key',
                     'S3_ENDPOINT=http://rustfs:9000']:
            self.assertIn(line, env)
        self.assertRegex(env, r'AWS_SECRET_ACCESS_KEY=[0-9a-f]{64}\n')
        backups = list((self.root / 'compose').glob('.env.bak-*'))
        self.assertEqual(len(backups), 1)
        self.assertIn('S3_ENDPOINT=http://minio:9000', backups[0].read_text())
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)

    def test_fresh_storage_requires_explicit_flag_and_preserves_external_origins(self):
        for endpoint, ignore in [('http://minio:9000', 'false'), ('https://external.example.com', 'true')]:
            original = f'BETTER_AUTH_SECRET=fixture\nS3_ENDPOINT={endpoint}\n'
            (self.root / 'compose').mkdir(exist_ok=True)
            (self.root / 'compose/.env').write_text(original)
            self.run_shell(f'IGNORE_MINIO={ignore}\napply_fresh_storage_config\n')
            self.assertEqual((self.root / 'compose/.env').read_text(), original)

    def test_private_backup_permissions_for_new_and_existing_files(self):
        self.run_shell(r'''umask 022
file="$TEST_ROOT/backup.sql"
install -m 600 /dev/null "$file"
echo fixture > "$file"
chmod 644 "$file"
install -m 600 /dev/null "$file"
echo fixture > "$file"
''')
        self.assertEqual((self.root / 'backup.sql').stat().st_mode & 0o777, 0o600)


    def test_prompts_need_only_a_readable_tty_not_a_tty_stdout(self):
        out = self.run_shell(r'''ASSUME_YES=false; IS_TTY=false
tty_readable() { return 0; }
detect_can_prompt; echo "A=$CAN_PROMPT"
tty_readable() { return 1; }
detect_can_prompt; echo "B=$CAN_PROMPT"
ASSUME_YES=true; tty_readable() { return 0; }
detect_can_prompt; echo "C=$CAN_PROMPT"
''')
        self.assertIn('A=true', out)
        self.assertIn('B=false', out)
        self.assertIn('C=false', out)

    def test_no_terminal_error_suggests_flags(self):
        source = (DEPLOY / 'install.sh').read_text()
        self.assertIn('Pass --local, or --domain <host> --email <address>, or use --yes', source)

    def test_disk_check_uses_docker_root_dir(self):
        out = self.run_shell(r'''mkdir -p "$TEST_ROOT/docker"
docker() { [[ "$*" == "info -f {{.DockerRootDir}}" ]] && echo "$TEST_ROOT/docker/lib/missing" || true; }
echo "P=$(docker_data_path)"
docker() { return 1; }
echo "F=$(docker_data_path)"
''')
        self.assertIn('P=%s/docker\n' % self.root, out)
        self.assertIn('F=/\n', out)

    def test_preflight_measures_the_docker_data_path(self):
        self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { if [[ "$*" == *MemTotal* ]]; then echo 8000000; else cat >/dev/null; echo 20; fi; }
nproc() { echo 2; }
docker_data_path() { echo /srv/dockerdata; }
df() { echo "$*" > "$TEST_ROOT/df-args"; echo x; }
curl() { :; }
docker() { :; }
preflight
''')
        self.assertEqual((self.root / 'df-args').read_text().strip(), '-Pk /srv/dockerdata')

    def test_dns_mismatch_warns_and_matching_does_not(self):
        out = self.run_shell(r'''resolve_a() { echo 203.0.113.9; }
public_ip() { echo 198.51.100.1; }
check_dns_target app.example.com
resolve_a() { echo 198.51.100.1; }
check_dns_target app.example.com
public_ip() { return 1; }
check_dns_target app.example.com
''')
        self.assertEqual(out.count('Let\'s Encrypt will fail'), 1)
        self.assertIn('203.0.113.9', out)

    def test_dns_check_survives_a_domain_without_an_a_record(self):
        out = self.run_shell(r'''set -Eeuo pipefail
getent() { return 2; }
public_ip() { echo 198.51.100.1; }
check_dns_target v6only.example.com
echo survived
''')
        self.assertIn('survived', out)

    def test_ufw_warns_only_when_active_and_web_ports_blocked(self):
        blocked = 'Status: active\n22/tcp ALLOW Anywhere\n'
        allowed = 'Status: active\n80/tcp ALLOW Anywhere\n443/tcp ALLOW Anywhere\n'
        body = "ufw() {{ printf '{}'; }}\ncheck_ufw\n"
        self.assertIn('ufw', self.run_shell(body.format(blocked)))
        self.assertNotIn('ufw', self.run_shell(body.format(allowed)))
        self.assertNotIn('ufw', self.run_shell("ufw() { echo 'Status: inactive'; }\ncheck_ufw\n"))

    def test_ufw_accepts_lists_ranges_profiles_and_allow_default(self):
        body = "ufw() {{ if [[ $1 == app ]]; then printf 'Profile: Nginx Full\\nPorts:\\n  80,443/tcp\\n'; else printf '{}'; fi; }}\ncheck_ufw\n"
        for status in (
            'Status: active\nDefault: deny (incoming)\n80,443/tcp ALLOW IN Anywhere\n',
            'Status: active\nDefault: deny (incoming)\n1:1000/tcp ALLOW IN Anywhere\n',
            'Status: active\nDefault: deny (incoming)\nNginx Full ALLOW IN Anywhere\nNginx Full (v6) ALLOW IN Anywhere (v6)\n',
            'Status: active\nDefault: allow (incoming), allow (outgoing)\n',
            'Status: active\nDefault: deny (incoming)\nAnywhere ALLOW IN 203.0.113.0/24\n',
        ):
            self.assertNotIn('ufw is active', self.run_shell(body.format(status)), status)
        self.assertNotIn('ufw is active', self.run_shell(body.format('Status: active\nDefault: deny (incoming)\n80/tcp (v6) on eth0 ALLOW IN Anywhere (v6)\nNginx Full on eth0 ALLOW IN Anywhere\n')))
        out = self.run_shell(body.format('Status: active\nDefault: deny (incoming)\n443/tcp ALLOW IN Anywhere\n80/tcp DENY IN Anywhere\n80/udp ALLOW IN Anywhere\n80/tcp ALLOW OUT Anywhere (out)\n1000:2000/tcp ALLOW IN Anywhere\n'))
        self.assertIn('port 80 is not allowed', out)
        self.assertNotIn('port 443', out)

    def test_ufw_survives_unknown_profiles_under_set_e(self):
        out = self.run_shell(r'''set -Eeuo pipefail
ufw() { if [[ $1 == app ]]; then echo 'ERROR: Could not find a profile matching' >&2; return 1; fi
  printf 'Status: active\nDefault: deny (incoming)\nOld App ALLOW IN Anywhere\nfe80::1 80/tcp ALLOW IN Anywhere\n'; }
check_ufw
echo survived
''')
        self.assertIn('survived', out)
        self.assertIn('port 443 is not allowed', out)

    def test_public_https_probe_warns_instead_of_failing(self):
        out = self.run_shell(r'''curl() { return 22; }
check_public_https app.example.com
''')
        self.assertIn('HTTPS', out)
        self.run_shell(r'''curl() { return 0; }
check_public_https app.example.com
''')


if __name__ == '__main__':
    unittest.main()
