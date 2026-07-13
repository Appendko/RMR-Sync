# RMR Sync — Team Progress Tracker Design Spec

## Context

Today, "checks" (stage clears / boss defeats) are announced once, live, via
the scrolling `pages/tracker/event_feed.html` feed and then forgotten —
`worker/src/room.js`'s `events` list caps at `MAX_EVENTS = 200`, so on a long
session with many item pickups, an early boss-defeat event eventually rolls
off the buffer. There is no durable, at-a-glance "how far has the team
actually gotten" view — only a scrolling log.

The user wants a persistent, visual **team progress tracker** — in the same
grid style as `ref/RMR_progress_tracker_displayer_ver_js_20260126` (a
single-player local tool the user already built) — showing which bosses the
team has collectively defeated and which items the team has collectively
found, plus two flavor stats: total deaths and total IFG (Invincible Frame
Generator — an intentional soft-lock safety net; see
`ref/rmr_option.html`, fetched and saved this session, for the author's own
explanation) uses.

**Explicit constraint carried over from earlier this session's checks
design**: `sessionSave.checks` must never be written back into a player's
own game state from network data (`lua/share_info.lua`'s `checkForNewChecks`
comment explains why — `boot.lua`'s `synchronizeHintInfo()` reads
`sessionSave.checks` directly to advance hint pointers for titles NOT
currently active; writing a merged, cross-player array into it would make a
player's own hint pointer advance based on a teammate's progress in a title
they haven't personally touched). This feature **shares checks TO the
Durable Object** (already happens today, via `/event`) **but sends nothing
back down** — `share_info.lua` gets no new fields, no new reads-back, no
`writeChecks()`. The team-progress view is a pure spectator on top of data
that already flows one-way, uphill, through the existing wire protocol.

## Reference material inspected this session

- `ref/RMR_progress_tracker_displayer_ver_js_20260126/index.html` — a single
  85KB minified/bundled app. Its actual state shape (extracted via a Node
  `vm` probe, not guesswork) is, per title (`x1`/`x2`/`x3`): `bosses` (8
  Maverick portraits), `weapon` (8 weapon icons), `armor`/`armor_log` (4
  parts, locked vs. unlocked), `super` (final weapon), `sigma`/`hp`/`wp`/`e`
  (per-title tank/energy icons), `sigmaBosses` (a gif). Plus
  room-independent scalars: `deaths`, `ifg`. **Decision: rebuild fresh**,
  reusing this same asset set (already mirrored into
  `pages/tracker/assets/`) and the same visual arrangement, on top of our
  own `icon_map.js`/`check_lookup.js`/`check_id_map.js` id schemes — not by
  adapting the minified bundle itself (see "Alternatives considered").
- `ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/RMR_progress_tracker.lua`
  — the Lua counterpart that fed that bundle. Confirms two RAM addresses we
  reuse verbatim: `addrIFG = 0x7FFFAE` (single global counter, not
  per-title) and `addrTiwns = {0x7E1F80, 0x7E1FB3, 0x7E1FB4}` (per-title
  death counter, only meaningful for whichever title is currently active —
  this reference script has the same limitation, it never caches other
  titles' death counts while inactive).
- `ref/rmr_option.html` — the author's own option-generator page (fetched
  and saved to `ref/` this session). Confirms IFG's purpose in the author's
  own words: a deliberate safety net ("防止不可能状態" / preventing
  soft-locks), with a scoring penalty for 2+ uses. No death-tracking
  mentioned there at all — that address comes solely from the reference
  Lua script above.

## Goals

1. A durable, room-level "team progress" state: which event-check ids
   (boss defeats / stage clears / game-clears) has *any* player completed,
   ever — independent of the 200-event scrolling buffer.
2. Two durable, room-level running counts: total deaths, total IFG uses,
   summed across every report from every player.
3. A visual grid (matching `ref`'s layout/asset set) showing this state,
   viewable **with zero game connected** — just a Worker URL + room key.
4. No gameplay-affecting change whatsoever: `share_info.lua`'s existing
   local-only `sessionSave.checks` handling is untouched.

## Non-goals

- Full 96-byte/768-bit check-location merging (every randomized pickup
  spot). Confirmed out of scope: `ref`'s own tool never modeled individual
  item-location checks, only the ~49 event-check ids (boss/stage/game
  clears) — see "Key decisions" below for how that was confirmed.
- Per-title death/IFG breakdown. The reference tool and its Lua script both
  only ever expose one current scalar for each — matches the user's own
  framing ("sum them up whenever an event is reported").
- Changing anything about how the existing scrolling event feed
  (`event_feed.html`) itself renders. It's unaffected by this spec.

## Key decisions

### 1. Checks scope: event-subset only, no new Lua read, no new `/sync` field

`lua/share_info.lua`'s `checkForNewChecks()` already filters newly-acquired
check ids down to `ShareLogic.isEventCheckId(id)` before ever calling
`issueRequest()` — the ~49-id event subset is *already* the only thing that
reaches `/event`. Confirmed against `ref`'s own data model (see "Reference
material" above): boss/stage/game-clear state is exactly what it needed;
individual randomized-pickup locations were never part of its display.

This means **no Lua change is needed to get boss-defeat data to the DO at
all** — it already arrives, every time, via the existing `/event` POST.
What's missing is *persistence*: today those ids only live in the 200-cap
`events` array. The fix is entirely server-side.

### 2. New DO state: `teamChecks` (persistent, OR-merge, mirrors `mergedItems`)

`worker/src/room.js`'s `handleEvent` gains a new persisted array
`teamChecks` (same 96-byte/bit-per-id shape as `checksSeen`/`mergedItems`).
Every time `newChecks.length > 0` (i.e. the existing dedup-filtered new-ids
branch), OR-merge those ids into `teamChecks` via the existing `setBit`
helper (`worker/src/bits.js`), in addition to (not instead of) pushing to
the `events` log as today. Exposed as a plain array of set ids (or the raw
byte array — implementation's choice) via the WebSocket `init` message and
every subsequent `event` broadcast (see decision 4).

Room lifecycle: `teamChecks` gets initialized to a zero array in
`handleInit`, reset to zero in `handleReset`, and wiped in `handleDelete`'s
`storage.deleteAll()` — identical treatment to `checksSeen`/`mergedItems`.

`mergedItems` is already exactly this same kind of durable, OR-merged,
never-capped state for items — it just isn't currently exposed over the
WebSocket (only its *count* is, via `/admin/status`). Expose the raw array
there too (see decision 4) rather than inventing a parallel mechanism.

### 3. Deaths/IFG: dedicated additive fields, NOT reusing the checks-id mechanism

`handleEvent`'s duplicate-suppression (`recentlyPosted`, keyed
`` `${player}::${kind}::${id}` ``, 15-second window) assumes a given
`{player, kind, id}` fires once and then goes quiet for a while — correct
for checks (one-time completions) and items (one-time pickups), **wrong**
for deaths/IFG, which can legitimately repeat within seconds (dying twice
in a row). Reusing a synthetic check id for these would risk a real second
death being silently swallowed as a "duplicate."

Instead: two new optional fields on the `/event` POST body,
`body.deathDelta` and `body.ifgDelta` (positive integers, small upper bound
— e.g. 1-50 per report, enough headroom for a multi-minute-old event batch
without allowing garbage). `worker/src/validation.js`'s `validateEventBody`
gains an `isValidPositiveDelta` check for both (`undefined` also valid —
older/unaffected clients omit them) and its "must include at least one of"
guard widens to accept `items`, `checks`, `deathDelta`, or `ifgDelta`. These
never pass through `dedupeNew`/`recentlyPosted` at all — every report is
real and additive by construction (the Lua side only reports a positive
delta when it observes the counter increase), so there's nothing to
de-duplicate.

`handleEvent` adds each delta directly onto persisted running totals
`totalDeaths`/`totalIfgUses` (plain integers, `0` initial, same
init/reset/delete lifecycle as `teamChecks`), and still pushes an `event`
entry (carrying `deathDelta`/`ifgDelta`) to the `events` log so the
existing scrolling feed can render the flavor-text line for it (decision
6) — this is the *only* place event-feed rendering needs new code, since
the wire shape (an `event` object on the same broadcast channel) is
unchanged.

**Known recurring failure mode in this exact codebase, guard against it
explicitly**: `pages/tracker/sync_relay.js`'s `/event` forwarding call
(currently `body: JSON.stringify({ player: req.player, game: ev.game,
items: ev.items, checks: ev.checks, gameClearTime: ev.gameClearTime })`)
has already twice silently dropped a real field this session (once for
`checks`, once for `gameClearTime`) because it forwards an explicit
field list rather than the whole `ev` object, with no visible error since
only the top-level `/sync` error surfaces in the status line. This spec's
`deathDelta`/`ifgDelta` fields **must** be added to that same object
literal, or every death/IFG report will reach `sync_relay.js` (Lua's
`issueRequest()` writes them into the outbox fine) and then vanish there,
never reaching `/event` at all. The implementation plan should either add
both fields explicitly, or — better, and worth considering precisely
because this has now broken twice the same way — forward `...ev` (or
`items: ev.items, checks: ev.checks, gameClearTime: ev.gameClearTime,
deathDelta: ev.deathDelta, ifgDelta: ev.ifgDelta` fully enumerated) so a
*future* new field can't repeat this a third time.

### 4. WebSocket protocol extension (drives the new page; no polling)

`worker/src/room.js`'s `handleWebSocket` currently sends
`{type: "init", mode, backlog, shareFlags}` on connect, and `broadcast`s
`{type: "event", event}` on every new `/event`. Both extend:

- `init` also carries `teamChecks` (array), `mergedItems` (array — promoted
  from count-only), `totalDeaths`, `totalIfgUses`.
- The `broadcast` call inside `handleEvent` includes the same four fields
  alongside `event`, so every connected client (the existing
  `event_feed.html` *and* the new progress panel) always has the current
  full state without needing to reconstruct it from incremental deltas.
- `handleSync` also needs a `broadcast` call when `mergedItems` actually
  changes (today it never broadcasts anything) — otherwise item pickups
  merged via `/sync` would never live-update the progress panel, only
  boss-defeat events would.

This reuses the *existing* `/room/<key>/ws` endpoint verbatim — same origin
`event_feed.html` already connects to. No new endpoint, no polling.

### 5. `share_info.lua`: two new RAM reads, both report-only

New constants (placed alongside the existing `addrItems`/`addrChecks`/
`addrMultiworldInfo` block):

```lua
local addrIFG = 0x7FFFAE
local addrDeathByTitle = { 0x7E1F80, 0x7E1FB3, 0x7E1FB4 }
```

New state, alongside the existing `previousChecks`/`previousGameClear`:

```lua
local previousIfg = nil
local previousDeathByTitle = { nil, nil, nil }
```

New functions, structural siblings of `checkForNewGameClear()`:

```lua
local function checkForNewIfg()
    local ifgNow = cpu[addrIFG]
    if previousIfg and ifgNow > previousIfg then
        table.insert(pendingEvents, { game = currentTitle(), ifgDelta = ifgNow - previousIfg })
        issueRequest()
    end
    previousIfg = ifgNow
end

local function checkForNewDeaths()
    local title = currentTitle()
    local deathsNow = cpu[addrDeathByTitle[title]]
    local previous = previousDeathByTitle[title]
    if previous and deathsNow > previous then
        table.insert(pendingEvents, { game = title, deathDelta = deathsNow - previous })
        issueRequest()
    end
    previousDeathByTitle[title] = deathsNow
end
```

Both called unconditionally every poll cycle in the existing `while true`
loop, alongside `checkForNewChecks()`/`checkForNewGameClear()` — same
"cheap RAM read/diff, no gating needed" reasoning already established for
checks (these are monotonically-increasing counters, no "unstable
intermediate value" risk).

**Never read back**: no `msg.sync` field is added for either of these —
there is nothing analogous to `writeMergedItems`/`writeChecksSeen` for
death/IFG counts, so there's no code path that could write them back into
game state even by mistake.

### 6. Event feed: new flavor-text lines (reusing the existing `event` shape)

`pages/tracker/event_feed.js`'s `renderEntry` gains handling for
`event.deathDelta`/`event.ifgDelta` (siblings of its existing
`event.items`/`event.checks` handling), rendering one line per delta using
new small per-language lookup tables (siblings of `check_names_en.js` etc.,
not reusing `CHECK_ID_MAP` since these aren't check ids):

`pages/tracker/misc_event_names_en.js` / `_ja.js` / `_zhtw.js`:

```js
// en
const MISC_EVENT_NAMES_EN = {
  death: "{name} met an unfortunate end, exploding into bubbles. Your deeds of valor will be remembered.",
  ifgUsed: "{name} secretly used IFG. They weren't like this before — must be a bad influence.",
};
```

```js
// ja
const MISC_EVENT_NAMES_JA = {
  death: "{name}は無念にも泡となって消えた。君の勇敢な行為は語り継がれるだろう。",
  ifgUsed: "{name}はこっそりIFGを使った。前はこんな子じゃなかったのに…悪い友達でもできたのかもしれない。",
};
```

```js
// zh-TW
const MISC_EVENT_NAMES_ZHTW = {
  death: "{name} 不幸的變成了泡泡，您的英勇長存人心。",
  ifgUsed: "{name} 偷偷地用了IFG，他以前不是這樣的，一定是交了壞朋友。",
};
```

`{name}` substitutes `event.player` (matching the existing `{time}`
substitution pattern for the id-903 game-clear line). A `deathDelta`/
`ifgDelta` greater than 1 (multiple increments between polls) renders the
same line once per unit of delta — matching how a multi-id `checks`/`items`
batch already renders one line per id, not a single "x3" summary.

### 7. New page: `sync_relay.html` becomes dual-purpose

Confirmed by the user: rather than a separate tab/page, fold the
team-progress panel directly into `pages/tracker/sync_relay.html` — the
page every active player already has open (mandatory for the Lua
file-relay to function at all), and the natural place to check "how's the
team doing" without needing a second window.

- **New input fields** (Worker URL, room key) — persisted via
  `localStorage`, same pattern as `host_admin.html`'s recently-added
  settings persistence (`WORKER_URL_STORAGE_KEY`/`ROOM_KEY_STORAGE_KEY`
  equivalents, new keys e.g. `rmrSyncRelayWorkerUrl`/`rmrSyncRelayRoomKey`
  to avoid collision with the admin page's own keys). These are
  independent of the folder-picker/outbox mechanism — a user can view
  progress with **no folder ever connected**, just these two fields filled
  in.
- **When a folder *is* connected**, auto-fill these two fields from the
  first successfully-read outbox request (`req.workerUrl`, `req.roomKey`
  — already present in `sync_relay.js`'s `tick()`) if they're currently
  empty, without overwriting a manually-entered value the user already
  typed (covers "I want to spectate a different room than the one my
  outbox points at," an edge case but a free one given the fields are
  already independent).
- **New WebSocket connection**, opened whenever both fields are non-empty,
  to `${workerUrl}/room/${roomKey}/ws` — same URL shape as
  `event_feed.js`'s `toWebSocketUrl`. Handles `init`/`event` messages to
  populate/update `teamChecks`, `mergedItems`, `totalDeaths`,
  `totalIfgUses`, independent of and in parallel with the existing 400ms
  outbox-polling `setInterval` (decision 8 covers why these two paths
  never need to share data).
- **New grid rendering**, reusing `check_lookup.js`'s
  `CHECK_BOSS_PORTRAIT_FILE` (boss portraits, keyed by the same event-check
  ids now living in `teamChecks`) and `icon_map.js`'s `getIconInfoForId`/
  `ITEM_ID_MAP` (weapon/armor/tank icons, keyed by `mergedItems` bit
  positions) — greyscale/dim styling for "not yet done," full color for
  "done," matching `ref`'s own `grayscale` CSS-class toggle approach.
  Layout: one panel per title (X1/X2/X3), each showing its title icon, 8
  boss portraits, 8 weapon icons, 4 armor-piece icons, its super-weapon
  icon (if applicable), tank counts, and sigma-stage row — plus one global
  row for deaths/IFG counts. `sync_relay.html` needs new `<script src>`
  tags for `item_id_map.js`, `item_names_{en,ja,zhtw}.js`, `icon_map.js`,
  `check_id_map.js`, `check_names_{en,ja,zhtw}.js`, `check_lookup.js` (same
  set `event_feed.html` already loads).

### 8. No data ever flows from the new WebSocket into the outbox/inbox files

`sync_relay.js`'s `writeInbox` currently forwards the *entire* `/sync` HTTP
response into the file Lua reads (`resp.sync = syncData`). That code path
is untouched by this spec — `teamChecks`/`totalDeaths`/`totalIfgUses` are
carried *only* over the new WebSocket connection this page separately
opens for its own on-page rendering, never touching `/sync`'s HTTP
response body or the inbox file at all. This makes "never reaches
BizHawk" structural (there is no field to accidentally forward), not just
"Lua happens to ignore an extra key."

## Alternatives considered

**Adapting `ref`'s bundled `index.html` directly** (feeding
`window.RMRPTJS.progress` from our WebSocket data instead of a
locally-dumped file) was considered and rejected: that bundle's internal
id/offset assumptions (`cChecksPerTitle = 0x20`, its own items layout) would
need to be reverse-matched exactly against our own `teamChecks`/
`mergedItems` bit numbering, with no source-level guarantee the two stay in
sync as either evolves — and it's a single-player tool, not built to model
"aggregate across many players" in the first place. Rebuilding on our own,
already-integrated `icon_map.js`/`check_lookup.js`/`check_id_map.js` keeps
one consistent id scheme across the whole project.

## Open items for the implementation plan

- Exact pixel/CSS layout of the grid (row heights, icon sizing, greyscale
  filter implementation) — visual arrangement should match `ref`, exact
  styling is an implementation-plan-level detail, not a design constraint.
- Exact upper bound for `isValidPositiveDelta` (spec suggests 1-50; the
  plan should pick a concrete value and document why).
- Whether `teamChecks`/`mergedItems` are broadcast as raw byte arrays or
  as arrays of set ids over the WebSocket (either works; plan should pick
  one and use it consistently for both `init` and `event` broadcasts).
