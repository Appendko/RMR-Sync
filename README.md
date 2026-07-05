# RMR Sync

A companion mod for RouteMatriX Randomizer (Mega Man X1–X3 combined
randomizer) that lets multiple players on the same seed share:

1. **checksSeen** — which locations have been scouted/hinted, OR-merged
   across the group (pure intel, no item advantage).
2. **A live item-pickup event feed** — a shared web page showing each
   player's pickups in real time, with icons.

See `docs/superpowers/specs/2026-07-04-share-information-mod-design.md`
for the full design.

## Components

- `worker/` — Cloudflare Worker + Durable Object backend. See
  `worker/README.md` to deploy your own (or use a shared instance someone
  else deployed).
- `admin/host_admin.html` — open this to create/reset/inspect a room. Not
  needed by regular players, only whoever is organizing the session.
- `lua/share_info.lua` — the BizHawk companion script every player loads
  after `boot.lua` (a plain launch — no special command-line flags needed).
  Copy `config/share_config.example.txt` to `share_config.txt` next to
  `boot.lua` and fill in your name and the Worker URL first. It only ever
  reads/writes two small local files (`rmrsync_out.json`/`rmrsync_in.json`)
  next to `boot.lua` — it never calls the network directly.
- `tracker/sync_relay.html` — **each player** opens this once (Chrome, Edge,
  or another Chromium browser) and picks the folder containing `boot.lua`.
  It relays those local files to the Worker in the background; keep the tab
  open while playing. This is what actually talks to the network on behalf
  of `share_info.lua`.
- `tracker/event_feed.html` — open with `?room=<the seed's Option string>`
  to watch the live event feed. Read-only, works in any browser — no folder
  access needed, unlike `sync_relay.html`.

## Quick start (for a group already using a deployed Worker)

1. Whoever's organizing: open `admin/host_admin.html`, enter the Worker
   URL, the room key (the seed's Option string, from that seed's
   `spoiler.txt`), pick a share mode, and click **Create Room**.
2. Every player: copy `config/share_config.example.txt` to
   `share_config.txt` next to your `boot.lua`, fill in your name and the
   same Worker URL, then load `boot.lua` as normal, get into gameplay,
   and load `lua/share_info.lua` as a second script.
3. Every player: open `tracker/sync_relay.html` in a Chromium browser,
   click **Choose game folder**, and pick the folder containing your
   `boot.lua`. Keep the tab open while you play.
4. Optional: anyone can open `tracker/event_feed.html?room=<option string>`
   to watch the live feed.

## Deploying your own backend

See `worker/README.md`. No changes to any other file are needed — just
point `worker_url` (in `share_config.txt` and the admin page) at your own
deployed Worker.
