# Purely Health Nutra — Delivery TODO

## Manus infrastructure and repository cleanup

- [ ] Host and deploy the application through Manus WebDev; do not use former external database provider, Firebase, Vercel, Netlify, AWS, Azure, Google Cloud, an external VPS or another external hosting/database provider.
- [ ] Use the Manus-native managed primary database and keep durable application data server-side.
- [ ] Delete the tracked former external database provider `.env` credentials and remove all former external database provider URLs, package imports, client code, edge functions, configuration and migration leftovers from the repository.
- [ ] Keep payment secrets out of source code, frontend bundles, logs, public endpoints and database records; use Manus protected secret configuration.

## Application migration

- [ ] Preserve the existing React storefront, responsive navigation, product catalog, cart, checkout, order tracking, customer account, admin, content, business directory, shipping, AI and SEO routes.
- [ ] Route browser data operations through same-origin Manus server endpoints backed by `DATABASE_URL`.
- [ ] Add repeatable, additive database schema/migrations for catalog, customers, orders, order items, payments, users/roles, content and webhook idempotency.
- [ ] Validate important inputs server-side, preserve relationships, prevent duplicate payment/webhook processing and calculate balances from authoritative records.

## Payments

- [ ] PayFast: server-side initiation, amount/currency/reference validation, secure return/cancel flow, ITN signature/status verification, duplicate protection and pending/completed/cancelled/failed states.
- [ ] Yoco: server-side checkout/session creation, amount/currency/reference validation, webhook/status verification, duplicate protection and pending/success/failure/cancelled states.
- [ ] PayPal: server-side order creation/capture, amount/currency/reference validation, capture verification, webhook/signature handling where configured, duplicate protection and pending/captured/failed/cancelled states.
- [ ] Payment settings: masked/configured status, separate non-sensitive mode settings, setup checklist and no claim of connection before validation.
- [ ] Never collect or store raw card numbers, CVVs or other sensitive card data.

## Shipping integrations

- [ ] Courier Guy: fetch live rates server-side from the ShipLogic API using Manus secrets, the configured collection address and checkout parcel dimensions; show the returned service, price and estimated delivery in checkout.
- [ ] PUDO: fetch live locker locations and live locker rates server-side from the official PUDO/The Courier Guy Locker API; let the customer select a locker and persist its code/name with the order shipping method.
- [ ] Shipping fulfillment: provide server-only Courier Guy and PUDO shipment-creation handlers using the selected service level, delivery contact/address, parcel dimensions and selected PUDO locker; never expose courier credentials to the browser.
- [ ] Shipping readiness: show configured/not-configured status for Courier Guy and PUDO in the admin payment/integration status surface without displaying secrets, and do not claim live readiness until credentials and collection addresses are supplied in Manus.

## Validation and delivery

- [ ] Add `public/manus-routes.json` for all page routes and keep it synchronized with the React router.
- [ ] Run dependency installation, type-check/build, lint and existing automated tests; fix actionable failures.
- [ ] Verify application health, route metadata, data API behavior and payment configuration status without using live payments.
- [ ] Commit and push the tested checkpoint to the Manus-managed repository, configure build/deploy, publish, and verify the deployed URL and tested version.
- [ ] Report credential readiness, test/live mode, checkout/webhook/database results and any remaining account permissions separately for PayFast, Yoco and PayPal.
