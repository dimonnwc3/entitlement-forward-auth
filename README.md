# entitlement-forward-auth

Put self-hosted services behind your app's subscriptions — without modifying them. A [forward auth](https://doc.traefik.io/traefik/middlewares/http/forwardauth/) microservice that nginx, Traefik, and Caddy consult on every request; it answers by checking the caller's in-app purchase entitlements against their provider.

It's built for services you run but didn't write — a self-hosted LLM server, a document converter, any internal tool. These typically ship with no authentication at all, or a single static API key you'd otherwise have to embed in the app binary. Either way you can't add per-user subscription checks to their code. With forward auth you don't need to: the gate lives in the reverse proxy, the service behind it never knows it's protected, and static upstream keys stay on the server.

Supported providers: **RevenueCat**, **Adapty**, **Qonversion**, **Apphud**, **IAP Hub**.

## How it works

1. The client sends each request with identity headers: `X-Auth-App`, `X-Auth-User`, and — when request signing is enabled — `X-Auth-Timestamp` and `X-Auth-Signature`.
2. The proxy forwards the request metadata (`X-Forwarded-Method`, `X-Forwarded-Uri`, `X-Forwarded-Host`) to `/forward-auth` as a side request. The original request headers travel along, so the identity headers reach the service.
3. The service matches the target against the configured routes, resolves the app by its id, optionally verifies the signature, and looks up the caller's entitlements at the provider.

| Status | Meaning                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | Allowed. `X-Forwarded-App` / `X-Forwarded-User` plus any route-level `headers` are returned to the proxy for forwarding upstream. |
| `401`  | No route matched the target, or missing/unknown app or user, or missing/invalid signature.                                        |
| `403`  | Identity is valid but the user lacks a required entitlement.                                                                      |
| `5xx`  | The provider rejected the service's own credentials — fails closed.                                                               |

**Provider outages fail open.** If the provider answers 5xx or 429, or is unreachable, the request is allowed (`200`) and the outage is logged — a payment-provider outage should not lock out paying users. Provider auth errors (4xx, e.g. a bad key) fail closed instead.

Caching: allowed responses are cached for 15 min per app + user + required entitlements; users who lack the entitlements are not cached, so a fresh purchase takes effect on the very next request; unknown users are negatively cached for 30 s; identical in-flight lookups are deduplicated.

## Configuration

The service reads a YAML file (`CONFIG_PATH`, default `config.yaml`). [config.example.yaml](config.example.yaml) documents the full schema; the essentials:

```yaml
apps:
  myapp:
    provider:
      name: revenuecat # revenuecat | adapty | apphud | qonversion | iaphub
      secretKey: sk_...
    signingSecrets: # optional, enables request signing
      - sk_new
      - sk_old

routes:
  - host: ai.example.com
    paths: [/v1/generate, /v1/complete] # gate only the expensive endpoints
    entitlements: [pro] # any one active entitlement grants access
  - host: convert.example.com # service behind a static API key:
    paths: [/v1/*] # the key stays server-side, the app never sees it
    headers:
      Authorization: Bearer master_key
```

Provider credentials: `revenuecat`, `adapty` and `qonversion` take `secretKey`; `apphud` takes `apiKey`; `iaphub` takes `apiKey` + `appId`. Routes without `entitlements` only require a valid identity. The whole config is validated on boot — duplicate routes or unknown provider names refuse to start.

### Route matching

- A request matches a route when `host`, `paths`, and `methods` **all** match; entries inside each list are alternatives (OR). A missing field matches anything.
- Best match wins: host-scoped routes beat hostless ones, then the longest path pattern wins.
- Paths are exact (`/v1/complete`) or prefix (`/v1/*` matches `/v1` itself and everything under it; `/*` matches anything).

### Request signing

With `signingSecrets` configured, requests must carry a timestamp and an HMAC:

- `X-Auth-Timestamp` — epoch milliseconds, ±5 min window
- `X-Auth-Signature` — lowercase hex HMAC-SHA256 over `METHOD\nhost\npath?query\ntimestamp\nuserId` (method uppercased, host lowercased, path includes the query string)

Computing it with [@noble/hashes](https://github.com/paulmillr/noble-hashes) — pure JS, runs in React Native and Expo with no native modules (browsers and Node too):

```js
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";

const timestamp = String(Date.now());
const message = [
  "GET", // method, uppercased
  "ai.example.com", // host, lowercased
  "/v1/generate?x=1", // path, including the query string
  timestamp,
  "user-123",
].join("\n");

const signature = bytesToHex(
  hmac(sha256, utf8ToBytes("sk_new"), utf8ToBytes(message)),
);
```

Rotation: clients sign with the first secret in the list, verification accepts any — add the new secret at the front, drop the old one once clients have rotated. All header names are configurable via `authHeaders` / `responseHeaders`.

## Run

Docker (the image listens on port 80):

```bash
docker run -p 3000:80 -v "$PWD/config.yaml:/app/config.yaml:ro" \
  ghcr.io/dimonnwc3/entitlement-forward-auth
```

From source with [Bun](https://bun.sh) (listens on 3000):

```bash
bun install
bun start
```

| Env           | Default                 |                  |
| ------------- | ----------------------- | ---------------- |
| `CONFIG_PATH` | `config.yaml`           | config file path |
| `HOST`        | `0.0.0.0`               | listen address   |
| `PORT`        | `3000` (`80` in Docker) | listen port      |

Liveness probe: `GET /__live__`.

## Proxy setup

Apply the auth step only to the sites or routers you want protected — requests that match no route get a `401`.

**nginx** (`auth_request`):

```nginx
server {
    location / {
        auth_request /_auth;

        auth_request_set $authed_app $upstream_http_x_forwarded_app;
        auth_request_set $authed_user $upstream_http_x_forwarded_user;
        proxy_set_header X-Forwarded-App $authed_app;
        proxy_set_header X-Forwarded-User $authed_user;

        proxy_pass http://backend;
    }

    location = /_auth {
        internal;
        proxy_pass http://auth:3000/forward-auth;

        proxy_pass_request_body off;
        proxy_set_header Content-Length "";

        proxy_set_header X-Forwarded-Method $request_method;
        proxy_set_header X-Forwarded-Uri $request_uri;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

**Traefik** (dynamic config):

```yaml
http:
  routers:
    ai:
      rule: "Host(`ai.example.com`)"
      middlewares: [entitlement-auth]
      service: ai

  middlewares:
    entitlement-auth:
      forwardAuth:
        address: http://auth:3000/forward-auth
        authResponseHeaders:
          - X-Forwarded-App
          - X-Forwarded-User
```

**Caddy**:

```caddyfile
ai.example.com {
    forward_auth auth:3000 {
        uri /forward-auth
        copy_headers X-Forwarded-App X-Forwarded-User
    }
    reverse_proxy backend:8080
}
```

## Development

```bash
bun install
bun test         # unit tests
bun run check    # biome lint + format
bun run typecheck
```

## License

[MIT](LICENSE)
