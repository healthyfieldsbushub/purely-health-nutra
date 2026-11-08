# Purely Health Nutra

E-commerce platform for gut-health products: dragon fruit cuttings, live probiotic
cultures (milk & water kefir, kombucha SCOBYs, yogurt cultures), spirulina and
chlorella live algae, fermentation equipment, BioSoil/EM1 farming inputs,
consultations and rooting services.

**Live site:** https://purelyhealthnutra.company

## Stack
- Frontend: React + Vite + TypeScript (Tailwind, shadcn-style UI)
- Backend: Node.js HTTP/TypeScript server (`server/index.ts`) — payments (PayFast, Yoco, PayPal), shipping (PUDO, The Courier Guy), Google integrations (Search Console, Indexing, Shopping feed, Maps, Gemini AI), LongCat & NVIDIA AI, Meta WhatsApp Cloud API webhook
- Database: managed MySQL (server-side credentials only)
- Hosting: Manus AI

## Development
```sh
npm install
npm run dev      # dev server + API on :3000
npm run build    # production build
```

## Deployment
Docker-based container deployment with health check at `/api/health`.
All API keys are server-side secrets — never exposed to the browser.
