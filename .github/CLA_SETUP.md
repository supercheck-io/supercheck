# Enable and verify contributor agreements

The agreement is [CLA.md](../CLA.md), version 1.0, naming Krishna Kant, doing
business as Supercheck, as the current maintainer, because the agreement needs a
legal person as its party. Contributors keep ownership; the grant supports both
open-source distribution and commercial licensing. Have counsel review the
agreement and holder identity before relying on it for alternative licensing.

## Repository administrator setup

1. Use the maintained [CLA Assistant service](https://cla-assistant.io/), not
   the archived `cla-assistant/github-action` action. Authorize access to
   `supercheck-io/supercheck` through the service's GitHub authorization flow.
2. Create a public GitHub Gist containing the exact approved CLA text. Link
   that Gist to the repository in CLA Assistant. Record its URL and revision
   in the repository's maintainer records; keep it identical to `CLA.md`.
3. Collect the signer's legal name and whether they sign personally or for an
   employer. Require employer authority where an employer owns the work.
4. Verify a test fork PR: unsigned contributions must fail; signing must pass;
   another unsigned co-author must keep it failing. Review every contributor,
   including authors whose identity GitHub cannot resolve.
5. After the service reports successfully, add its actual status context as a
   required check on `main`, preserving all existing protections. Do not add
   a guessed check name or a check that has not run. Limit bypass access.
6. Export and retain signature records with the agreement version and Gist
   revision. Changes to grants or parties require a new version and signatures.

Service authorization, a configured Gist, and required-check activation are
administrator actions; adding these files alone does not enable enforcement.

## Before each merge

- Verify coverage for every human contributor and co-author, not just the PR
  author or squash-commit author. Do not broadly exempt organization members.
- Exempt only identified automation accounts; a bot trailer does not establish
  rights to copied third-party code.
- Until the service is active, obtain explicit written acceptance identifying
  the signer, agreement version, contributions, and employer authority, and
  retain the record. A checkbox or `Signed-off-by` is not sufficient.
- Keep pre-existing and upstream contributions under their existing licenses
  unless separate permission is obtained. Do not rewrite author identities to
  manufacture ownership. The CLA is not retroactive.
