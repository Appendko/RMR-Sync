# RMR Sync — `checksSeen+item` Mode Design Spec

## Context

`docs/superpowers/specs/2026-07-04-share-information-mod-design.md` shipped
two room modes: `checksSeen` (OR-merged scouted/hinted intel) and
`checksSeen+items` (adds a live, display-only event feed of pickups — no
gameplay effect). Both remain unchanged in spirit, but this spec renames
the second to `checksSeen+item` (singular) purely because the event feed no
longer needs its own separate mention — `tracker/sync_relay.html`'s WebRTC
keep-alive (shipped since) made it reliable enough to just always be there.

This spec adds a **new**, higher tier: **`checksSeen+item`** — real
cross-player item merging. When a player picks up an item in a category
their seed configured as shared (`shareLifeUp`/`shareSigmaKey`/etc., already
read and synced per the `[*]`-tag work), every other player in the room
receives that same item in their own game too, not just a log entry about
it.

**Confirmed mechanism** (verified live in BizHawk by the user, not assumed):
directly setting a title's own item bit in WRAM (`cpu[addrItems+i]`) is
sufficient for the game to recognize the item as owned — no need to route
through `boot.lua`'s own `mergeItems`/`acquiredItemQueue` logic, which (on
inspection) turns out to only affect which HUD toast text is shown, not
actual item-granting.

**Deliberately excluded from this tier**: marking the corresponding "check"
(location) as complete. The user wants to test giving the item early while
the check (e.g., a boss fight) still has to be legitimately cleared — an
intentional experiment, not a stepping stone. A `checksSeen+item+check` tier
may follow depending on how that experiment plays out; it needs its own
follow-up spec and is out of scope here. (Simplification already identified
for when that happens: `checks` can be OR-merged via the exact same
mechanism as `checksSeen`/`mergedItems` below — no check→item mapping
needed, since checks and items would sync as two independent, generically
OR-merged arrays rather than one driving the other.)

## Key decisions

- **Mode string**: `"checksSeen+item"` (replaces `"checksSeen+items"` in
  `VALID_MODES` — see `worker/src/validation.js`). No *validation* migration
  needed: an existing room's stored `mode` is read from Durable Object
  storage and never re-validated against `VALID_MODES` after creation.
  **However**, `handleEvent`'s mode gate is an equality check
  (`mode !== "checksSeen+item"`), not a `VALID_MODES` lookup — a room still
  holding the pre-rename string `"checksSeen+items"` (trailing `s`) will
  fail that check and start rejecting `/event` with 403 after this ships
  (and correspondingly, `share_info.lua`'s own `checkForNewItems` gate goes
  dormant for that room too), even though `checksSeen` syncing keeps working
  fine via `/sync` (which doesn't gate on the exact mode string). In
  practice this only matters for a room actively straddling the deploy —
  rooms auto-expire after 24h of inactivity, and resetting/recreating a room
  with the new mode string clears it immediately. `checksSeen` (unchanged)
  and the future `checksSeen+item+check` are the only other values.
- **New room state: `mergedItems`** — a 96-byte array, identical shape to
  `checksSeen`, but modeled on `addrItems` (already a flat, all-3-titles-
  simultaneously region per `boot.lua`'s own layout) rather than
  `addrChecksSeen` (per-title, reused address) — so, unlike `checksSeen`,
  applying it needs no `currentTitle()`/`baseOffset` slicing at all: it's a
  straight, unconditional 96-byte OR-loop into `cpu[addrItems+i]`.
- **Category eligibility, computed server-side by numeric id range** — the
  Worker doesn't have access to `tracker/item_id_map.js`'s string codes (a
  browser-only file in a separate deployable), so `worker/src/room.js`
  cannot reuse `tracker/icon_map.js`'s `shareCategoryFor(code)` directly.
  Instead, a new small `worker/src/shareCategories.js` classifies a numeric
  item id by `id % 256` (the "altItemNo" boot.lua itself uses) falling into
  one of the same 7 ranges: `lifeUp` (0x00-0x0F), `energyUp` (0x10-0x1F),
  `subTank` (0x24-0x27), `sigmaKey` (0x40-0x4F), `finalWeapon` (0x50 exactly),
  `armor` (0x58-0x5F), `upgradeItem` (0x60-0x73) — same boundaries
  `tracker/icon_map.js`'s `shareCategoryFor` uses, just re-derived from the
  numeric id directly instead of the string code, so the Worker needs no
  copy of `ITEM_ID_MAP` at all. Anything outside these ranges (boss
  weapons/keys, stage-varied, Vava-family, Ride Armor, Zero parts, the
  ungated `ItLifeS`/`ItWeaponS`/`ItFullRecover`/`ItEmpty`) is never merged —
  same exclusions as the `[*]` tag work, for the same reason (`boot.lua`
  never actually shares those categories either).
- **Sibling-id math, no lookup table needed**: each title's own item block
  is exactly 256 ids wide (`0-255`, `256-511`, `512-767`), and per every
  example checked this session, "the same slot" in a different title is
  always the same offset within that block. So a merged id's siblings are
  simply `id % 256`, `(id % 256) + 256`, `(id % 256) + 512` — no per-item
  mapping table required.
- **Merge is gated by both room mode AND the seed's own `shareFlags`** — an
  item only merges if (a) the room's mode is `checksSeen+item`, and (b) that
  item's category is `true` in the room's stored `shareFlags` (read once
  from ROM by `lua/share_info.lua`, already wired end-to-end for the `[*]`
  tag). A `checksSeen+item` room on a seed with, say, `sigmaKey: false`
  simply never merges Sigma Keys — respects the seed's own configuration
  rather than overriding it.
- **`mergedItems` is protected across a reset, but not via the same
  mechanism as `checksSeen`** — the client never sends `mergedItems` (it's
  accumulated purely server-side from `/event`, which carries no epoch), so
  there's no "stale client's contribution gets discarded" step to mirror for
  it. Instead, protection is two-part: `/admin/reset` zeroes `mergedItems`
  and bumps `resetEpoch`, and `lua/share_info.lua`'s `forceOverwrite` (set
  when `checksSeen`'s epoch comparison detects a reset) also drives a direct
  overwrite of the client's local `mergedItems` application on its next
  sync — same trigger and same `forceOverwrite` flag as `checksSeen`, just
  not the same "discard a client's own contribution" step, since
  `mergedItems` never has one.
- **`lua/share_info.lua` writes the merge into both `cpu[addrItems+i]`
  (immediate effect) and `sessionSave.items[i]` (durable persistence)** —
  mirroring exactly what `writeChecksSeen` already does for
  `sessionSave.checksSeen`. This matters: without also updating
  `sessionSave.items`, a *later, unrelated* title switch would trigger
  `boot.lua`'s own `updateSaveValue`/`synchronize_or`, which restores
  `addrItems` from `sessionSave.items` — and since that table wouldn't yet
  reflect our merge, the bit could be lost on a subsequent switch even
  though OR-merge write-back would still be safe for the *immediate* case
  the user already tested. Both writes remove that risk.
- **No changes to what Lua sends** — `/event`'s existing body
  (`{player, game, items[]}`) already has everything the Worker needs to
  compute merges; only what the Worker stores/returns changes.
- **A merge landing locally surfaces through the existing event feed
  automatically, and this is intentional, not a bug to suppress** — once a
  merged bit lands in a player's own WRAM, their own `checkForNewItems()`
  will notice it as a newly-set bit (same as any real local pickup) and
  report it through the existing event pipeline. Showing "PlayerB: [icon]
  Sub Tank" the moment a merge arrives is good transparency, not noise.

## Backend changes (`worker/`)

**New file: `worker/src/shareCategories.js`**
```js
// Mirrors ref/aaa/boot.lua's own altItemNo range boundaries (the same ones
// tracker/icon_map.js's shareCategoryFor uses, re-derived here from the
// numeric id directly since the Worker has no access to the browser-only
// ITEM_ID_MAP string codes). Boss weapons/keys, stage-varied, Vava-family,
// Ride Armor, Zero parts, and the ungated recovery-item codes are
// deliberately excluded -- boot.lua never actually shares those either.
export function shareCategoryForId(id) {
  const altItemNo = id % 256;
  if (altItemNo <= 0x0f) return "lifeUp";
  if (altItemNo <= 0x1f) return "energyUp";
  if (altItemNo >= 0x24 && altItemNo <= 0x27) return "subTank";
  if (altItemNo >= 0x40 && altItemNo <= 0x4f) return "sigmaKey";
  if (altItemNo === 0x50) return "finalWeapon";
  if (altItemNo >= 0x58 && altItemNo <= 0x5f) return "armor";
  if (altItemNo >= 0x60 && altItemNo <= 0x73) return "upgradeItem";
  return null;
}

// The three sibling ids representing "the same slot" across all 3 titles.
export function itemMergeSiblings(id) {
  const slot = id % 256;
  return [slot, slot + 256, slot + 512];
}
```

**`worker/src/validation.js`**: `VALID_MODES` becomes
`["checksSeen", "checksSeen+item"]`. `isValidShareFlags` unchanged (same 7
category keys already match `shareCategoryForId`'s return values).

**`worker/src/room.js`**:
- `handleInit`/`handleReset`: also initialize/reset `mergedItems` to
  `new Array(96).fill(0)`, same as `checksSeen`.
- `handleEvent`: after the existing duplicate-event filtering, for each
  newly-accepted item id, if `mode === "checksSeen+item"` and
  `shareCategoryForId(id)` is a key that's `true` in the room's stored
  `shareFlags`, OR the three `itemMergeSiblings(id)` bits into
  `mergedItems` (same epoch-aware discard behavior as `checksSeen`'s
  `/sync` merge).
- `handleSync`: response also includes `mergedItems` (alongside `mode`,
  `checksSeen`, `epoch`, `shareFlags`).

No changes to the WS `/ws` endpoint or `init` message — `mergedItems` is
Lua/game-state, not an event-feed display concern.

## Companion Lua script (`lua/share_info.lua`)

New function, directly beside `writeChecksSeen`:
```lua
-- Unlike writeChecksSeen, no currentTitle()/baseOffset slicing is needed:
-- addrItems is already a flat, all-3-titles-simultaneously region (per
-- boot.lua's own "全タイトル分" comment), so this is a straight 96-byte
-- OR-loop. Written into both sessionSave.items (so a later, unrelated
-- title switch doesn't lose it when boot.lua restores addrItems from its
-- own sessionSave.items) and live RAM (immediate effect, confirmed
-- sufficient by direct BizHawk testing).
local function writeMergedItems(merged, forceOverwrite)
    for i = 0, 95 do
        if forceOverwrite then
            sessionSave.items[i] = merged[i + 1]
            cpu[addrItems + i] = merged[i + 1]
        else
            sessionSave.items[i] = (sessionSave.items[i] or 0) | merged[i + 1]
            cpu[addrItems + i] = cpu[addrItems + i] | merged[i + 1]
        end
    end
end
```

`tryConsumeInbox()` calls this the same way it already calls
`writeChecksSeen(msg.sync.checksSeen, forceOverwrite)`, using
`msg.sync.mergedItems`. No changes to `issueRequest()`'s outgoing payload —
Lua never needs to send `mergedItems`, only receive it.

## Not changing

- `tracker/event_feed.html`/`.js`/`icon_map.js` — the `[*]` tag and
  `shareCategoryFor` client-side logic already exist and are unaffected;
  merged items surface through the existing event pipeline automatically
  (see "a merge landing locally..." above).
- `admin/host_admin.html` — its mode picker just needs the new mode string
  available as an option; no new fields.
- No `checksSeen+item+check` work of any kind in this spec.

## Verification

- Extend `worker/test/validation.test.js` for the renamed `VALID_MODES`
  value and a new `shareCategories.test.js` asserting `shareCategoryForId`
  matches `tracker/icon_map.js`'s `shareCategoryFor` for every id in
  `tracker/item_id_map.js` (guards the two independent implementations
  against drifting apart).
- Extend `worker/test/room-event.test.js`/`room-sync.test.js` for: a
  shared-category pickup produces the correct 3 sibling bits in
  `mergedItems`; a non-shared-category pickup produces no change; a
  category disabled in `shareFlags` produces no change even in
  `checksSeen+item` mode; `/admin/reset` zeroes `mergedItems`; a stale-epoch
  sync's contribution to `mergedItems` is discarded like `checksSeen`'s is.
- No automated test exists for `lua/share_info.lua` itself (consistent with
  how this file has always been verified — manual/live BizHawk testing
  only). Manual verification: two BizHawk instances in the same room, mode
  `checksSeen+item`, a seed with at least one category shared; player A
  picks up a shared item; confirm player B's game grants it (pause menu/
  usability, not just the event feed) within one `/sync` cycle, and that it
  survives player B switching titles away and back.

## Addendum (2026-07-11): `checksSeen+item+all` mode

Live-testing `checksSeen+item` confirmed the design works as intended —
`shareCategoryForId`'s 7-category whitelist is exactly what `tracker/icon_map.js`'s
`[*]` tag already marks as "shared" (see `gameTagFor`), so this mode is
renamed at the display layer only (admin dropdown label
"checksSeen + Share common Items"; the internal mode string, tests, and
Worker logic are unchanged) to make that scope explicit ahead of a second
tier.

**New mode `checksSeen+item+all`**: the same OR-merge mechanism as
`checksSeen+item`, but `handleEvent` skips the `shareCategoryForId`/
`shareFlags` gate entirely — every newly-accepted item id merges its 3
sibling ids unconditionally, including ranges the 7-category whitelist
deliberately excludes (boss weapons, keys, stage-varied pickups, Vava-family,
Ride Armor, Zero parts). This is an explicit, requested experiment: those
ranges are excluded from `checksSeen+item` because "same slot number" isn't
guaranteed to mean "same item" across X1/X2/X3 for them (each game's boss
roster/key layout differs), so a merge can hand a player a bit belonging to
an unrelated item in their own game. Consistent with the project's own
established stance from the original subtank test ("take the item twice
shouldn't be a problem"), the intent is to empirically test whether that
mismatch causes any real in-game problem, not to assume it's safe upfront.

**Changes**: `VALID_MODES` gains `"checksSeen+item+all"`
(`worker/src/validation.js`); `handleEvent`'s mode gate and merge block both
accept either `checksSeen+item` or `checksSeen+item+all`, branching only on
whether the per-item category gate applies (`worker/src/room.js`);
`lua/share_info.lua`'s `checkForNewItems` gate accepts either mode string;
`admin/host_admin.html` gets a new dropdown option. No changes to
`mergedItems`'s shape, reset/epoch protection, or `writeMergedItems` — those
are mode-agnostic and already handle whatever bits `handleEvent` decides to
set.

**Verification**: extended `worker/test/room-event.test.js` with a
`checksSeen+item+all`-mode describe block confirming (a) a no-category item
merges its 3 sibling bits with no `shareFlags` stored at all, and (b) a
whitelisted-category item still merges the same as under `checksSeen+item`.
Manual BizHawk verification for this tier specifically: pick up a
non-whitelisted item (e.g. a boss weapon) in one instance under
`checksSeen+item+all` and confirm what actually happens in the other
instance's game — this is the open experimental question, not an assumed-safe
mechanism.
