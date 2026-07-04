# share_information_mod — Design Spec

## Context

RouteMatriX Randomizer (RMR) combines Mega Man X1–X3 into a single randomizer. The `ref/` folder in this project contains two prior, related pieces of work (reference only — read-only, gitignored, never modified):

- **`ref/multiworld/`** — Lua scripts (BizHawk + Faust SNES core) implementing a *local, single-player* "multiworld": one person plays X1/X2/X3 in one session, switching ROMs, with certain item categories (life-ups, sub-tanks, armor, etc.) merged across titles via a shared save file (`boot.lua`).
- **`ref/RMR_progress_tracker_displayer_ver_js_20260126/`** — A companion Lua script that reads game memory (items, checks, deaths, clear status, current title) and writes it to a local JS file, which a local HTML page reads to render a visual progress tracker using purpose-built icon assets (per-game, per-boss, per-weapon).

Both are local-only: everything happens on one machine, for one player. **`share_information_mod`** is a new, standalone companion mod that extends this to *multiple real players on separate machines, playing the same seed*, who want to:

1. Share **checksSeen** (which locations have been scouted/hinted) across the group — pure intel, OR-merged, no gameplay/item advantage.
2. See a **live event feed** of each other's item pickups (e.g. "ds83171: [icon][icon]"), shown on a shared web tracker — a social/awareness feature, reusing the existing icon assets.

Both features ship together in v1 since they share the same backend, session key, and companion script. Boss-defeat events are explicitly out of scope for v1 — there's no reliable signal for "boss defeated" distinct from the items it grants.

## Key decisions

- **Room key**: `sessionSave.param`, the seed-unique string `boot.lua` already computes. No separate room code needed — the same seed automatically means the same room.
- **Player identity**: a hand-edited local config file (`share_config.txt`), no in-game prompt.
- **Share level** (`checksSeen` only vs. `checksSeen+items`): a single **per-room** setting, not per-player. Whoever runs the **host** role sets it when the room is created; everyone else inherits it.
- **Host vs. client role**: one Lua script, config-driven (`role = host|client`). The host calls `/init` to create/set the room's mode; clients wait for the room to exist.
- **Backend**: Cloudflare Worker + **Durable Objects** (one DO instance per room/seed). A DO gives single-threaded consistency for the OR-merge (no lost updates from concurrent writes) and can hold live WebSocket connections for the browser tracker. Cloudflare's free plan includes a Durable Objects allowance (SQLite-backed), which should be sufficient at this scale — confirm current free-tier limits when setting up the Worker.
- **Transport is asymmetric, because BizHawk Lua has no WebSocket client**:
  - Game-side (Lua) ↔ Worker: plain **HTTP** (`comm.httpPostAsync`/`httpGetAsync`), polled on a timer. This is a documented part of BizHawk's Lua `comm` API, but should be double-checked against the target BizHawk version during implementation since the ref scripts have never exercised it.
  - Browser tracker ↔ Worker: real **WebSocket**, for instant event-feed updates. WebSocket connections are not subject to CORS (unlike fetch/XHR), so a locally-opened HTML file can connect to a `wss://` endpoint with no special headers needed.
- **Tracker hosting**: a static local HTML file (same pattern as the existing `index.html` displayer), opened with `?room=<param>` in the URL — no deploy pipeline for v1.
- **`boot.lua` and the existing progress tracker stay untouched.** This mod is purely additive: a new companion Lua script, a new backend, and a new (separate) HTML tracker page for the event feed.

## Architecture

```
BizHawk (per player)                 Cloudflare                  Browser
┌─────────────────┐                 ┌──────────────┐          ┌──────────────┐
│ boot.lua         │  reads RAM      │ Worker        │          │ event feed   │
│ (untouched)      │◄───────┐       │  routes to    │  WS      │ tracker.html │
│                  │        │       │  Durable      │◄────────►│ ?room=<param>│
│ share_info.lua   │────────┘       │  Object       │          └──────────────┘
│ (new companion)  │  HTTP POST/GET │  (1 per room, │
│ reads config.txt │────────────────►  keyed by     │
└─────────────────┘  comm.http*     │  sessionSave  │
                                     │  .param)      │
                                     └──────────────┘
```

## Backend (Cloudflare Worker + Durable Object)

Per-room DO state: `mode` (`"checksSeen"` | `"checksSeen+items"`), `checksSeen` (96-byte merged OR state, covering X1/X2/X3 — same layout as `boot.lua`'s `addrChecksSeen` region), and a bounded event log (last ~200 pickups) so late-joining trackers can backfill history.

Endpoints, all under `/room/{param}/...`:
- `POST /init` — host-only; sets `mode` if not already set (idempotent no-op otherwise).
- `POST /sync` — body: local `checksSeen` bytes → OR-merges into room state, responds with the fully merged bytes. Covers both push and pull in one round trip, mirroring `boot.lua`'s own `synchronize_or` pattern one level up (device → server → device).
- `POST /event` — body: `{player, game, items[]}` → appended to the log and broadcast to all connected WebSocket clients. Only accepted if `mode` includes items.
- `GET /ws` (WebSocket upgrade) — browser tracker connects here; on connect the server sends `mode` + backlog, then streams new events live.

## Companion Lua script (`lua/share_info.lua`)

Loaded after `boot.lua`, following the same convention as the existing tracker script ("load this script after loading RMR boot.lua"). Reads `share_config.txt`: `player_name`, `role` (`host`/`client`), `worker_url`, and `share_mode` (host only).

Main loop, polled every few seconds (matching the existing tracker's `cWaitFrames`-style cadence):
1. **Host**: if the room is not yet confirmed initialized, `POST /init`.
2. **Client**: if the room is not yet confirmed to exist, poll and show a waiting message (via the existing `Text.out` helper) until the host's `/init` has landed.
3. Read local `checksSeen` bytes from RAM, `POST /sync`, write the merged response back into RAM — the same OR fold-back style as `updateSaveValue`'s `synchronize_or` in `boot.lua`.
4. If `share_mode` includes items: diff current vs. previous items snapshot (same acquired-item detection approach as `boot.lua`'s `acquiredItemInfo` / `RMR_progress_tracker.lua`'s diffing) and `POST /event` for newly-acquired items.

## Event-feed tracker (`tracker/event_feed.html`)

A new page, separate from the existing progress displayer. Opened locally with `?room=<param>` in the URL; connects via WebSocket. Reuses `progress_tracker_assets` icons and `RMR_progress_tracker_id_maps.js`'s item-id→icon mapping (icons are already color-coded per game, so no separate game badge is needed). Two display modes:
- Icon-only: `Player: [icon][icon][icon]` (one line per pickup batch, since a single boss kill can grant several items at once).
- Icon+text: `Player: [icon] LifeUp`.

## Repo layout

```
share_information_mod/
├── .gitignore              # ignores /ref
├── README.md
├── lua/
│   └── share_info.lua      # companion script
├── worker/                 # Cloudflare Worker + Durable Object source
│   ├── src/index.js
│   └── wrangler.toml
├── tracker/
│   ├── event_feed.html
│   └── event_feed.js
└── config/
    └── share_config.example.txt
```

## Open items to verify during implementation

- Confirm `comm.httpPostAsync`/`httpGetAsync` (or equivalent) are actually available and reliable in the target BizHawk build/Faust core combination — the ref scripts have never used networking, so this is unverified against this specific setup.
- Confirm current Cloudflare Durable Objects free-tier limits at time of deploy.

## Verification plan

- **Worker/DO**: local `wrangler dev` testing of `/init`, `/sync` (OR-merge correctness with concurrent-ish requests), `/event`, and the WebSocket upgrade + broadcast path, before deploying.
- **Lua script**: run two BizHawk instances (host + client) against the same seed, confirm `checksSeen` converges identically on both sides after visiting different scouted locations, and confirm `/init`'s idempotency (client joining before or after the host).
- **Tracker page**: open `event_feed.html?room=<param>` in a browser while both BizHawk instances play, confirm live event updates appear with correct icons in both display modes, and confirm a late-opened tracker backfills the existing log.
- **End-to-end**: two players, same seed, real playthrough for ~15–20 minutes, checking for dropped events, RAM corruption from bad writes, and reasonable HTTP polling overhead.
