"""Installer regressions using isolated files and stubbed host commands."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parent


class InstallerTests(unittest.TestCase):
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
                                env={**os.environ, 'TEST_ROOT': str(self.root),
                                     'INSTALL_TEST_EUID': '0', 'NO_COLOR': '1'},
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

    def test_failed_migration_volume_does_not_unlock_install(self):
        output = self.run_shell(r'''uname() { [[ "$1" == -s ]] && echo Linux || echo x86_64; }
os_field() { [[ "$1" == ID ]] && echo ubuntu || echo 24.04; }
awk() { [[ "$*" == *MemTotal* ]] && echo 8000000 || echo 20; }
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
VERSION=1.3.7-canary.16
persist_version
''')
        self.assertEqual((self.root / 'compose/.env').read_text(),
                         'BETTER_AUTH_SECRET=fixture\nSUPERCHECK_VERSION=1.3.7-canary.16\n')

    def test_checkout_version_flag_is_ignored(self):
        self.run_shell(r'''echo SUPERCHECK_VERSION=1.3.6 > "$COMPOSE_DIR/.env"
USING_THIS_CHECKOUT=true
VERSION_SET=true
VERSION=1.3.7-canary.16
persist_version
''')
        self.assertEqual((self.root / 'compose/.env').read_text(), 'SUPERCHECK_VERSION=1.3.6\n')

    def test_invalid_release_fails_before_installing_packages(self):
        output = self.run_shell(r'''USING_THIS_CHECKOUT=false
VERSION=9.9.9
curl() { return 22; }
check_release
install_prerequisites() { touch "$TEST_ROOT/packages-installed"; }
install_prerequisites
''', 1)
        self.assertIn('Release v9.9.9', output)
        self.assertFalse((self.root / 'packages-installed').exists())

    def test_no_flag_rerun_does_not_pin_a_new_default(self):
        self.run_shell(r'''echo BETTER_AUTH_SECRET=fixture > "$COMPOSE_DIR/.env"
USING_THIS_CHECKOUT=false
SOURCE_FETCHED=false
VERSION_SET=false
VERSION=1.3.7-canary.16
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
VERSION=1.3.7-canary.16
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
  if [[ "$*" == *SUPERCHECK_VERSION* || "$*" == *COMPOSE_PROFILES* ]]; then
    [[ $(find .env.new -perm -004 -print) == '' ]] || exit 90
  fi
  command grep "$@"
}
sed() {
  [[ $(find .env.filtered -perm -004 -print) == '' ]] || exit 90
  command sed "$@"
}
DOMAIN=new.example.com
EMAIL=admin@example.com
apply_public_config
touch .env.new
chmod 644 .env.new
USING_THIS_CHECKOUT=false
VERSION_SET=true
VERSION=1.3.7-canary.16
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


if __name__ == '__main__':
    unittest.main()
