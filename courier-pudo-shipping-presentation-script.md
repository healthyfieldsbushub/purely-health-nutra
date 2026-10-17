# Courier Guy and PUDO Shipping Integration
## Presentation script

### Slide 1 — Purpose

**On-screen:** Reliable South African shipping quotes for Purely Health Nutra.

**Speaker notes:**

This integration connects the Purely Health Nutra checkout and admin shipping calculator to Courier Guy and PUDO through the Manus-hosted server. The design uses product weight and parcel dimensions to request rates, keeps provider credentials out of the browser, and protects checkout from carrier outages with a clearly labelled flat-rate fallback.

---

### Slide 2 — Manus-only architecture

**On-screen:** Browser → Manus server → Courier Guy/PUDO APIs; Manus database and Secrets remain internal.

**Speaker notes:**

The browser sends destination and parcel data to same-origin Manus API routes. The Manus server reads the protected Production credentials and calls the carriers. The browser never receives API keys, the managed database remains on Manus, and no provider credential is committed to the repository or exposed in a client bundle.

---

### Slide 3 — Shared rate request

**On-screen:**

- Collection address: 22 Wren Street, Rant en Dal, Krugersdorp, Gauteng
- Destination: postal code and residential address
- Parcel weight: kilograms
- Dimensions: length × width × height in centimetres
- Parcel description and packaging metadata

**Speaker notes:**

Both integrations use the same normalized shipping inputs. The checkout calculates the cart's total weight and maximum parcel dimensions from the product records. The admin calculator accepts the same fields directly, making it useful for rate diagnostics before an order is placed.

---

### Slide 4 — Courier Guy flow

**On-screen:** `POST /rates` through the Manus server.

**Speaker notes:**

Courier Guy requests are sent server-side to the configured ShipLogic endpoint. Responses are normalized into a stable application format containing provider, service, price, estimated delivery time and description. The checkout does not depend on a carrier-specific response shape.

---

### Slide 5 — PUDO flow

**On-screen:** Locker-aware delivery.

**Speaker notes:**

PUDO supports locker selection and uses the configured PUDO terminal and collection address. The server can look up destination lockers, use a selected locker ID when available, and request a locker rate without exposing the PUDO credential to the customer browser.

---

### Slide 6 — Fallback mechanism

**On-screen:**

`FALLBACK_SHIPPING_FLAT_RATE_ZAR=99`

**Speaker notes:**

If both live carrier requests fail, checkout remains usable. The server returns one clearly labelled Standard delivery option at the configured fallback amount, currently R99, with an estimated two-to-five business-day window. The option is explicitly described as a fallback and never presented as a live Courier Guy or PUDO quote.

The response also preserves sanitized provider diagnostics for the admin and integration troubleshooting path.

---

### Slide 7 — End-to-end checkout test

**On-screen:**

- Product: Natural Brown Sugar 2kg
- Quantity: 1
- Product price: R89
- Test destination: Krugersdorp, Gauteng, 1751
- Shipping: Standard delivery fallback, R99
- Checkout total after shipping: R188

**Speaker notes:**

A real catalog product was added to a browser-only cart. Synthetic customer details were entered, including the test destination postal code 1751. The checkout advanced to Delivery, displayed the fallback option, selected it successfully, and updated the total to R188. The test stopped before order creation, payment initiation, shipment booking or waybill generation.

---

### Slide 8 — Production validation

**On-screen:**

- `/health`: HTTP 200
- `/api/health`: HTTP 200 and database ready
- Test parcel: 2 kg, 40 × 30 × 8 cm
- Response: HTTP 200
- Result: one fallback rate at R99

**Speaker notes:**

The required read-only production test passed the Manus health check, database readiness check and response-shape check. The result was a safe fallback rather than a live carrier quote, which accurately reflects the current carrier authentication state.

---

### Slide 9 — Credential replacement test

**On-screen:** Protected Manus Production Secrets.

**Speaker notes:**

The Courier Guy and PUDO credentials were replaced through the protected Manus input workflow. The runtime was synchronized without printing or retrieving secret values. After replacement, both provider requests still returned sanitized HTTP 401 Authentication failed responses. This means the application wiring and fallback are functioning, but the supplied credentials are not accepted by the configured carrier endpoints or account contract.

---

### Slide 10 — Current diagnostic result

**On-screen:**

- Courier Guy: HTTP 401 — Authentication failed, check API key
- PUDO: HTTP 401 — Authentication failed, check API key
- Checkout: healthy through fallback
- No provider tokens written to logs

**Speaker notes:**

The application does not log raw provider tokens or sensitive upstream payloads. Instead, it returns sanitized diagnostic fields with the provider name, safe error message and upstream status. The current production log stream contains startup entries but no credential-bearing provider log lines, which is the intended security behavior.

---

### Slide 11 — What is and is not proven

**On-screen:**

**Proven:**

- Manus server and database are healthy.
- Weight and dimensions reach the shipping endpoint.
- Checkout displays and selects a shipping option.
- Fallback protects checkout from carrier failure.
- Credentials remain server-side.

**Not yet proven:**

- Live Courier Guy rate retrieval.
- Live PUDO rate retrieval or locker lookup.
- Shipment booking.
- Waybill generation.
- Tracking or cancellation.

**Speaker notes:**

A successful fallback proves checkout resilience, not live carrier connectivity. Shipment booking and waybill generation are consequential actions and require a separate approved synthetic shipment test after valid carrier authentication is confirmed.

---

### Slide 12 — Required next step

**On-screen:** Confirm the correct production API contract.

**Speaker notes:**

The next operational step is to confirm with Courier Guy and PUDO which production endpoint, account identifier, API-key format and account permissions correspond to the supplied credentials. Once the providers accept the credentials, the same read-only 2 kg test should return live service-level rates instead of the fallback. No code or checkout redesign is required for that credential correction.

---

## Closing statement

The integration is safely deployed on Manus and checkout is operational. The carrier adapters, dimensions-based quoting, locker-aware PUDO path, server-side secret handling and fallback mechanism are in place. The only outstanding production blocker is provider-side authentication: both current credentials are being rejected with HTTP 401, so the site correctly continues to offer the clearly labelled R99 fallback rather than displaying an unverified carrier rate.
