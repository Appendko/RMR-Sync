# RMR Sync — Design Spec

## Context

RouteMatriX Randomizer (RMR) combines Mega Man X1–X3 into a single randomizer. The `ref/` folder in this project contains two prior, related pieces of work (reference only — read-only, gitignored, never modified):

- **`ref/multiworld/`** — Lua scripts (BizHawk + Faust SNES core) implementing a *local, single-player* "multiworld": one person plays X1/X2/X3 in one session, switching ROMs, with certain item categories (life-ups, sub-tanks, armor, etc.) merged across titles via a shared save file (`boot.lua`).
- **`ref/RMR_progress_tracker_displayer_ver_js_20260126/`** — A companion Lua script that reads game memory (items, checks, deaths, clear status, current title) and writes it to a local JS file, which a local HTML page reads to render a visual progress tracker using purpose-built icon assets (per-game, per-boss, per-weapon).
- **`ref/aaa/`** — A real generated seed pack (ROMs, `boot.lua`, `spoiler.txt`, `save.txt`, savestates), kept as a concrete reference example. It's what confirmed the room-key format used below (see "Appendix: room-key verification").

Both are local-only: everything happens on one machine, for one player. **RMR Sync** is a new, standalone companion mod that extends this to *multiple real players on separate machines, playing the same seed*, who want to:

1. Share **checksSeen** (which locations have been scouted/hinted) across the group — pure intel, OR-merged, no gameplay/item advantage.
2. See a **live event feed** of each other's item pickups (e.g. "ds83171: [icon][icon]"), shown on a shared web tracker — a social/awareness feature, reusing the existing icon assets.

Both features ship together in v1 since they share the same backend, session key, and companion script. Boss-defeat events are explicitly out of scope for v1 — there's no reliable signal for "boss defeated" distinct from the items it grants.

## Key decisions

- **Room key**: the **Option string** (`sessionSave.param` in `boot.lua`'s terms) — confirmed by direct inspection of a generated seed pack to be the exact string printed under `***** Option/オプション *****` in the randomizer's `spoiler.txt`, and later mirrored into `save.txt` as `param="..."` once the game is first booted. Example: `V204#X7#SV8d5m27k+p99XcvrXsSiYA#sk#W1#T#ISB0#ISC#PEREREREREQ#MQAAIgEgA`. Since it's in `spoiler.txt` from the moment the seed is generated, the host can copy it straight from there — no need to boot the game, read ROM bytes, or wait for `save.txt` to exist. No separate room code needed — the same seed automatically means the same room.
- **Player identity**: a hand-edited local config file (`share_config.txt`), no in-game prompt.
- **Share level** (`checksSeen` only vs. `checksSeen+items`): a single **per-room** setting, not per-player, set once when the room is created.
- **Host duties are separated from gameplay entirely.** There is no `role = host|client` branching in the Lua script — every player runs the *identical* companion script and config (only `player_name` differs). Room lifecycle — create room (set mode), reset (clear state for a re-run), view status (mode, connected count, event count) — is handled by a **separate admin webpage**, run by whoever is organizing the session, independent of BizHawk. This avoids exposing room-admin actions to players' game clients and means one player accidentally misconfiguring `role` can't disrupt the room.
- **Backend**: Cloudflare Worker + **Durable Objects** (one DO instance per room/seed). A DO gives single-threaded consistency for the OR-merge (no lost updates from concurrent writes) and can hold live WebSocket connections for the browser tracker. Cloudflare's free plan includes a Durable Objects allowance (SQLite-backed), which should be sufficient at this scale — confirm current free-tier limits when setting up the Worker.
- **Game-side networking is relayed through a browser page, not done directly in Lua — confirmed necessary by empirical spike, not assumed.** A live BizHawk 2.11 test found that `comm.httpGet`/`comm.httpPost` both **block the emulation thread** (audible sound stutter on every call), and a full enumeration of the `comm` Lua table (`for k,v in pairs(comm) do ... end`) confirmed **no async HTTP variant exists at all** in this BizHawk build — so there is no way to call the Worker directly from Lua without stuttering the game on every poll. (A related dead end: `comm.httpSetGetUrl`/`httpSetPostUrl` cannot initialize BizHawk's HTTP subsystem from Lua alone — it throws a `NullReferenceException` unless BizHawk was launched with `--url_get=<pattern> --url_post=<pattern>` command-line flags, which is undesirable to require of every player anyway.) Since direct Lua HTTP is off the table entirely, **BizHawk needs no special launch flags at all** — `share_info.lua` never touches `comm.http*`.
  - Game-side (Lua) ↔ local files: `share_info.lua` writes an **outbox** file (`rmrsync_out.json`, next to `boot.lua`) describing its pending sync/event request, and reads an **inbox** file (`rmrsync_in.json`) for the response. Plain blocking `io.open`/`write`/`close`, matching the existing progress tracker's file-I/O convention exactly (bare relative filenames, no atomic rename — `os.rename`/`os.remove` appear nowhere in `ref/` and aren't relied on here either). Fast, local-only, no network stutter.
  - Local files ↔ Worker: a small **browser relay page** (`tracker/sync_relay.html`), opened once by each player, does the real networking. It uses the **File System Access API** (`showDirectoryPicker`, `createWritable`) to read/write those same two files in the game folder (one-time folder-access grant, persisted across reloads via IndexedDB), and plain `fetch()` to call `/sync`/`/event` on the Worker. Chromium-only (Chrome/Edge/Brave) — Firefox/Safari don't support the writable side of this API — an accepted tradeoff since it's one browser tab a player already needs open, not a second process/runtime to install.
  - Admin page ↔ Worker: plain **HTTP** `fetch()`. Unlike WebSocket, this *is* subject to CORS, so the Worker must respond with `Access-Control-Allow-Origin` (and handle the `OPTIONS` preflight a JSON POST triggers) on the admin and player endpoints alike — a small, well-understood addition, not an architectural blocker.
  - Browser tracker ↔ Worker: real **WebSocket**, for instant event-feed updates. WebSocket connections are not subject to CORS, so a locally-opened HTML file can connect to a `wss://` endpoint with no special headers needed. Unaffected by the relay redesign — it stays a separate, read-only, any-browser page so spectators without folder-write needs (or on non-Chromium browsers) can still watch.
- **Tracker and admin page hosting**: static local HTML files (same pattern as the existing `index.html` displayer), opened directly — no deploy pipeline for v1.
- **Hosting model: a default shared instance, but "bring your own backend" is fully supported.** Technically one Worker deployment can serve unlimited independent rooms — each room key (`param`) maps to its own isolated Durable Object instance via `idFromName`, so unrelated groups on different seeds never interact even on a shared Worker. Practically, a single publicly-shared instance risks exhausting Cloudflare's free-tier daily request cap if adoption grows, and makes one person's account a single point of failure for everyone. So: the maintainer hosts a default instance for convenience (zero-setup for casual users), but `worker_url` remains a plain config value in both `share_config.txt` and the admin page — any group can deploy their own Worker (see `worker/README.md`) and point their own config at it, with no code changes needed. This matters in particular because the default instance is not guaranteed to stay up long-term (the maintainer may repurpose their Cloudflare account later).
- **Admin secret, separate from the room key.** The room key (Option string) can't be treated as a secret in practice — it's shown on-screen in-game, so anyone watching a stream sees it, not just the players. That means it reaches a much wider audience than intended (tracker viewers, stream chat), so it can't also be the thing that authorizes destructive admin actions. The organizer picks a separate **admin secret** when creating the room (via `host_admin.html`); the Worker stores it and requires it on `POST /admin/reset`. Knowing the room key alone (enough to sync as a player or watch the tracker) is not enough to reset a room.
- **Reset uses an epoch counter, because `checksSeen` can't be force-cleared without touching `boot.lua`.** `/admin/reset` wipes the server's `checksSeen` to zero, but a player who keeps playing the same save file still has their own previously-discovered bits cached locally (in `sessionSave.checksSeen` and mirrored into live RAM). Since syncing is a one-way OR-merge (bits only ever turn on, by design — that's what makes it conflict-free), that player's very next sync would silently re-upload their old bits and undo the reset. Reaching into `boot.lua`'s own live RAM tracking to force a "hard" clear across the board isn't something this mod does — it stays purely additive. Instead, each room keeps a `resetEpoch` counter, bumped on every reset. `/sync` requests carry the client's last-known epoch; if it's behind the room's current epoch, the server **discards that client's contribution** for the merge (so a stale client can never re-pollute a freshly reset room) and just returns the current epoch + state so the client can catch up. `share_info.lua`, on noticing its epoch is behind, does a direct overwrite of its own local `checksSeen` (both `sessionSave.checksSeen` and the current title's live RAM) instead of the usual OR-fold-back, so the reset actually sticks for that client going forward. This assumes `checksSeen` bits are a "sticky, set-once" flag the ROM never re-asserts on its own during continued play — worth a quick empirical check during two-player verification (Task 15 in the implementation plan) rather than taken purely on faith.
- **Rooms auto-expire after 24h of inactivity**, using a Durable Object Alarm rescheduled on every request that touches room state (`/admin/init`, `/admin/reset`, `/sync`, `/event`). If nothing happens for a full 24 hours, the alarm fires and wipes the room's storage. This is a sliding window, not a fixed cutoff from creation — an actively-played multi-day session never gets wiped mid-run, but abandoned test rooms and finished sessions clean themselves up rather than lingering in storage indefinitely (there's no other TTL mechanism in Durable Objects; storage otherwise persists forever).
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
BizHawk (every player, identical)   │  keyed by     │          Browser (every player)
┌─────────────────┐                 │  sessionSave  │          ┌──────────────────┐
│ boot.lua         │  reads RAM      │  .param)      │  fetch() │ sync_relay.html   │
│ (untouched)      │◄───────┐       │               │◄─────────│ (File System      │
│                  │        │       │               │          │  Access API)      │
│ share_info.lua   │────────┘       └──────────────┘          └──────────────────┘
│ (new companion)  │  local files only:                                ▲
│ reads config.txt │  rmrsync_out.json (Lua→browser)                   │
└─────────────────┘  rmrsync_in.json  (browser→Lua) ───────────────────┘
                      (same folder as boot.lua, no comm.http* at all)
```

## Backend (Cloudflare Worker + Durable Object)

Per-room DO state: `mode` (`"checksSeen"` | `"checksSeen+items"`), `adminSecret`, `resetEpoch` (integer, starts at 0, incremented on every reset — never exposed by `/admin/status`), `checksSeen` (96-byte merged OR state, covering X1/X2/X3 — same layout as `boot.lua`'s `addrChecksSeen` region), and a bounded event log (last ~200 pickups) so late-joining trackers can backfill history. Every request that touches this state reschedules a 24h-inactivity Durable Object Alarm; when it fires, all of the above is wiped.

Endpoints, all under `/room/{param}/...`:

Admin (called by `host_admin.html`, needs CORS headers + `OPTIONS` preflight handling):
- `POST /admin/init` — body `{mode, adminSecret}`; creates the room, sets `mode`, stores `adminSecret`, and initializes `resetEpoch` to 0 if the room doesn't exist yet (idempotent no-op otherwise — a repeat call just returns the existing mode, no secret comparison needed since nothing is mutated).
- `POST /admin/reset` — body `{adminSecret}`; clears `checksSeen` and the event log (for starting a fresh run on the same room), increments `resetEpoch`, keeps `mode`. Rejected (403) if `adminSecret` is missing or doesn't match what was set at creation.
- `GET /admin/status` — returns `mode`, a summary of `checksSeen`, event count, and connected WebSocket count. No secret required — read-only, and the counts aren't sensitive.

Player (called by the browser relay page, `tracker/sync_relay.html`, via `fetch()` — CORS-enabled like the admin endpoints, since it's not BizHawk calling these directly anymore):
- `POST /sync` — body `{checksSeen, epoch}` → OR-merges into room state and responds with the fully merged bytes **only if the client's `epoch` matches or is ahead of the room's `resetEpoch`**; a client reporting an older epoch has its contribution discarded (protects a freshly reset room from being silently re-populated by a client that hasn't caught up yet), and just gets the current state + current epoch back so it can catch up. Covers both push and pull in one round trip, mirroring `boot.lua`'s own `synchronize_or` pattern one level up (device → server → device). Fails clearly (409) if the room hasn't been created yet (host must run `/admin/init` first).
- `POST /event` — body: `{player, game, items[]}` → appended to the log and broadcast to all connected WebSocket clients. Only accepted if `mode` includes items.

Tracker (browser, WebSocket, no CORS applicable):
- `GET /ws` (WebSocket upgrade) — connects here; on connect the server sends `mode` + backlog, then streams new events live.

## Companion Lua script (`lua/share_info.lua`)

Loaded after `boot.lua`, following the same convention as the existing tracker script ("load this script after loading RMR boot.lua"). Every player runs the identical script and logic — only `share_config.txt`'s `player_name` differs between them. Config: `player_name`, `worker_url`. (`share_mode` is not part of player config — it's set once, room-wide, via the admin page.)

Talks to the Worker only indirectly, through two local files living next to `boot.lua` (see "Game-side networking" above): an outbox `rmrsync_out.json` it writes, and an inbox `rmrsync_in.json` it reads. Each outbox document carries a per-session random id and a monotonically increasing sequence number, so the script only acts on the inbox response matching its current outstanding request (guards against a stale leftover response from a previous BizHawk run, or from before the relay page caught up).

Main loop, frame-gated at roughly the same cadence as the existing tracker's `cWaitFrames` pattern (~1.5s; safe to poll this often since it's pure local file I/O now, no network stutter):
1. Read any pending inbox response. If it matches the currently outstanding request: fold the result in (see epoch handling below), and if the mode includes items, clear the just-acknowledged batch of pending events.
2. If no request is currently outstanding, build and write a new outbox document: current local `checksSeen` bytes from RAM, the script's last-known `resetEpoch`, and (mode permitting) any newly-diffed item pickups since the last acknowledged batch.
3. Epoch handling, same semantics as before: if the inbox response's epoch is newer than what the script last knew, directly **overwrite** local `checksSeen` (both `sessionSave.checksSeen` and the current title's live RAM) with the server's merged bytes instead of the usual OR fold-back, so a reset actually sticks. Otherwise, fold back with OR as before — the same style as `updateSaveValue`'s `synchronize_or` in `boot.lua`.
4. If no relay page has picked up the outbox for several cycles (nothing answers), show a waiting message (via the existing `Text.out` helper) prompting the player to open `sync_relay.html`, and keep the request outstanding so the relay can still pick it up whenever it starts.

## Browser relay page (`tracker/sync_relay.html`)

A small page each player opens once, alongside the game — separate from the read-only, any-browser `event_feed.html` tracker so spectators never need folder-write permission. On first use, the player clicks a button to grant folder access (`showDirectoryPicker`) to the folder containing `boot.lua`/`share_info.lua`; the granted handle is persisted in IndexedDB so future page loads only need a permission re-confirmation, not a fresh folder pick. It needs no manual configuration of worker URL, room key, or player name — those are read straight out of the outbox file, which `share_info.lua` already populates from `share_config.txt` and the session's room key.

On a timer (~1.5s), it: reads the outbox file (tolerating a torn read from Lua's non-atomic write by treating a JSON-parse failure as "nothing new this tick"); if there's an unhandled request (by session+sequence), calls `POST /sync` and any batched `POST /event` calls against the Worker; and writes the result back to the inbox file using `createWritable()`, which is atomic-on-close in Chromium — so `share_info.lua` never observes a torn inbox file.

## Admin webpage (`admin/host_admin.html`)

A static local HTML page the session organizer opens (not a player-facing tool, and doesn't require BizHawk at all). Fields to create a room: room key (the Option string, copy-pasted from `spoiler.txt`), share mode, and an admin secret of the organizer's choosing (kept private — not shared with players or stream viewers, unlike the room key). Buttons for reset (requires the admin secret) and a live status view (polls `/admin/status`, no secret needed). Talks to the Worker via plain `fetch()`.

## Event-feed tracker (`tracker/event_feed.html`)

A new page, separate from the existing progress displayer. Opened locally with `?room=<param>` in the URL; connects via WebSocket. Reuses `progress_tracker_assets` icons and `RMR_progress_tracker_id_maps.js`'s item-id→icon mapping (icons are already color-coded per game, so no separate game badge is needed). Two display modes:
- Icon-only: `Player: [icon][icon][icon]` (one line per pickup batch, since a single boss kill can grant several items at once).
- Icon+text: `Player: [icon] LifeUp`.

## Repo layout

```
RMR_sync/
├── .gitignore              # ignores /ref
├── README.md
├── lua/
│   ├── share_info.lua      # companion script (identical for every player)
│   ├── file_relay.lua      # outbox/inbox file I/O + JSON (no BizHawk-specific deps)
│   ├── config.lua          # share_config.txt loader
│   └── json.lua            # JSON encode/decode
├── worker/                 # Cloudflare Worker + Durable Object source
│   ├── src/index.js
│   ├── wrangler.toml
│   └── README.md           # self-hosting/deploy guide (wrangler login/deploy)
├── admin/
│   └── host_admin.html     # organizer-only room create/reset/status page
├── tracker/
│   ├── event_feed.html     # read-only live event feed (any browser, no file access)
│   ├── event_feed.js
│   ├── sync_relay.html     # per-player relay: local files <-> Worker (Chromium only)
│   └── sync_relay.js
└── config/
    └── share_config.example.txt
```

## Open items to verify during implementation

- ~~Confirm `comm.httpPostAsync`/`httpGetAsync` (or equivalent) are actually available and reliable in the target BizHawk build/Faust core combination.~~ **Resolved by empirical spike, and it changed the design**: a live BizHawk 2.11 session confirmed `comm.httpGet`/`comm.httpPost` both block the emulation thread (audible stutter every call) and no async variant exists at all (confirmed via full `pairs(comm)` enumeration). Direct Lua HTTP was dropped entirely in favor of the local-file + browser-relay-page architecture described above — see "Game-side networking" under Key decisions.
- ~~Confirm current Cloudflare Durable Objects free-tier limits at time of deploy.~~ **Confirmed working** via a real deploy (`worker/` — throwaway test Worker + Durable Object, `rmr-share-test.append-rmr.workers.dev`): free plan requires the **SQLite-backed** storage backend, i.e. `new_sqlite_classes` in the `[[migrations]]` block of `wrangler.toml`, not the older `new_classes` (which needs a paid plan). Storage persistence across requests verified directly (a counter incremented correctly over repeated calls). One practical gotcha hit along the way, worth remembering for any future account: after claiming/changing your `*.workers.dev` account subdomain, HTTPS to it can fail with `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` for a few minutes while Cloudflare provisions the certificate for the new subdomain — this resolves on its own; no action needed beyond waiting.

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

- **Worker/DO**: local `wrangler dev` testing of `/admin/init`, `/admin/reset`, `/admin/status`, `/sync` (OR-merge correctness with concurrent-ish requests, and epoch-based rejection of stale clients), `/event`, CORS preflight handling on admin endpoints, the WebSocket upgrade + broadcast path, and alarm-based 24h expiry (triggered directly in tests rather than waiting 24h for real), before deploying.
- **Admin page**: create a room, confirm players' `/sync` calls fail clearly before creation and succeed after; confirm `/admin/reset` requires the correct admin secret and clears state without needing to touch any player's game.
- **Lua file-relay module**: standalone-Lua-interpreter tests (same approach as `json.lua`) for outbox writing and inbox reading, including torn/garbage-input tolerance (returns `nil`, doesn't crash).
- **Companion script logic**: standalone-Lua unit tests against fabricated inbox documents — epoch-ahead triggers overwrite not OR-fold, events clear only when acknowledged, a stale session/sequence in the inbox is ignored.
- **Browser relay page**: tested against the real deployed Worker (same approach as Tasks 9/11) — hand-write an outbox file into a scratch folder, confirm the page performs the correct `/sync`/`/event` calls and writes a correct inbox response; confirm the folder handle survives a page reload via IndexedDB.
- **Lua script + relay, live**: run two BizHawk instances (both running the identical script, different `player_name`), each with its own `sync_relay.html` tab, against the same seed. Confirm `checksSeen` converges identically on both sides after visiting different scouted locations, confirm they wait gracefully (and recover) if the relay page isn't open yet, and confirm that after an admin reset, a still-running player's `checksSeen` actually stays cleared (via the epoch mechanism) rather than bouncing back on its next sync. Confirm no audible stutter — the entire point of the file-relay pivot.
- **Tracker page**: open `event_feed.html?room=<param>` in a browser while both BizHawk instances play, confirm live event updates appear with correct icons in both display modes, and confirm a late-opened tracker backfills the existing log.
- **End-to-end**: two players, same seed, real playthrough for ~15–20 minutes, checking for dropped events, RAM corruption from bad writes, and reasonable end-to-end sync latency.
