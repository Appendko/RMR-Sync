# RMR Sync — Worker backend

Self-hosting guide for the Cloudflare Worker + Durable Object backend. A free
Cloudflare account is sufficient — see "Cloudflare account & free tier"
below for what that actually covers and why it's enough for this project.

## Cloudflare account & free tier

### Creating an account

If you don't already have one: go to
[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), sign up
with an email address, and verify it. No credit card is required to create
an account or to stay on the **Workers Free** plan — new accounts start on
Free by default. You can confirm this any time under **Workers & Pages →
Plans** in the dashboard.

### What Workers Free actually includes (verified against Cloudflare's current
docs, not just assumed)

| | Free plan limit |
|---|---|
| Worker requests | 100,000 / day |
| Worker CPU time | 10ms per invocation |
| Durable Object requests | 100,000 / day (a separate budget from Worker requests, per Cloudflare's own Durable Objects pricing page) |
| Durable Object compute duration | 13,000 GB-s / day |
| Durable Object storage | 5 GB total |

One hard requirement: **only SQLite-backed Durable Objects work on the Free
plan** — this repo's `worker/wrangler.toml` already uses the SQLite storage
backend (`new_sqlite_classes`), so there's nothing you need to change here;
this was confirmed working during initial setup and is why the migration in
`wrangler.toml` isn't `new_classes` (the older backend, which requires a paid
plan).

Storage billing for SQLite *did* start on schedule (January 7, 2026), but
Free-plan accounts are **never charged for it** — the 5GB is a genuine,
permanent free allowance, not a trial period. RMR Sync's actual storage
footprint per room is tiny (a `checksSeen` byte array plus a capped
200-entry event log — kilobytes, not gigabytes), so this limit isn't a
practical concern regardless of how many rooms accumulate over time before
they auto-expire.

### Will a real session actually fit inside 100,000 requests/day?

Comfortably, yes, for realistic group sizes. Each player's Lua companion
script drives one routine "check in" request roughly every 10 seconds when
idle (see `lua/share_info.lua`'s `cWaitFrames`), plus occasional extra
requests when someone picks up an item (these don't meaningfully add to the
total — item pickups are infrequent compared to the constant heartbeat).
For **10 players playing for 4 hours**:

```
10 players × (3600 seconds/hour × 4 hours ÷ 10 seconds/request) ≈ 14,400 requests
```

That's about 14% of the daily cap, leaving plenty of headroom for a longer
session, more players, or several separate rooms sharing the same Worker
deployment on the same day. The browser relay page (`tracker/sync_relay.html`)
polls its local outbox file every 400ms, but that's a **local file read**,
not a network request — it only actually calls the Worker when it sees a
genuinely new request to relay, which is what keeps the real request count
tied to the ~10-second heartbeat rather than the much faster local poll.

### What happens if you somehow exceed the limit

Requests beyond the daily cap get rejected until the daily quota resets
(00:00 UTC) — Cloudflare does **not** silently start charging a Free-plan
account; there's no surprise bill. If this ever became a real concern (e.g.
running many large, long-running sessions simultaneously on one account),
the fix is either spreading rooms across multiple self-hosted Worker
deployments, or upgrading that specific account to a paid plan — not
something to worry about for a normal group.

### Where to check current, authoritative numbers yourself

Pricing/limits pages can change after this guide is written. If something
here looks off, check directly:
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

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
