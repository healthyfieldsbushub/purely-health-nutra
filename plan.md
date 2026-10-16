# Purely Health Nutra — Manus Migration Plan

## Scope

Migrate the existing React/TypeScript e-commerce app from former external database provider to Manus WebDev while preserving the storefront, catalog, cart, checkout, customer/order flows, admin areas, content hub, shipping, AI, CRM and SEO features. Manus remains the exclusive hosting platform and the managed MySQL-compatible Manus database is the primary data store. Payment credentials remain server-only and are supplied through Manus protected secrets.

## Implementation approach

1. Remove the tracked `.env`, all former external database provider client/edge-function/config/migration files, former external database provider package usage, hard-coded former external database provider URLs and former external database provider-specific environment names.
2. Add a small Manus server layer with a neutral JSON data API backed by `DATABASE_URL`, an application health endpoint, a secure server function gateway, and a production entrypoint. Keep browser code on same-origin `/api/*` calls so no database credential reaches the client.
3. Add a migration ledger and additive MySQL schema for core catalog, customers, orders, order items, payments, users/roles, content, settings and webhook idempotency. Runtime migrations are repeatable and never overwrite application data.
4. Replace the generated former external database provider client with a Manus client adapter that preserves existing query intent while routing data, auth, storage and server-function calls through the Manus app server.
5. Keep PayFast, Yoco and PayPal flows server-side. Payment settings expose configured/not-configured status only; authoritative status changes come from verified provider responses/webhooks. No raw card data is stored.
6. Add Manus route metadata, a production Dockerfile, health check and config declarations for build/deploy. Run install, type-check/build, lint, tests and direct health/API checks before checkpointing and publication.

## Project structure

- `src/`: existing React storefront, admin UI, routes and client adapters.
- `server/`: Manus HTTP server, database access, migrations, authentication/session helpers, payment gateways and function handlers.
- `public/manus-routes.json`: complete crawler-visible route declaration.
- `Dockerfile`: reproducible production image and listener.
- `scripts/`: deterministic database migration/check utilities.
- `plan.md` / `TODO.md`: current implementation decisions and acceptance status.

## Design

### Candidate movements

- **Quiet Botanical Commerce** (0.06): warm editorial health-store layout with botanical accents and calm information hierarchy.
- **Clinical Pantry** (0.18): precise nutrition utility with data-forward cards and clean laboratory cues.
- **Sahara Modern** (0.76): retain the existing African-inspired terracotta/gold identity while improving clarity, spacing and mobile flow.

### Chosen movement: Sahara Modern

- **Design Movement:** contemporary African editorial commerce, balancing craft warmth with trustworthy nutrition guidance.
- **Core Principles:** clarity before decoration; warm material cues; information-rich but breathable; mobile-first checkout.
- **Color Philosophy:** terracotta and sahara gold signal grounded, natural products; deep charcoal provides trust and readable contrast; cream surfaces keep content calm.
- **Layout Paradigm:** offset editorial sections and purposeful content rails rather than a uniform dashboard grid; admin views use compact operational panels.
- **Signature Elements:** terracotta action bars, gold rules around totals and trust details, and soft botanical/organic surface shapes.
- **Interaction Philosophy:** every state is explicit—loading, empty, error, pending and verified; payment status is never implied by a redirect.
- **Animation:** restrained reveal and hover motion only; no movement that competes with checkout, form completion or accessibility settings.
- **Typography System:** use the existing project typography and hierarchy; large expressive product/editorial headings paired with compact readable UI labels.
- **Brand Essence:** practical African-rooted nutrition and wellness commerce for customers who want trusted products, clear guidance and dependable fulfillment. Personality: grounded, generous, credible.
- **Brand Voice:** direct, warm and useful. Example lines: “Choose your next everyday ritual.” / “Your order is recorded; payment confirmation is still pending.”
- **Wordmark & Logo:** preserve the supplied brand mark and favicon assets; use the existing wordmark rather than generating a replacement.
- **Signature Brand Color:** terracotta, used consistently for primary actions and key trust moments.
