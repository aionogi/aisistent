# aisistent security and subscription architecture

Status: proposed implementation requirements, not implemented or audited.
Updated: 2026-10-19. Merchant jurisdiction: Serbia, confirmed by the user.

## Scope and release policy

Apply these controls to the Next.js application, Node.js voice gateway and workers, PostgreSQL, private object storage, queues, and external integrations. Introduce controls with the feature they protect. Complete the paid-launch gates before accepting real subscription payments. Use applicable OWASP ASVS Level 2 requirements as a verification baseline, with documented applicability and evidence. This is not a certification claim. [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

## Identity and tenant boundaries

- Use a managed identity provider. Require verified identity and MFA for platform administrators, organization owners, and billing administrators. Support secure factor recovery and reauthentication for role, billing, integration, and MFA changes.
- Proposed session design: server-managed sessions with an opaque `Secure`, `HttpOnly`, appropriately scoped `SameSite` cookie; retain managed-auth tokens only in the protected server session store. Do not combine this design with a browser SDK that requires JavaScript-readable tokens. Specify expiry, CSRF protection, revocation, and logout before implementation.
- Authorize every Route Handler, Server Action, gateway operation, and job through the shared domain layer. Resolve current membership and role from trusted state. A hidden control, middleware redirect, or caller-provided organization ID is not authorization. [Next.js authorization](https://nextjs.org/docs/app/guides/authentication)
- Apply tenant-aware SQL/RLS, ownership constraints, vector filters, object policies, cache keys, job access, exports, and usage counters. Test the real database connection path. [OWASP multi-tenant security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- Normal user operations use user-scoped/non-bypassing database roles. Supabase secret/service-role clients bypass RLS; reserve them for narrow server-only operations with independently verified tenant context. A worker must validate the referenced resource and tenant before acting. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Removed members and downgraded roles lose sensitive access through live authorization checks; do not assume an already issued JWT disappears immediately. Test recovery, revocation, and MFA bypass paths. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)

## Protected data and AI operations

- Keep recordings and documents private. Issue short-lived download URLs only after current authorization. Use encryption in transit and at rest, retention/deletion policies, and audited administrative access. Do not put credentials, payment secrets, full transcripts, or signed download links in routine logs. [OWASP logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- Treat calls, imported knowledge, and model output as untrusted. Models request actions; trusted Node.js code validates the tool, arguments, tenant, permissions, destination, and remaining allowance. Models cannot change billing state or access unrestricted database/network tools. [OWASP prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- Verify telephony signatures and bind audio connections to authenticated call sessions. Allow transfers and outbound calls only to approved destinations. Add geographic restrictions, duration/concurrency limits, atomic usage reservations, bounded retries, organization/global spend caps, alerts, and an emergency stop. [Twilio dialing permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources)
- Do not request spoken card numbers or CVV. Route payment collection to the payment provider. Define handling and redaction for accidentally disclosed sensitive content.
- Run URL imports with restricted egress: HTTP(S) only, public destinations only, DNS/IP and redirect revalidation, and time/byte/page/depth limits. Deny loopback, private, link-local, metadata, and equivalent IPv6 destinations. [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- Quarantine uploads, validate actual content and allowed types, scan before parsing, limit file/page/archive expansion, randomize storage keys, and isolate parsers from credentials and internal networks. [OWASP uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## Provider decision for Serbia

Paddle is the first candidate to validate: its published supplier exclusions do not include Serbia. Approval of the company, domain, product, identity, and payout setup is still required. This is a candidate decision, not guaranteed eligibility. [Country policy](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle), [Verification checklist](https://developer.paddle.com/build/set-up-checklist/)

Banca Intesa Serbia lists recurring payments for subscriptions. Monri WSPay supports tokenized recurring payments subject to an additional MIT agreement with the acquirer. Evaluate these as domestic alternatives with actual contracts, supported currencies, recurring-payment terms, and pricing. [Banca Intesa](https://www.bancaintesa.rs/privreda/prihvatanje-platnih-kartica/e-commerce.html), [WSPay tokenization](https://www.wspay.rs/product/268/monri-wspay-tokenizacija)

Do not choose direct Stripe for the confirmed Serbian entity under its current published business-country availability. Do not assume a foreign entity. [Stripe availability](https://stripe.com/global)

Implement one approved provider first behind a narrow TypeScript adapter. Show only payment methods supported for subscriptions under the merchant's actual account, customer country, currency, and device. [Paddle payment methods](https://developer.paddle.com/concepts/payment-methods/)

## Checkout and payment boundaries

1. The authorized organization owner/billing administrator selects a plan.
2. Next.js resolves an allowlisted provider price, currency, interval, and quantity on the server. Customer IDs and organization mapping come from trusted records.
3. Persist a checkout attempt and enforce concurrency/retry controls. Prevent duplicate subscriptions from repeated clicks or parallel requests. Use provider-supported idempotency where available, backed by local state.
4. Open provider-controlled checkout/payment fields. Raw PAN/CVV must not pass through aisistent-owned form handlers, APIs, database, analytics, logs, or AI context.
5. The return page displays pending status until the server confirms authoritative payment/subscription evidence. Browser callbacks and success query parameters do not grant access.

Paddle Checkout overlay/inline is the default candidate integration. Its specifically named Hosted Checkout requires additional live-account approval. [Paddle Checkout](https://developer.paddle.com/concepts/sell/self-serve-checkout/), [Hosted Checkout restriction](https://developer.paddle.com/paddle-js/about/hosted-checkout/)

Store only necessary provider customer, subscription, transaction and payment-reference IDs plus minimal display metadata. Reducing card-data exposure does not establish PCI compliance automatically; confirm the integration's applicable requirements with the provider/acquirer. [Payment integration security](https://docs.stripe.com/security/guide)

## Reliable billing events

- Verify provider signatures and replay tolerance against the untouched raw body using the official Node integration. Reject invalid events before processing. Use separate live/test credentials, records, destinations, and secrets. [Paddle signature verification](https://developer.paddle.com/webhooks/about/signature-verification/)
- Durably record a verified event before acknowledging delivery. Use a unique `(provider, environment, event_id)` constraint, a processing state, and retries. Use the database event inbox as the durable source; queue scheduling must be recoverable if publishing fails after the database commit.
- Process each subscription serially, with idempotent side effects and transaction boundaries. Never assume event arrival order. Respect provider ordering guidance and fetch authoritative current state when necessary; timestamps alone are not a universal ordering guarantee. [Paddle delivery](https://developer.paddle.com/webhooks/about/respond-to-webhooks/), [Stripe webhook ordering](https://docs.stripe.com/webhooks)
- Periodically reconcile local subscriptions, payments and entitlements against provider state. Alert on drift, unprocessed events and retries that exceed their limit. Retain auditable transitions without excessive personal data.
- Bind provider customer/subscription records to an organization through server-created mappings. Do not trust browser metadata as ownership proof.

## Entitlements and subscription lifecycle

Keep raw provider status separate from normalized access state. Proposed states:

| Access state | Behavior |
| --- | --- |
| `pending` | Payment/activation is unconfirmed; no paid usage. |
| `trial` | Explicit trial allowance with strict abuse and cost limits. |
| `paid` | Verified entitlement through the stored paid period, subject to quota. |
| `grace` | Time-bounded recovery after a renewal failure, with a defined limited allowance. |
| `suspended` | Expired grace, pause, or an applicable risk decision prevents new paid usage. |
| `ended` | Effective cancellation/expiry; retain only allowed account, export, and billing access. |

Define the trial/grace duration, allowance, proration, overage policy and refund/dispute effects before launch. Scheduled cancellation preserves valid paid access until its effective date. Late events must not restore expired access. Refund and cancellation are separate operations. API calls and voice sessions check entitlements on the server; usage reservations must remain correct under concurrency. [Paddle provisioning](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/), [Cancellation](https://developer.paddle.com/build/subscriptions/cancel-subscriptions/), [Adjustments](https://developer.paddle.com/api-reference/adjustments/)

Use the provider's supported customer portal or equivalent secure flow for invoices, payment-method updates and cancellation. Generate temporary portal sessions only for the current organization's verified billing customer. Confirm price and effective date before plan changes. [Paddle customer portal](https://developer.paddle.com/concepts/sell/customer-portal/)

### Data additions

- `billing_customers`: unique provider/environment/customer binding to an organization.
- `subscriptions`: provider ID, raw status, normalized access, approved price, billing period, effective cancellation, reconciliation time and state version.
- `checkout_attempts`: organization, approved plan, provider session/reference, state, expiry and retry identity.
- `billing_events`: unique provider event, verified receipt, occurred/received times, processing status and attempts; minimize and protect payload retention.
- `usage_events`: immutable usage identity and raw units; derive totals with documented rounding and period boundaries.
- `audit_events`: actor, organization, action, target, result and timestamp for sensitive changes; no secrets.

## Operations

Require HTTPS, appropriate CSP/security headers, CSRF controls for cookie-authenticated mutations, validation, output encoding, and bounded public endpoints. Keep secrets out of browser bundles and repositories. Protect production deployment, use least-privilege identities, separate staging, maintain lockfiles and dependency/secret scanning, and document patch/rotation procedures. [OWASP Node.js security](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)

Back up database and object bytes separately, with encrypted access and tested recovery. Supabase database backups do not include Storage object contents. Define recovery time/data-loss targets and prove a restoration of both database and recordings/documents. [Supabase backups](https://supabase.com/docs/guides/platform/backups)

## Paid-launch acceptance gates

All gates are pending until implementation supplies evidence.

| Gate | Required evidence |
| --- | --- |
| Merchant readiness | Approved company/product/payout setup; confirmed recurring methods, currency and commercial terms. |
| Clear customer agreement | Visible monthly amount/period, included usage, overages, renewal, cancellation and refund rules; applicable provider/acquirer requirements reviewed. |
| Account security | Tests for anonymous access, expired/revoked sessions, removed membership, wrong roles, MFA bypass/recovery and sensitive-action reauthentication. |
| Tenant isolation | Two organizations cannot cross-read/write/delete/search/download/export or access each other's jobs, billing customer or portal. Test privileged paths separately. |
| Payment lifecycle | Sandbox purchase, authentication challenge, abandoned checkout, renewal success/failure/recovery, plan change, period-end cancellation, refund and dispute behavior. |
| Billing resilience | Forged, replayed, duplicate, delayed and out-of-order events; provider timeout; database/queue failure; retries and reconciliation produce one correct result. |
| Data handling | No raw payment-card data in application payment handling or telemetry; private and expired download links tested; retention and redaction verified. |
| AI/telephony abuse | Prompt injection cannot change billing, leak tenants or trigger unauthorized tools/calls; concurrent sessions respect atomic cost caps and emergency stop. |
| Import boundaries | Internal/metadata/redirect/DNS-rebinding URLs and malicious/oversized files are blocked before unsafe processing. |
| Recovery and operations | Isolated restore of database plus files; alerts reach an owner; credential rotation, rollback and incident runbook exercised. |
| Independent assessment | Review the deployed system, fix exploitable critical/high findings, retest fixes, and record remaining risk with an accountable owner. |

Reassess after changes to authentication, tenant access, billing, external tools or hosting. Passing tests reduces demonstrated risk; it does not establish an absolute security guarantee.
