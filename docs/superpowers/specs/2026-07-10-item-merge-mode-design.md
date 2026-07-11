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

## Addendum (2026-07-11): `itemMergeSiblings` deleted — replaced with a full-array, same-title, cross-player OR-merge

The `checksSeen+item+all` experiment above answered its own question: BizHawk
testing confirmed `itemMergeSiblings`'s "same numeric slot across all 3
titles" projection **does** corrupt state for non-whitelisted items. Picking
up one boss weapon in one title silently granted an unrelated key/weapon in
another title, because "same slot number" only actually means "the same
conceptual item" for the 7 whitelisted categories (`lifeUp`, `energyUp`,
`subTank`, `sigmaKey`, `finalWeapon`, `armor`, `upgradeItem`) — not for boss
weapons, keys, or any other stage-varied item, whose slot layout differs
per title. This wasn't a hypothetical: it was the exact failure mode this
spec's `checksSeen+item+all` addendum set out to test, and the test found it.
`itemMergeSiblings` has accordingly been deleted from
`worker/src/shareCategories.js` — there is no more cross-title sibling-id
projection anywhere in the system, in any mode.

**Replacement mechanism**: each Lua client now sends its own full 96-byte
`items` snapshot (`readItems()`, reading `addrItems` directly) on every
`/sync` call, alongside `checksSeen` — see `lua/share_info.lua`'s
`issueRequest()`, whose outgoing `sync` payload is now
`{ checksSeen = readChecksSeen(), items = readItems(), epoch = knownEpoch, shareFlags = shareFlags }`.
The Worker's `handleSync` (`worker/src/room.js`) OR-merges this into a
room-level `mergedItems` via a new `mergeIncomingItems(stored, incoming,
mode, shareFlags)` helper. This is a **same-title, cross-PLAYER** merge —
byte position `i` of one client's `items` array only ever OR-merges into byte
position `i` of the room's stored `mergedItems`; no bit is ever read from one
byte position and written to another, so there is no path left for a bit to
cross from one title's byte range into a different title's byte range. The
three-tier mode behavior is now entirely inside this one helper:
- `checksSeen` (items sharing disabled): `mergeIncomingItems` returns `stored`
  unchanged — the `items` field is still validated on every request, just
  never folded into `mergedItems`.
- `checksSeen+item`: bit-granular filtering, not byte-granular — for every
  id `0..767`, if that id's bit is set in the incoming snapshot and
  `shareCategoryForId(id)` (unchanged, still `worker/src/shareCategories.js`)
  returns a category that is `true` in the room's stored `shareFlags`, the
  bit is folded into `mergedItems` via the existing `setBit` helper
  (`worker/src/bits.js`). The code comments why this can't be byte-granular:
  `subTank`'s range (`0x24`-`0x27`) doesn't start on a byte boundary, so the
  byte holding subTank ids 36-39 also holds unrelated, unwhitelisted ids
  32-35 — merging the whole byte would incorrectly pull those in too.
- `checksSeen+item+all`: no filter at all — the entire incoming array
  OR-merges unconditionally via the existing `orMergeBytes` helper
  (`worker/src/bits.js`).

**`items` is now a required, epoch-gated `/sync` field.** `isValidItemsArray`
(new, `worker/src/validation.js`) validates it with the same 96-byte,
0-255-per-entry shape check `isValidChecksSeenArray` already used (both now
share a common `isValidByteArray(arr, length)` helper). `handleSync` rejects
the request with 400 if `items` is missing or malformed, exactly like
`checksSeen`. More importantly, a client reporting a stale (pre-reset) epoch
now has its contribution to *both* `checksSeen` and `mergedItems` discarded
by the same `body.epoch >= currentEpoch` gate — previously `mergedItems` had
**no** epoch protection at all, because it was populated purely server-side
from `/event` (which carried no epoch field). Since `items` is now
client-supplied on every `/sync`, it needed the same protection `checksSeen`
already had, and now gets it via the identical check.

**`handleEvent` no longer computes any merge.** Previously `handleEvent` was
responsible for OR-ing `itemMergeSiblings(id)` into `mergedItems` for
newly-accepted item ids; that entire block is gone. `handleEvent` now does
exactly one thing: duplicate-filtering (unchanged
`recentlyPostedItems`/`DUPLICATE_EVENT_WINDOW_MS` logic) and appending to/
broadcasting the `events` feed for the tracker's event-feed display. It is
fully decoupled from merging — merging now happens exclusively in
`handleSync`. The mode gate on `/event` (`mode !== "checksSeen+item" &&
mode !== "checksSeen+item+all"` → 403) is unchanged, since the event feed
display is still tier-gated the same way it always was.

**`worker/src/room.js`'s `handleInit`/`handleReset`** still initialize/reset
`mergedItems` to `new Array(96).fill(0)`, and `/admin/reset` still bumps
`resetEpoch` — unchanged from the original design, since `mergedItems`'s
shape and reset behavior didn't need to change, only how it gets populated.

**`lua/share_info.lua`'s `tryConsumeInbox`** is unchanged in structure:
`writeMergedItems(msg.sync.mergedItems, forceOverwrite)` still writes into
both `cpu[addrItems+i]` (immediate effect) and `sessionSave.items[i]`
(durable persistence, so a later unrelated title switch doesn't lose the
merge when `boot.lua` restores `addrItems` from `sessionSave.items`). What
changed is only what feeds it: `mergedItems` in the `/sync` response is now
computed by `handleSync`/`mergeIncomingItems` instead of accumulated by
`handleEvent`.

**Accepted tradeoff, explicitly weighed against the corruption above**: a
player who exclusively plays one title no longer automatically receives an
item that was only ever found in a title they've never touched, because
there is no more cross-title projection of any kind — a title's bits only
ever come from other players' own snapshots of *that same title's* byte
range. This is a deliberate, informed decision, not a bug: it was weighed
against `itemMergeSiblings`'s confirmed failure mode (silently granting
unrelated items across titles) and judged the correct tradeoff, since the
old mechanism's cross-title convenience was exactly what caused the
corruption in the first place. A future spec could reintroduce
same-conceptual-item sharing across titles for the 7 whitelisted categories
specifically (where "same slot" genuinely does mean "same item"), but that
is out of scope here.

**Verification**: `worker/test/room-sync.test.js` gained dedicated coverage
for the new mechanism: `checksSeen+item+all` OR-merging the full array
unconditionally across two different players; `checksSeen+item` merging
only whitelisted-category bits and leaving everything else untouched; the
bit-granularity boundary case itself (a fully-set byte 4, asserting only
bits 4-7/subTank fold in and bits 0-3/the unused gap do not); a disabled or
absent `shareFlags` entry blocking a merge; plain `checksSeen` mode never
merging even a fully-set incoming array; a stale-epoch `/sync` having its
`items` contribution discarded the same way `checksSeen`'s already was; a
missing or wrong-length `items` field being rejected with 400; and
`admin/status`'s `mergedItemsBitsSet` reflecting a merge performed via
`/sync`. `worker/test/room-event.test.js` gained regression tests confirming
`/event` no longer changes `mergedItems` at all, for both tiers. No
automated test exists for `lua/share_info.lua` itself (unchanged from the
original design — verified by syntax check and the existing
`share_logic_test.lua`/`file_relay_test.lua` suites, consistent with how
this file has always been verified). Manual BizHawk verification still
needed, matching this spec's original "Verification" section: two instances
in the same room, confirm a whitelisted-category pickup still reaches the
other player (now via `/sync` instead of `/event`), confirm a
non-whitelisted pickup under `checksSeen+item+all` reaches a player on the
*same* title but not a player who has never visited it, and confirm survival
across a title switch away and back.

## Addendum (2026-07-11): wire mode strings renamed to match `boot.lua`'s vocabulary

`checksSeen+item` (the whitelisted-category tier) is renamed to
**`checksSeen+shared`** — it names the thing the tier actually merges: the
ROM's own `shareLifeUp`/`shareSigmaKey`/etc. flags. `checksSeen+item+all`
(the unconditional tier) is renamed to **`checksSeen+items`** — matching
`sessionSave.items`/`addrItems`'s own naming directly, since "items" already
unambiguously means the whole array in `boot.lua`'s own vocabulary, making
the old "+all" suffix redundant. Nothing had shipped depending on the old
strings, so this was a clean rename across `VALID_MODES`, `room.js`'s mode
checks, `share_info.lua`'s `shareMode` comparisons, `host_admin.html`'s
option values, and every test referencing these strings by name — no
migration concern, unlike the earlier `checksSeen+items` (plural) →
`checksSeen+item` (singular) rename this same spec documented above, which
did have to account for an already-deployed mode gate. Display labels are
unchanged by this rename (still read "Share common Items"/"Share All
Items") — see `docs/superpowers/specs/2026-07-11-progress-mode-design.md`
for the upcoming "Seen"-based display rename, which is a separate, later
change.
