# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The user requires Next.js and Node.js. Python is permitted only for a demonstrably necessary isolated pipeline. Code, identifiers, comments, and implementation documentation are English. The current application uses TypeScript.

## Product Purpose

The supplied concept is an AI assistant for business calls and messages. The proposed initial audience is small and medium businesses in Serbia; audience details and phased capabilities remain planning assumptions in `ai-asistent-plan.md`.

## Operating Context

The user confirmed that the merchant company is based in Serbia. The product will charge monthly subscriptions through cards or supported online payment services. A payment provider has not yet been approved or integrated.

## Brand Commitments

- The product name is **aisistent**, written in lowercase.
- The user selected https://www.call0.ai/ as website inspiration.
- Serbian UI copy is retained from the source plan as an assumption, separately from the confirmed English code requirement.

## Capabilities and Constraints

Strong security is a confirmed requirement. Tenant isolation, protected billing, and verified payment events must be designed before accepting paying customers. Implementation requirements are in `docs/architecture/security-and-billing.md`.

## Evidence on Hand

An interactive frontend prototype is implemented in `demo/`: a landing page with scripted conversations (M1) and a demo workspace with guided assistant onboarding (M2). Its conversations and business records are illustrative, and the M2 configuration is stored only in the visitor's browser tab. There are no verified customer testimonials, security certifications, commercial benchmarks, final prices, or live AI/telephony integrations available for publication.

## Current Delivery Scope

The user explicitly requested a website demo first, deferring monthly recurring billing and pricing. The public demo uses local browser state and scripted or rule-assembled conversations, without card collection or paid services. M1 (website demo) and M2 (app shell and onboarding UI) are complete. M3 is in progress: separate organization routes have server-side identity/storage, team management, locally tested operational safeguards and a synthetic logical backup/restore rehearsal. Hosting and identity choices remain provisional; there is no production deployment or production recovery evidence. The original production security requirements still apply before a future paid launch.

## Open Decisions

Payment provider approval and commercial terms, final pricing and currencies, trial/grace rules, retention periods, recovery targets, production hosting, and final brand assets remain open. No visual build workflow preference has been recorded.
