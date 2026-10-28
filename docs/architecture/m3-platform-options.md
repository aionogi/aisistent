# M3 platform options: hosting, identity, database

Status: **decided on 2026-10-28** by the user: Vercel for hosting (the free Hobby plan while the site is being built, a paid plan before commercial use), Supabase PostgreSQL in Frankfurt used only as a database, and Auth0 with an EU tenant for sign-in. Supporting tools the team already uses: Resend (email), Cloudflare (DNS), Sentry (error tracking and alerts), and PostHog (analytics, later). Upstash and Pinecone are not used. Private file storage is decided when uploads start (Supabase Storage or Cloudflare R2). Nothing is deployed and no account has been opened yet. The 2026-10-21 research below (combination A: Render + Auth0 + R2) is kept for reference.

## Decision (2026-10-28)

| Concern | Choice | Constraints and follow-ups |
| --- | --- | --- |
| Hosting | Vercel, functions in `fra1` (Frankfurt) | **Hobby is limited to non-commercial personal use** under Vercel's fair use guidelines, which count a site promoting a business as commercial; move to Pro before launch, before real customer data, and when more than one person needs access to the project. Hobby cron jobs run at most once a day (enough for the nightly cleanup). Migrations run outside the Vercel build, so the web environment never holds `DATABASE_ADMIN_URL` (resolves R5). The M4 voice gateway needs long-lived connections that Vercel functions do not keep; it will need a separate small host. [Hobby plan](https://vercel.com/docs/plans/hobby-plan), [Fair use](https://vercel.com/docs/limits/fair-use-guidelines), [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Database | Supabase PostgreSQL, Frankfurt | Use it as plain PostgreSQL only: no Supabase Auth, no client libraries, Data API disabled, the `service_role` key never in the application. Migrations connect directly (they need `CREATE ROLE` and a session for the advisory lock); the app connects through the transaction pooler with a small pool. `statement_timeout` must move from the connection options to a role setting, because the pooler does not pass startup parameters. Confirm how a custom login role (`aisistent_app`) authenticates through the shared pooler (third-party examples show `role.project-ref`) and whether the plan includes point-in-time recovery. [Roles](https://supabase.com/docs/guides/database/postgres/roles), [Connecting](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers.md) |
| Identity | Auth0, EU tenant | Unchanged from the existing integration (`demo/lib/auth/`). Clerk was considered and rejected: Clerk states that it offers no regional data residency (data hosted in the US), and its session token cookie is readable by JavaScript, which conflicts with the session design. [Clerk security](https://clerk.com/security) |
| Email | Resend | For invitation emails (resolves R14 once built). Sending from Ireland is a paid-plan region; account data stays in the US either way, so the SCC step applies. [Regions](https://resend.com/docs/dashboard/domains/regions) |
| DNS | Cloudflare | DNS only (no proxy in front of Vercel), so the client IP header comes from Vercel. |
| Errors and alerts | Sentry, EU region | Can serve as the alert sink (R8). Send no personal data or request bodies; extend the CSP `connect-src` for it. |
| Analytics | PostHog, EU cloud, later | Public pages only, after cookie consent; no session recording in organization workspaces. Needs CSP changes. |
| Not used | Upstash (Redis), Pinecone (vector database) | Rate limits already run in PostgreSQL; knowledge search in M4 can use `pgvector` in the same database under the same RLS. |
| Private files | Open | Supabase Storage or Cloudflare R2 (EU jurisdiction), decided when uploads are built. |

Open follow-ups: sign each provider's DPA; prepare Serbian Commissioner SCCs for providers that may process data outside the EU (Clerk is not used; Resend account data is in the US); open accounts in the company's name with MFA. This is not legal advice.

### What depends on the provider choice

Keep provider-specific code in these places so a switch stays small:

| Provider | Where it is used | Portable part |
| --- | --- | --- |
| Render (superseded by Vercel) | `render.yaml`, to be replaced by Vercel configuration; `DATABASE_ADMIN_URL`/`DATABASE_APP_PASSWORD` naming in `demo/lib/db/config.ts` | Any Node.js host running `npm run build`, `npm run db:migrate`, `npm run start` |
| Render Postgres / Supabase | Nothing provider-specific yet; Supabase needs the pooler and timeout settings above | Standard PostgreSQL 17 with roles, RLS, and SECURITY DEFINER functions |
| Auth0 | `demo/lib/auth/auth0.ts`, the `/auth/*` routes mounted in `demo/proxy.ts`, `AUTH0_*` variables | Any OpenID Connect provider; `lib/auth/account.ts`, the session table, and authorization stay the same |
| Cloudflare R2 | Not used yet | S3-compatible API |
Researched: 2026-10-21. Merchant: company based in Serbia.

## Earlier decision record (2026-10-21, superseded)

| Concern | Choice | Region / constraint |
| --- | --- | --- |
| Hosting | Render web service (Next.js Node server), background worker; voice gateway in M4 | Frankfurt; region is fixed at creation |
| Database | Render Postgres with `pgvector`, PITR | Frankfurt; Pro workspace for 7-day PITR; no public access except restricted |
| Identity | Auth0, server-side Next.js SDK with `HttpOnly` session; memberships and roles in our database | EU tenant locality; Free plan (passkeys) for development, B2C Essentials when owner MFA with one-time passwords is required |
| Private files | Cloudflare R2 bucket with EU jurisdiction, backed up separately | EU jurisdiction set at bucket creation |

Open follow-ups: confirm Render prices on its pricing page; sign each provider's DPA; prepare Serbian Commissioner SCCs where a provider may process data outside the EU; confirm VAT handling with the accountant; open accounts in the company's name with MFA and two owners where supported.

Prices and availability change; every row marked "verify" must be confirmed in the provider's console or contract before signing up. This is not legal or tax advice.

## What M3 needs from the platform

From [security-and-billing.md](security-and-billing.md) and [MILESTONES.md](../MILESTONES.md):

- A Node.js deployment for Next.js (replacing `output: "export"`), plus room for long-running Node processes: workers now, a WebSocket voice gateway in M4.
- Managed PostgreSQL with row-level security, `pgvector` for knowledge search, point-in-time recovery, and tested restores.
- Private object storage for recordings and documents, backed up separately from the database.
- A managed identity provider with MFA for owners and administrators, and a server-side flow where session tokens stay in `HttpOnly` cookies or a server store (no JavaScript-readable tokens).
- EU hosting close to Serbia, with DPAs, for a small team that should not run its own database servers.

## Serbian constraints

- **Personal data transfers.** Serbia's data protection law is modeled on the GDPR. Decision 55/19 lists countries considered adequate, including parties to Council of Europe Convention 108, which covers EU member states. Hosting in an EU region is therefore the simplest basis. The list's United States entry was tied to Privacy Shield, which the CJEU invalidated in 2020. Where a US provider may process data outside the EU (support, subprocessors), plan to use the Serbian Commissioner's standard contractual clauses. Confirm with counsel. Sources: [Schoenherr](https://www.schoenherr.eu/content/rethinking-eu-us-personal-data-transfers-and-their-effect-on-transfers-from-serbia), [CMS](https://cms.law/en/int/expert-guides/cms-expert-guide-to-data-protection-and-cyber-security-laws/serbia), [DLA Piper](https://www.dlapiperdataprotection.com/index.html?t=transfer&c=RS).
- **No hyperscaler region in Serbia.** Frankfurt is the closest common region for every candidate below.
- **Contracting and billing.** AWS lists Serbia among the countries that contract with Amazon Web Services EMEA SARL (Luxembourg) ([AWS EMEA countries](https://aws.amazon.com/legal/aws-emea-countries/)). Google Cloud lists no local currency for Serbia, so billing would likely be in USD ([Google currency page](https://docs.cloud.google.com/billing/docs/resources/currency)). Scaleway's restricted-country list does not include Serbia ([Scaleway](https://www.scaleway.com/en/docs/billing/troubleshooting/cannot-find-my-country/)). Render, Vercel, and Auth0 bill by card; confirm at sign-up that a Serbian billing address and company card are accepted. Have the company's accountant confirm VAT treatment of imported services.

## Hosting

| Option | Fit | Notes |
| --- | --- | --- |
| **Render** (Frankfurt) | Strong | Web services, background workers, private network, and Postgres in Frankfurt. Inbound WebSockets with no fixed connection timeout. SOC 2 Type 2, ISO 27001, GDPR DPA; EU-US DPF certified. A service's region cannot be changed later. [Regions](https://render.com/docs/regions), [WebSockets](https://render.com/docs/websocket), [Security](https://render.com/security) |
| **AWS** (eu-central-1) | Strong, more work | ECS on Fargate behind an Application Load Balancer, RDS PostgreSQL, S3, Cognito, all with one EU contracting entity. App Runner stopped accepting new customers on 30 April 2026; AWS points to ECS Express Mode, which is aimed at stateless HTTP services, so WebSocket and ALB idle-timeout behavior needs a test. Needs infrastructure-as-code and careful networking (NAT/endpoint costs). [App Runner change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html), [ECS Express Mode](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html) |
| **Vercel** (fra1) | Good for web only | Best Next.js developer experience. WebSockets in Functions are a public beta since June 2026; connections are bounded by function duration (Pro: 300 s default, 800 s maximum, 1800 s beta). The M4 voice gateway would still need another host. [WebSockets](https://vercel.com/docs/functions/websockets), [Limits](https://vercel.com/docs/functions/limitations) |
| **Google Cloud Run** (europe-west3) | Possible | WebSockets supported; requests limited to 60 minutes, so clients must reconnect. USD billing for Serbia. No advantage over Render or AWS for this project. [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets) |
| **Fly.io** (fra) | Possible | Frankfurt kept in the region consolidation. Smaller managed-database story. [Regions](https://fly.io/docs/reference/regions) |
| **Scaleway** (Paris/Amsterdam/Warsaw) | EU-owned alternative | French provider; Serverless SQL supports `pgvector`. Serverless Containers are stateless and WebSocket support was not confirmed. [Serverless SQL](https://scaleway.com/en/docs/serverless-sql-databases) |
| **Hetzner** (Germany) | Not now | Cheapest VMs, but the database, backups, and patching would be self-managed, which conflicts with the small-team, managed-service requirement. Accounts may require ID verification. [Hetzner fraud FAQ](https://docs.hetzner.com/general/security-and-identify/fraud-prevention-faq/) |

## Identity provider

| Option | Fit | Notes |
| --- | --- | --- |
| **Auth0** (EU region) | Strong | EU public-cloud locality available at tenant creation. Free: 25,000 MAU, passkeys, no "Pro MFA factors". B2C Essentials from $35/month for 500 MAU with Pro MFA factors (one-time passwords, push). B2B Essentials from $150/month. The Next.js SDK v4 keeps the session in an encrypted `HttpOnly` cookie and supports a server-side session store, which enables revocation. Organizations and roles can live in our own database, as the security document requires. [Pricing](https://auth0.com/pricing), [Tenant regions](https://auth0.com/docs/get-started/auth0-overview/create-tenants), [MFA factors](https://auth0.com/docs/secure/multi-factor-authentication/enable-mfa) |
| **Amazon Cognito** (eu-central-1) | Strong on AWS | Essentials: 10,000 MAU free, then $0.015/MAU; authenticator-app MFA and passkeys included; SMS billed via SNS. Server-side OIDC code flow fits the session design. Developer experience is weaker than Auth0. [Pricing](https://aws.amazon.com/cognito/pricing/) |
| **ZITADEL Cloud** (EU region) | EU-owned alternative | Swiss company; EU, Swiss, US, or Australian data location chosen per instance; standard OIDC. Current price list not confirmed. [Data location](https://help.zitadel.com/where-is-zitadel-cloud-data-stored) |
| **Microsoft Entra External ID** | Possible | First 50,000 MAU free. Data location for a Serbia-based tenant could not be confirmed. [Pricing](https://www.microsoft.com/en-us/security/pricing/microsoft-entra-external-id) |
| **Clerk** | Poor fit | Its `__session` token cookie is intentionally readable by JavaScript (short-lived, 60 s), which conflicts with the documented session design. [Clerk XSS protection](https://clerk.com/docs/guides/secure/best-practices/xss-leak-protection) |
| **WorkOS AuthKit** | Poor fit now | Free to 1M MAU with MFA, but no EU data residency was found. [Comparison](https://guptadeepak.com/ciam-compass/vendors/workos/) |

## Database and private storage

| Option | Fit | Notes |
| --- | --- | --- |
| **Render Postgres** (Frankfurt) | Strong with Render | `pgvector` supported; point-in-time recovery on paid instances, kept 3 days on Hobby and 7 days on Pro workspaces; logical backups kept 7 days. Same private network as the app. [Extensions](https://render.com/docs/postgresql-extensions), [Backups](https://render.com/docs/postgresql-backups) |
| **Amazon RDS for PostgreSQL** (eu-central-1) | Strong with AWS | Mature backups, PITR, encryption with KMS, Multi-AZ. Highest operational flexibility and cost floor. |
| **Neon** (aws-eu-central-1) | Possible | Serverless Postgres, Frankfurt region. Acquired by Databricks in 2025; one regional analysis flags unclear EU residency terms since. [Neon review](https://www.cloudmagazin.com/en/2026/04/25/neon-serverless-postgres-dach-2026-architecture-patterns-pitfalls-databricks-acquisition/) |
| **Supabase** (Frankfurt) | Database yes, Auth no | Good Postgres. Its SSR auth helpers keep session tokens in cookies the browser client reads (verify against current docs), and its service-role key bypasses RLS, so use it only as a database if chosen. |
| **Cloudflare R2** (EU jurisdiction) | Storage, recommended with Render | Jurisdiction restriction keeps objects in the EU; set at bucket creation. Low storage price and no egress fees. [Data location](https://developers.cloudflare.com/r2/reference/data-location/) |
| **Amazon S3** (eu-central-1) | Storage, recommended with AWS | Native fit if the rest is on AWS. |

## Recommended combinations

### A. Render + Auth0 + Cloudflare R2 — recommended

- Next.js as a Render web service (standalone Node server), a background worker, and later the voice gateway, all in Frankfurt on Render's private network.
- Render Postgres in Frankfurt with `pgvector`, PITR, and restricted external access.
- Auth0 tenant in the EU region: passkeys on Free during development; B2C Essentials (from $35/month) once owner MFA with one-time passwords is required. Memberships, roles, and tenant checks stay in our database.
- Private files in an R2 bucket with EU jurisdiction, backed up separately.

Why: one platform runs both the Next.js app and the long-lived Node processes M4 needs, with no request timeout for WebSockets; managed Postgres with PITR; security attestations and a DPA; the least operations work for a small team. Containers and standard Postgres keep a later move to AWS possible.

Trade-offs: three US-headquartered vendors (Render, Okta/Auth0, Cloudflare) with EU data locations, so the Serbian SCC step applies to each; Render prices must be confirmed on its pricing page; Frankfurt must be chosen at creation because regions cannot be changed.

### B. AWS only (Frankfurt)

ECS on Fargate with an Application Load Balancer, RDS PostgreSQL, S3, Cognito Essentials, SQS, KMS, CloudWatch. One contract with an EU entity (AWS EMEA SARL), one region, and the most control. Choose this if a single vendor and the strongest native controls matter more than speed. Expect more infrastructure-as-code, a higher fixed monthly cost, and more ways to misconfigure networking and IAM.

### C. EU-headquartered

Scaleway (hosting, Postgres, object storage) with ZITADEL Cloud in the EU region. Choose this if avoiding US-headquartered processors is a requirement. Before committing, verify WebSocket support for the voice gateway, current ZITADEL pricing, and account creation for a Serbian company.

Vercel + Neon + Clerk is not recommended: Clerk conflicts with the session design, and the voice gateway would still need a second host.

## Decisions needed from the user

1. Combination A, B, or C (or a variation).
2. Whether avoiding US-headquartered providers is a hard requirement (it would select C).
3. A monthly budget ceiling for staging plus production in M3.
4. Accounts opened in the company's name with a company email and card, with MFA on every provider account and at least two owners where the provider supports it.

After the choice, record it in `docs/HANDOFF.md`, then begin M3 with: Node deployment configuration, a staging environment, database schema and RLS for organizations and memberships, and the identity integration.
