# Optional GitHub checks

`demo-checks.yml.example` contains dependency installation, route/type checks, unit/database tests, the synthetic logical recovery rehearsal, mock-identity HTTP tests and a production build on Node.js 24. The official actions are pinned to commit SHAs. Changes to `demo/**`, `docs/ci/**` or the active workflow trigger checks; manual dispatch is also available.

The runner is pinned to `ubuntu-24.04`, whose [published image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#postgresql) currently includes PostgreSQL 16. The recovery test requires version 17. The template follows the [official PostgreSQL Ubuntu repository setup](https://www.postgresql.org/download/linux/ubuntu/), using a scoped signing key and `noble-pgdg`, and installs only `postgresql-client-17`. `PG_CLIENT_BIN_DIR=/usr/lib/postgresql/17/bin` selects the matching tools explicitly. Temporary test servers still come from the locked `embedded-postgres` dependency; no database service, application secrets or external database URL are needed.

`npm run test:recovery` is a required step: missing tools, the wrong major version or a restore failure fail the job. Do not skip it or add `continue-on-error`. When changing the Ubuntu release, update its package-suite name as well and verify client-tool availability. No backup archive is uploaded as a CI artifact.

This template is not active. The existing GitHub credential can push repository source but cannot create workflow files; GitHub rejected that capability because the credential lacks `workflow` scope. No account permissions were changed. Previous local application checks are recorded in the handoff.

A maintainer with authorized workflow-write access can place this file at `.github/workflows/demo-checks.yml` to enable it. Keep the template and active configuration aligned if enabled later. The template itself has not run in GitHub Actions.

Validation on 2026-10-22: the extracted installation block passed `bash -n`; static review checked the runner/package-suite pairing, scoped signing key, explicit client path, trigger paths and required recovery-step ordering. `git diff --check` passed. Ubuntu package installation and execution on GitHub remain unverified. No application code changed, so the application suites were not rerun for this template-only follow-up.
