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
  of `share_info.lua`. **Keep this window at least partially visible on
  screen** (not minimized, and not fully covered by another maximized
  window like BizHawk) — Chrome throttles timers in fully hidden/occluded
  windows down to as little as once per minute, which can make syncing
  appear stuck or cause duplicate-looking item reports. A small window
  positioned somewhere BizHawk isn't drawing over it is enough; it doesn't
  need focus, just visibility.
- `tracker/event_feed.html` — open with `?room=<the seed's Option string>`
  to watch the live event feed. Read-only, works in any browser — no folder
  access needed, unlike `sync_relay.html`. See "OBS Browser Source" below
  for streaming-specific options.

## Using the event feed as an OBS Browser Source

`tracker/event_feed.html` has a hidden settings panel in the top-left
corner, revealed on hover — with OBS's "Interact" mode (right-click the
Browser Source → Interact), you can hover there and fill in the room key,
Worker URL, max lines, and show-item-names, then click **Apply & reload**.
This is the easiest way to change rooms between seeds without touching the
Browser Source's configured URL (which OBS doesn't make convenient to edit
mid-stream) — settings applied this way are saved in the browser's local
storage and take priority over anything baked into the URL from then on.

The same settings can also be baked into the Browser Source's configured
URL as query parameters, which is useful for the very first load (before
anything's been saved) or for sharing a ready-to-use link:

- `?room=<key>` / `?workerUrl=<url>` — set the room and Worker URL, e.g.
  `event_feed.html?room=<option string>&workerUrl=https://rmr-sync.yourname.workers.dev`.
  (`workerUrl` still falls back to an interactive `window.prompt()` if
  never set any other way, but OBS's embedded browser doesn't reliably
  support that prompt — use the settings panel instead for OBS.)
- `?maxLines=N` — caps the feed to the most recent N entries; older ones
  are dropped from the page entirely rather than scrolled, so there's never
  a scrollbar to deal with in a fixed-size overlay. Omit it (or clear it in
  the settings panel) to keep the full, unlimited history.
- `?showText=1` — shows item names next to their icons.

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
