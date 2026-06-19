# Reverse proxy (nginx)

The portal (`src/website.ts`) serves the built React SPA (`web/dist`), the JSON
API and a Server-Sent-Events stream (`/api/live_stats`) on a **single port** —
`config.json` → `website.port`. There is no separate static web root to serve
(the old `website/` folder is gone). Put it behind nginx for TLS and a clean
`:80`/`:443`, and set `website.host` to `127.0.0.1` (and `website.port` to e.g.
`8080`) so the portal is reached only through nginx, not exposed directly.

> **SSE:** the `/api/` location must disable proxy buffering, otherwise nginx
> buffers the `/api/live_stats` event stream and the live stats never update.

## Sample config

```nginx
server {
    listen 80;
    server_name pool.example.com;

    # API + SSE — must not be buffered so /api/live_stats streams in real time.
    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:8080;   # = config.json website.port
        proxy_buffering off;                # required for SSE (/api/live_stats)
        proxy_cache off;
        proxy_read_timeout 3600s;           # keep long-lived SSE connections open
    }

    # Everything else (SPA shell, hashed assets, client-side routes) — the portal
    # serves web/dist and falls back to index.html itself, so just forward it.
    location / {
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

## Letting nginx serve the SPA directly (optional)

Slightly faster — static files come straight from disk instead of through Node;
only `/api/` is proxied. The `root` must be the Vite **build output** `web/dist`
(not `web/src` or `web/public`, which lack the built `index.html` and `assets/`).
Build it first: `cd web && npm install --legacy-peer-deps && npm run build`.

```nginx
server {
    listen 80;
    server_name pool.example.com;
    root /path/to/zny-nomp/web/dist;

    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:8080;
        proxy_buffering off;            # required for SSE (/api/live_stats)
        proxy_read_timeout 3600s;
    }

    location / {
        try_files $uri /index.html;    # SPA client-side routing fallback
    }
}
```

## TLS

For production, terminate TLS on `:443` (certs e.g. via certbot) and redirect
`:80` → `:443`:

```nginx
server {
    listen 443 ssl;
    server_name pool.example.com;
    ssl_certificate     /etc/letsencrypt/live/pool.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pool.example.com/privkey.pem;
    # ... same location /api/ and location / blocks as above ...
}

server {                       # redirect http -> https
    listen 80;
    server_name pool.example.com;
    return 301 https://$host$request_uri;
}
```
