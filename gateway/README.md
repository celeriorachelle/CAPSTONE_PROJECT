Express Gateway integration (minimal)

What I added
- `gateway/gateway.config.yml` - minimal Express Gateway configuration that proxies all incoming requests to this app running on `http://127.0.0.1:3000`.
- `gateway/system.config.yml` - minimal system settings (admin + http ports).
- `app.js` changes to `trust proxy` and a small permissive CORS middleware for API-like paths.

How this works
1. Run your Express app locally as usual (it listens on port 3000 by default).
2. Install Express Gateway globally or locally and start it using the gateway config. The gateway will listen on port 8080 and forward requests to your app.

Quick start (local)

# Install Express Gateway globally (if not already installed)
# (run from a PowerShell terminal)
npm install -g express-gateway

# From the project root, run the gateway and point it at the config
# (Express Gateway will look for ./gateway/gateway.config.yml by default if you run eg gateway start from the folder)
cd gateway
eg gateway start --dir .

By default the gateway will forward requests on http://localhost:8080/* to your app at http://127.0.0.1:3000/*.

Notes & next steps
- Stripe Webhook: Stripe requires access to the raw request body to verify signatures. If you plan to route Stripe webhooks via the gateway, you must ensure the gateway forwards raw body bytes unchanged to `/webhook` (or configure Stripe to call your app directly). If you see webhook signature verification errors, point Stripe at the app or add a passthrough rule.
- Authentication: This repo currently uses session cookies. The gateway can be configured to handle auth (JWT, API keys) or to pass cookies through. For stateless APIs consider adding JWT auth and a gateway policy to validate tokens.
- Path rewriting: current gateway config simply proxies everything. If you'd rather expose a canonical API prefix (e.g. `/api/*`) and rewrite to the app root, I can update the gateway config to strip prefixes.
- HTTPS & production: For production, run the gateway behind TLS or configure it with SSL. Update serviceEndpoint URLs to your app's internal address.

If you want, I can now:
- Narrow the proxied paths (e.g. only `/maps`, `/plots`, `/api`),
- Add path rewriting to expose `/api/*` externally, or
- Add a pipeline that enforces JWT or API-key policy for staff endpoints.

Tell me which of those you'd like next and I'll apply it (and then run a quick smoke test).