# Custom Domains

Bind your own domain names to LinkBreeze pages (issue #85). One instance can
serve many domains: each page can own a domain, visitors land on
`https://jane.com/` and see Jane's page directly — no `/slug` in sight.

## How it works

1. **DNS + TLS are yours** (the reverse proxy terminates TLS).
2. Domains are bound to pages in **Admin → Domains**.
3. The proxy (`src/proxy.ts`) reads the incoming `Host` header on every
   request, finds the matching binding, and rewrites or redirects —
   everything else (analytics, /go links, vCard/wallet, email capture)
   keeps working unchanged because they're same-origin.

A binding shows **Pending** until the first real request arrives with that
`Host` header — that's the activation proof (no fake "verified" state).
Use **Activate now** to flip it manually for `/etc/hosts`-style testing.

## Requirements

- **Wildcard or per-domain DNS**: every domain you bind needs an
  `A`/`AAAA` record (or a `CNAME`) pointing at the machine running
  LinkBreeze.
- **A wildcard certificate** (or per-domain certs). Caddy automates this;
  nginx needs `certbot` with the wildcard challenge (DNS-01).
- **Reverse proxy**: all bound hosts must route to the LinkBreeze
  container/port.

LinkBreeze itself never terminates TLS. Redirect targets and canonical URLs
are always emitted as `https://` — plain HTTP still works for LAN testing,
but crawlers are always pointed at the secure URL.

## Reverse-proxy examples

### Caddy (automatic HTTPS — recommended)

```caddy
# Wildcard: one site block covers every bound domain.
# DNS-01 wildcard requires the dns provider plugin, e.g. cloudflare:
#   xcaddy build --with github.com/caddy-dns/cloudflare
{
    email you@example.com
    acme_dns cloudflare {env.CF_API_TOKEN}
}

*.example.com, example.com {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    reverse_proxy localhost:3000
}

# One-off extra domains (on-demand TLS issues certificates as they're hit):
https://jane.com, https://www.jane.com {
    tls {
        on_demand
    }
    reverse_proxy localhost:3000
}
```

### nginx

```nginx
# One server block per bound domain (certificates via certbot DNS-01):
server {
    listen 443 ssl;
    server_name jane.com www.jane.com;

    ssl_certificate     /etc/letsencrypt/live/jane.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jane.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

server {
    listen 443 ssl;
    server_name links.example.com;
    # ... same proxy config; your primary host / admin surface
}
```

`proxy_set_header Host $host;` is required — host-based routing reads it
(`X-Forwarded-Host` is honored too).

### Traefik

```yaml
http:
  routers:
    linkbreeze-wildcard:
      rule: "HostRegexp(`{any:.+}`)"   # or explicit Host(`jane.com`) && ...
      entryPoints: [websecure]
      tls:
        certResolver: myresolver
        domains:
          - main: "example.com"
            sans: ["*.example.com"]
      service: linkbreeze
  services:
    linkbreeze:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
        passHostHeader: true
```

## Concepts

### Bindings

| Kind | Meaning |
|---|---|
| **Primary** | The page's canonical identity. One per page. |
| **Alias** | Extra host for the same page. |

| Behavior | Effect |
|---|---|
| **Serve the page** | Requests on this host render the page. |
| **Redirect to primary (same path)** | 301 to the primary domain, path preserved. |
| **Redirect to the page slug** | 301 to `https://<primary>/<slug>`. |

### Scope (per page)

| Scope | A bound host exposes |
|---|---|
| **Exclusive** (default) | Exactly the page: root, `/privacy`, OG image, and its own APIs. Other slugs → 404. The domain IS the page. |
| **Hub** | The page at the root **plus** every other slug keeps resolving under the domain (normal path routing). |

### Routing policy (instance-wide)

- **Primary host** — where your admin lives. Also settable with the
  `LINKBREEZE_PRIMARY_HOST` env variable (env wins).
- **Admin host lock** (default *strict*) — admin/login/setup return 404 on
  any host other than the primary. Defense-in-depth: anyone can point a
  domain's A record at your server; the lock makes sure your login page and
  session cookies are never exposed on a host you don't control.
- **Unknown hosts** — what an unbound host sees: *path routing* (the
  classic behavior, default), *404*, or *redirect to primary*.
- **www handling** — when `www.<bound-domain>` is not bound explicitly:
  *redirect to the bound domain* (default, SEO-consistent), *serve like the
  bound domain*, or *off* (explicit aliases only).
- **Canonical strategy** — how `/<slug>` on the primary host and the domain
  reconcile: *301* (default, recommended), *canonical tag only* (for edge
  proxies where 301s loop), or *off*.

## SEO

- The canonical URL of a bound page is always the domain **root**
  (`https://jane.com/`), emitted via `<link rel="canonical">` and og:url.
- Sitemaps list every active primary domain root; on a bound host the
  sitemap contains exactly that one URL.
- With the default 301 strategy, slug URLs on the primary host redirect to
  the domain, so duplicates never get indexed.

## Limits / notes

- `BASE_URL` (if set) still wins for absolute OG/metadata URLs on the
  primary host — it predates domains and prevents host-header injection.
  Leave it unset when using custom domains, or set it to your primary host.
- Domain names are stored punycode-normalized (IDN: enter `bücher.de`, it
  is stored as `xn--bcher-kva.de` and matched either way).
- LinkBreeze cannot verify domain *ownership* (you host it, you are the
  owner) — the pending→active flip only proves the domain *routes* here.
- The host lock also reserves `/pages` and `/domains` as admin-only paths;
  they can no longer be used as public page slugs.
- Analytics stay page-keyed, exactly as before — a domain visit increments
  the bound page's counters, nothing else changes.
