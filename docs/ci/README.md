# Optional GitHub checks

`demo-checks.yml.example` contains dependency installation, route/type checks, unit/database tests, the synthetic logical recovery rehearsal, mock-identity HTTP tests, a production build on Node.js 24, and `npm audit --omit=dev --audit-level=high`. The job may take up to 25 minutes, because GitHub's runner is slower than a desktop. The official actions are pinned to commit SHAs. Changes to `demo/**`, `docs/ci/**` or the active workflow trigger checks; manual dispatch is also available.

The runner is pinned to `ubuntu-24.04`, whose [published image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#postgresql) currently includes PostgreSQL 16. The recovery test requires version 17. The template follows the [official PostgreSQL Ubuntu repository setup](https://www.postgresql.org/download/linux/ubuntu/), using a scoped signing key and `noble-pgdg`, and installs only `postgresql-client-17`. `PG_CLIENT_BIN_DIR=/usr/lib/postgresql/17/bin` selects the matching tools explicitly. Temporary test servers still come from the locked `embedded-postgres` dependency; no database service, application secrets or external database URL are needed.

`npm run test:recovery` is a required step: missing tools, the wrong major version or a restore failure fail the job. Do not skip it or add `continue-on-error`. When changing the Ubuntu release, update its package-suite name as well and verify client-tool availability. No backup archive is uploaded as a CI artifact.

The agent's GitHub credential can push source but not workflow files: on 2026-11-02 GitHub again refused `.github/workflows/demo-checks.yml` because the token lacks the `workflow` scope. No account permissions were changed.

To activate it, a maintainer adds the file in GitHub's web editor, which needs no token:

1. Open `docs/ci/demo-checks.yml.example` on GitHub and copy it with **Copy raw file**.
2. Open `https://github.com/aionogi/aisistent/new/main?filename=.github/workflows/demo-checks.yml`, paste, and choose **Commit changes**, then **Commit directly to the `main` branch**.
3. The **Actions** tab shows the first run. Before the agent's next push, `git pull` brings the file into local checkouts.

Keep the template and the active file identical. After a change to the template, copy it to the active file the same way.

Checks on 2026-11-02: the pinned `actions/checkout` and `actions/setup-node` commits are the current `v6` tags (v7 is out; upgrade deliberately). The lockfile carries the Linux packages for `embedded-postgres`, Next.js SWC and sharp. Locally on Windows, every step's command passed: typecheck, 178/178, recovery 6/6 with PostgreSQL 17 clients, HTTP 26/26, build, audit with 0 vulnerabilities. The suites have never run on Linux, so the first GitHub run may surface platform differences.

Validation on 2026-10-22: the extracted installation block passed `bash -n`; static review checked the runner/package-suite pairing, scoped signing key, explicit client path, trigger paths and required recovery-step ordering. `git diff --check` passed. Ubuntu package installation and execution on GitHub remain unverified. No application code changed, so the application suites were not rerun for this template-only follow-up.
