# Security Policy

Security fixes target the latest release and `main`. Older releases receive
backports only when explicitly announced.

## Report a vulnerability

Do not open a public issue, discussion, or pull request. Use
[GitHub private vulnerability reporting](https://github.com/supercheck-io/supercheck/security/advisories/new)
or email `hello@supercheck.io` with the subject `Security report`.

Include the affected version, impact, and reproducible steps. Remove credentials,
personal data, tenant identifiers, and destructive proof-of-concept actions.

## Safe research

Good-faith research must use accounts and data you own or have permission to
test, avoid disruption and privacy violations, stop after proving the issue, and
report it promptly. This policy does not authorize testing third-party providers
or infrastructure outside Supercheck's control.

We will acknowledge reports, investigate them, keep reporters informed when the
timeline changes, and coordinate disclosure after users have a reasonable time
to update.

Operators should use HTTPS, strong unique secrets, private database and Redis
networking, least-privilege service accounts, immutable images, and tested
backups.
