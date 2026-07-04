# RMR Sync — Worker backend

Self-hosting guide for the Cloudflare Worker + Durable Object backend. A free
Cloudflare account is sufficient (see the design spec's "Open items" section
for what was confirmed about the free tier).

## One-time setup

1. Install dependencies: `npm install`
2. Log in: `npx wrangler login` (opens a browser to authorize)
3. If you've never deployed a Worker on this Cloudflare account before,
   claim a `*.workers.dev` subdomain at
   `https://dash.cloudflare.com/<your-account-id>/workers/subdomain`
   (find your account ID on the Workers & Pages overview page).

## Local development

`npm run dev` — runs the Worker locally (via `wrangler dev`), printing a
`http://127.0.0.1:8787`-style URL you can test against directly.

## Automated tests

`npm test` — runs the Vitest suite against the Worker and Durable Object
code in a simulated Workers runtime. Run this before every deploy.

## Deploy

`npm run deploy` — publishes to `https://rmr-sync.<your-subdomain>.workers.dev`
(the `rmr-sync` part comes from `name` in `wrangler.toml`; change it if you
want a different name).

## Point the mod at this backend

Once deployed, put the printed URL into `worker_url` in
`config/share_config.txt` (for players) and into the admin page's
Worker URL field.

## Note on new subdomains

Right after claiming or changing your `*.workers.dev` subdomain, HTTPS to it
can briefly fail with `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` while Cloudflare
provisions the certificate. This resolves on its own within a few minutes.
