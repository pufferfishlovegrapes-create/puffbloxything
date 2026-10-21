# PuffProxy

A self-hosted Node.js fullscreen game proxy built around **Scramjet**. Scramjet intercepts and rewrites browser requests in a service worker; BareMux selects the Libcurl transport; a Wisp WebSocket backend carries TCP streams. A separate, SSRF-resistant HTTP proxy route remains for explicit, allowlisted upstream requests. The RationalGo preview is not the backend: deploy this Node.js project on your own server.

## Requirements and run

Node.js 20 or newer is required.

```sh
cp .env.example .env
# Set PUBLIC_BASE_URL to the externally reachable HTTPS origin before deployment.
npm ci
npm test
npm start
```

Open `http://localhost:3000/`; the page registers `/sw.js`, initializes Scramjet, sets the Libcurl transport to the local `/wisp/` endpoint, then loads the configured EasyFun page in a fullscreen Scramjet frame. Health endpoint: `GET /healthz`.

## Project structure

```text
puffproxy/
├── src/{server.js,config.js,proxy.js,policy.js,websocket.js,scramjet-config.js,scramjet-assets.js,wisp-policy.js}
├── public/{index.html,scramjet-client.js,sw.js}
├── test/{policy.test.js,scramjet.test.js}
├── package.json
├── package-lock.json
├── .env.example
├── Dockerfile
└── compose.yaml
```

## Environment

- `UPSTREAM_ORIGIN` — upstream origin only; default `https://www.easyfun.gg`.
- `UPSTREAM_PATH` — default page used by the legacy `/proxy/` route; default `/cloud-games/roblox.html`.
- `PUBLIC_BASE_URL` — public origin (scheme + host, no path). It is also checked against the `Origin` header for Wisp upgrades. Use the exact public HTTPS origin in production.
- `PORT` — listener port; default `3000`.
- `ALLOWED_HOSTNAMES` — exact additional hostnames for the legacy HTTP proxy only, after confirming they are required. The primary upstream hostname is always allowed there.

Scramjet's Wisp route is intentionally stricter: it currently allows **only the exact hostname in `UPSTREAM_ORIGIN`**, TCP, and ports 80/443. UDP and direct-IP destinations are disabled, and Wisp blocks private, loopback, link-local and reserved IP ranges. DNS is refreshed every 30 seconds. This can prevent assets, APIs or game-session endpoints hosted on other names from loading; do not broaden the allowlist until a specific required host is observed and reviewed. Wisp's library resolves a hostname to one address and its built-in private-IP checks apply to that resolved address; run this behind a restrictive outbound firewall as an additional control.

## Docker deployment

Set `PUBLIC_BASE_URL=https://your-proxy.example` in `.env`, then:

```sh
docker compose up --build -d
docker compose logs -f
docker compose down
```

Terminate TLS at a reverse proxy or hosting edge. Do not expose the app over public plain HTTP. Ensure the edge allows WebSocket upgrades on `/wisp/` and forwards the original `Origin`. Use `/healthz` for health checks.

## Direct Node.js deployment

On a Node.js 20+ server, clone the repository and run `npm ci`, `npm test`, and `npm start`. Use a process/service manager, TLS at the public edge, and a strict outbound firewall allowing only required public upstream destinations where practical. Keep the host and OS patched.

## Security model

- The Scramjet transport is not a general-purpose open proxy: Wisp checks an exact hostname allowlist, standard web ports, TCP-only, no direct IP, and rejects non-public IP ranges.
- The separate `/proxy/*` route retains its own exact allowlist, DNS validation/pinning, redirect revalidation, body limits, timeouts, and rate limiting.
- Wisp accepts upgrades only at `/wisp/` from the configured `PUBLIC_BASE_URL`; all other WebSocket paths are closed.
- Do not add hosts or relax security controls speculatively. Do not use this to bypass authentication, access controls, anti-bot measures, DRM, or upstream policy.

## Compatibility caveat

Scramjet is now the frontend proxy engine, but successful EasyFun play is **not yet verified**. A game can still depend on third-party API/CDN hosts, authentication/session checks, anti-bot measures, strict origin checks, WebRTC/UDP, DRM, service workers, or transport behavior not supported by this initial allowlist. UDP is deliberately disabled. Inspect browser console and server logs on your own deployment, identify each required host/transport, verify that access is authorized, and only then review narrowly scoped compatibility changes. The preview does not run the Wisp backend or confirm upstream gameplay.

## License notes

Scramjet, BareMux, Libcurl transport and Wisp are third-party projects with their own licenses. Review and comply with their current license terms before redistributing a deployment.