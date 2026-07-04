# share_information_mod — Design Spec

## Context

RouteMatriX Randomizer (RMR) combines Mega Man X1–X3 into a single randomizer. The `ref/` folder in this project contains two prior, related pieces of work (reference only — read-only, gitignored, never modified):

- **`ref/multiworld/`** — Lua scripts (BizHawk + Faust SNES core) implementing a *local, single-player* "multiworld": one person plays X1/X2/X3 in one session, switching ROMs, with certain item categories (life-ups, sub-tanks, armor, etc.) merged across titles via a shared save file (`boot.lua`).
- **`ref/RMR_progress_tracker_displayer_ver_js_20260126/`** — A companion Lua script that reads game memory (items, checks, deaths, clear status, current title) and writes it to a local JS file, which a local HTML page reads to render a visual progress tracker using purpose-built icon assets (per-game, per-boss, per-weapon).
- **`ref/aaa/`** — A real generated seed pack (ROMs, `boot.lua`, `spoiler.txt`, `save.txt`, savestates), kept as a concrete reference example. It's what confirmed the room-key format used below (see "Appendix: room-key verification").

Both are local-only: everything happens on one machine, for one player. **`share_information_mod`** is a new, standalone companion mod that extends this to *multiple real players on separate machines, playing the same seed*, who want to:

1. Share **checksSeen** (which locations have been scouted/hinted) across the group — pure intel, OR-merged, no gameplay/item advantage.
2. See a **live event feed** of each other's item pickups (e.g. "ds83171: [icon][icon]"), shown on a shared web tracker — a social/awareness feature, reusing the existing icon assets.

Both features ship together in v1 since they share the same backend, session key, and companion script. Boss-defeat events are explicitly out of scope for v1 — there's no reliable signal for "boss defeated" distinct from the items it grants.

## Key decisions

- **Room key**: the **Option string** (`sessionSave.param` in `boot.lua`'s terms) — confirmed by direct inspection of a generated seed pack to be the exact string printed under `***** Option/オプション *****` in the randomizer's `spoiler.txt`, and later mirrored into `save.txt` as `param="..."` once the game is first booted. Example: `V204#X7#SV8d5m27k+p99XcvrXsSiYA#sk#W1#T#ISB0#ISC#PEREREREREQ#MQAAIgEgA`. Since it's in `spoiler.txt` from the moment the seed is generated, the host can copy it straight from there — no need to boot the game, read ROM bytes, or wait for `save.txt` to exist. No separate room code needed — the same seed automatically means the same room.
- **Player identity**: a hand-edited local config file (`share_config.txt`), no in-game prompt.
- **Share level** (`checksSeen` only vs. `checksSeen+items`): a single **per-room** setting, not per-player, set once when the room is created.
- **Host duties are separated from gameplay entirely.** There is no `role = host|client` branching in the Lua script — every player runs the *identical* companion script and config (only `player_name` differs). Room lifecycle — create room (set mode), reset (clear state for a re-run), view status (mode, connected count, event count) — is handled by a **separate admin webpage**, run by whoever is organizing the session, independent of BizHawk. This avoids exposing room-admin actions to players' game clients and means one player accidentally misconfiguring `role` can't disrupt the room.
- **Backend**: Cloudflare Worker + **Durable Objects** (one DO instance per room/seed). A DO gives single-threaded consistency for the OR-merge (no lost updates from concurrent writes) and can hold live WebSocket connections for the browser tracker. Cloudflare's free plan includes a Durable Objects allowance (SQLite-backed), which should be sufficient at this scale — confirm current free-tier limits when setting up the Worker.
- **Transport differs per client type**, because BizHawk Lua has no WebSocket client and the admin page needs simple request/response:
  - Game-side (Lua) ↔ Worker: plain **HTTP** (`comm.httpPostAsync`/`httpGetAsync`), polled on a timer. This is a documented part of BizHawk's Lua `comm` API, but should be double-checked against the target BizHawk version during implementation since the ref scripts have never exercised it.
  - Admin page ↔ Worker: plain **HTTP** `fetch()`. Unlike WebSocket, this *is* subject to CORS, so the Worker must respond with `Access-Control-Allow-Origin` (and handle the `OPTIONS` preflight a JSON POST triggers) on the admin and player endpoints alike — a small, well-understood addition, not an architectural blocker.
  - Browser tracker ↔ Worker: real **WebSocket**, for instant event-feed updates. WebSocket connections are not subject to CORS, so a locally-opened HTML file can connect to a `wss://` endpoint with no special headers needed.
- **Tracker and admin page hosting**: static local HTML files (same pattern as the existing `index.html` displayer), opened directly — no deploy pipeline for v1.
- **Hosting model: a default shared instance, but "bring your own backend" is fully supported.** Technically one Worker deployment can serve unlimited independent rooms — each room key (`param`) maps to its own isolated Durable Object instance via `idFromName`, so unrelated groups on different seeds never interact even on a shared Worker. Practically, a single publicly-shared instance risks exhausting Cloudflare's free-tier daily request cap if adoption grows, and makes one person's account a single point of failure for everyone. So: the maintainer hosts a default instance for convenience (zero-setup for casual users), but `worker_url` remains a plain config value in both `share_config.txt` and the admin page — any group can deploy their own Worker (see `worker/README.md`) and point their own config at it, with no code changes needed. This matters in particular because the default instance is not guaranteed to stay up long-term (the maintainer may repurpose their Cloudflare account later).
- **No auth token on admin endpoints for v1.** This mod targets a small trusted friend group, not a public/competitive race — anyone who knows the room key could technically call `/reset` directly, but in practice only the organizer opens the admin page. Flagging this as a known simplification rather than an oversight; worth revisiting if this ever supports larger or less-trusted groups.
- **`boot.lua` and the existing progress tracker stay untouched.** This mod is purely additive: a new companion Lua script, a new backend, a new admin webpage, and a new (separate) HTML tracker page for the event feed.

## Architecture

```
Admin (organizer, no BizHawk)        Cloudflare                  Browser (any player/viewer)
┌─────────────────┐                 ┌──────────────┐          ┌──────────────┐
│ host_admin.html  │  HTTP fetch()   │ Worker        │          │ event feed   │
│ create/reset/    │────────────────►│  routes to    │  WS      │ tracker.html │
│ status           │  (CORS-enabled) │  Durable      │◄────────►│ ?room=<param>│
└─────────────────┘                 │  Object       │          └──────────────┘
                                     │  (1 per room, │
BizHawk (every player, identical)   │  keyed by     │
┌─────────────────┐                 │  sessionSave  │
│ boot.lua         │  reads RAM      │  .param)      │
│ (untouched)      │◄───────┐       │               │
│                  │        │       │               │
│ share_info.lua   │────────┘       │               │
│ (new companion)  │  HTTP POST/GET │               │
│ reads config.txt │────────────────►               │
└─────────────────┘  comm.http*     └──────────────┘
```

## Backend (Cloudflare Worker + Durable Object)

Per-room DO state: `mode` (`"checksSeen"` | `"checksSeen+items"`), `checksSeen` (96-byte merged OR state, covering X1/X2/X3 — same layout as `boot.lua`'s `addrChecksSeen` region), and a bounded event log (last ~200 pickups) so late-joining trackers can backfill history.

Endpoints, all under `/room/{param}/...`:

Admin (called by `host_admin.html`, needs CORS headers + `OPTIONS` preflight handling):
- `POST /admin/init` — creates the room and sets `mode` if not already set (idempotent no-op otherwise).
- `POST /admin/reset` — clears `checksSeen` and the event log (for starting a fresh run on the same room), keeps `mode`.
- `GET /admin/status` — returns `mode`, a summary of `checksSeen`, event count, and connected WebSocket count.

Player (called by `share_info.lua` via `comm.http*`, no browser/CORS involved):
- `POST /sync` — body: local `checksSeen` bytes → OR-merges into room state, responds with the fully merged bytes. Covers both push and pull in one round trip, mirroring `boot.lua`'s own `synchronize_or` pattern one level up (device → server → device). Fails clearly if the room hasn't been created yet (host must run `/admin/init` first).
- `POST /event` — body: `{player, game, items[]}` → appended to the log and broadcast to all connected WebSocket clients. Only accepted if `mode` includes items.

Tracker (browser, WebSocket, no CORS applicable):
- `GET /ws` (WebSocket upgrade) — connects here; on connect the server sends `mode` + backlog, then streams new events live.

## Companion Lua script (`lua/share_info.lua`)

Loaded after `boot.lua`, following the same convention as the existing tracker script ("load this script after loading RMR boot.lua"). Every player runs the identical script and logic — only `share_config.txt`'s `player_name` differs between them. Config: `player_name`, `worker_url`. (`share_mode` is not part of player config — it's set once, room-wide, via the admin page.)

Main loop, polled every few seconds (matching the existing tracker's `cWaitFrames`-style cadence):
1. If the room is not yet confirmed to exist (i.e. no admin has run `/admin/init` yet), poll and show a waiting message (via the existing `Text.out` helper) until it does.
2. Read local `checksSeen` bytes from RAM, `POST /sync`, write the merged response back into RAM — the same OR fold-back style as `updateSaveValue`'s `synchronize_or` in `boot.lua`.
3. If the room's `mode` (learned from the `/sync` response) includes items: diff current vs. previous items snapshot (same acquired-item detection approach as `boot.lua`'s `acquiredItemInfo` / `RMR_progress_tracker.lua`'s diffing) and `POST /event` for newly-acquired items.

## Admin webpage (`admin/host_admin.html`)

A static local HTML page the session organizer opens (not a player-facing tool, and doesn't require BizHawk at all). Fields to create a room: room key (the Option string, copy-pasted from `spoiler.txt`) and share mode. Buttons for reset and a live status view (polls `/admin/status`). Talks to the Worker via plain `fetch()`.

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
│   └── share_info.lua      # companion script (identical for every player)
├── worker/                 # Cloudflare Worker + Durable Object source
│   ├── src/index.js
│   ├── wrangler.toml
│   └── README.md           # self-hosting/deploy guide (wrangler login/deploy)
├── admin/
│   └── host_admin.html     # organizer-only room create/reset/status page
├── tracker/
│   ├── event_feed.html
│   └── event_feed.js
└── config/
    └── share_config.example.txt
```

## Open items to verify during implementation

- Confirm `comm.httpPostAsync`/`httpGetAsync` (or equivalent) are actually available and reliable in the target BizHawk build/Faust core combination — the ref scripts have never used networking, so this is unverified against this specific setup.
- Confirm current Cloudflare Durable Objects free-tier limits at time of deploy.

## Appendix: room-key verification

Confirmed by direct inspection of a generated seed pack (`spoiler.txt` / `save.txt`) that the Option string is identical to `boot.lua`'s `param` value, which is also readable live from ROM at a title-dependent address (`addrParamOnROM = {0xBFC400, 0xBFC400, 0xCFC400}` for X1/X2/X3 respectively — X1 and X2 share an address, X3 differs because of its different ROM bank layout). For reference, this is the dynamic read (title-aware, works for all three titles) used to cross-check it live in-game via BizHawk's Lua Console while `boot.lua` is running:
```lua
local addrParamOnROM = {0xBFC400,0xBFC400,0xCFC400}
local function getTitle() local tmp = cpu[0x80FFC9] - 0x30 ; if tmp < 0 then tmp = 1 end ; return tmp end
local title = getTitle()
local s="" for i=0,0x7F do local v=cpu[addrParamOnROM[title]+i] if v==0 then break end s=s..string.char(v) end
print(title, s)
```
This isn't needed for the mod itself — `spoiler.txt` is simpler and available before boot — but is kept here since it's how the room-key decision above was verified.

## Verification plan

- **Worker/DO**: local `wrangler dev` testing of `/admin/init`, `/admin/reset`, `/admin/status`, `/sync` (OR-merge correctness with concurrent-ish requests), `/event`, CORS preflight handling on admin endpoints, and the WebSocket upgrade + broadcast path, before deploying.
- **Admin page**: create a room, confirm players' `/sync` calls fail clearly before creation and succeed after; confirm `/admin/reset` clears state without needing to touch any player's game.
- **Lua script**: run two BizHawk instances (both running the identical script, different `player_name`) against the same seed, confirm `checksSeen` converges identically on both sides after visiting different scouted locations, and confirm they wait gracefully if the admin hasn't created the room yet.
- **Tracker page**: open `event_feed.html?room=<param>` in a browser while both BizHawk instances play, confirm live event updates appear with correct icons in both display modes, and confirm a late-opened tracker backfills the existing log.
- **End-to-end**: two players, same seed, real playthrough for ~15–20 minutes, checking for dropped events, RAM corruption from bad writes, and reasonable HTTP polling overhead.
