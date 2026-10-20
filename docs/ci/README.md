# Optional GitHub checks

`demo-checks.yml.example` contains commands for dependency installation, route/type checking, and a production build on Node.js 24. The official actions are pinned to commit SHAs.

This template is not active. The existing GitHub credential can push repository source but cannot create workflow files; GitHub rejected that capability because the credential lacks `workflow` scope. No account permissions were changed. Local build and type checks passed.

A maintainer with authorized workflow-write access can place this file at `.github/workflows/demo-checks.yml` to enable it. Keep the template and active configuration aligned if enabled later. The template itself has not run in GitHub Actions.
