# RMR Sync — `checksSeen+items+checks` ("Seen + All Items + Progress") Mode Design Spec

## Context

`docs/superpowers/specs/2026-07-10-item-merge-mode-design.md` (and its two
addenda) shipped three room modes: `checksSeen` (scouted/hinted intel only),
`checksSeen+shared` (adds cross-player merging of the 7 whitelisted item
categories), and `checksSeen+items` (merges every item unconditionally,
cross-player, same-title — the mechanism that replaced the original
`itemMergeSiblings` after it was confirmed to corrupt non-whitelisted items
across titles).

That spec explicitly deferred a further tier: "A `checksSeen+item+check`
tier may follow depending on how [giving an item without its check] plays
out... `checks` can be OR-merged via the exact same mechanism as
`checksSeen`/`mergedItems` — no check→item mapping needed, since checks and
items would sync as two independent, generically OR-merged arrays rather
than one driving the other." That experiment is done — the mechanism works,
and it's time to build the deferred tier.

This spec adds a **fourth mode**, `checksSeen+items+checks`, stacking only
on top of `checksSeen+items` (not `checksSeen+shared`): in addition to
merging every item, it also merges every player's real **check**
completion (`addrChecks`/`sessionSave.checks` — actual game progress, e.g.
"defeated this boss," as opposed to `checksSeen`, which is just
scouted/hinted visibility) across players, same-title, using the identical
mechanism `checksSeen` already uses. Two related pieces of scope ride along
with it: a minimal (unlocalized) event-feed entry for check completions,
and authoring tooling to eventually build a fully localized display (a
separate follow-up spec, not this one).

**User-facing rename, this spec only, display text only**: internal mode
strings are unchanged everywhere except the one new addition
(`checksSeen+items+checks`). But the raw strings have never meant
anything to a player who hasn't read `boot.lua` — `tracker/event_feed.js`'s
connection status line prints `mode: ${data.mode}` verbatim
(`event_feed.js:327`), so a regular player currently sees a bare
`checksSeen+shared` there. This spec adds a display-only friendly-name lookup
used at that one call site (and updates `admin/host_admin.html`'s already
similarly-relabeled dropdown text) — the **wire values are not renamed**,
only what a human reads:

| Wire value | Displayed as |
|---|---|
| `checksSeen` | "Seen" |
| `checksSeen+shared` | "Seen + Common Items" |
| `checksSeen+items` | "Seen + All Items" |
| `checksSeen+items+checks` | "Seen + All Items + Progress" |

## Key decisions

- **`checks` is structurally identical to `checksSeen`, not to `items`.**
  Contrary to an earlier assumption in this session, `cChecksPerTitle =
  0x20` is 32 **bytes** (256 bits) per title, not 32 checks — the same
  256-id-per-title space `items` already uses. But unlike `addrItems`
  (flat, all 3 titles resident in WRAM simultaneously), `addrChecks` is a
  32-byte **window**, reused per active title, exactly like
  `addrChecksSeen` — meaning `checks` needs the same
  `currentTitle()`/`baseOffset` slicing `writeChecksSeen` already does, not
  `mergedItems`'s simpler flat 96-byte OR-loop.
- **`sessionSave.checks` already exists and is already maintained by
  `boot.lua`.** `updateSaveValue`'s existing per-title loop
  (`ref/multiworld/boot.lua`) already calls
  `synchronize_or(addrChecks+i,"checks",offset)` alongside the
  `checksSeen` equivalent — this project's own multiplayer layer has never
  touched it before, but the data is already there, correctly maintained,
  with no new game-side plumbing required. `readChecks()`/`writeChecks()`
  in `lua/share_info.lua` are near-verbatim copies of
  `readChecksSeen()`/`writeChecksSeen()`, swapping `checksSeen` for
  `checks` and `addrChecksSeen` (`0x7FFF80`) for `addrChecks` (`0x7FFF60`,
  a new constant needed in `share_info.lua` — currently only
  `addrChecksSeen`/`addrItems` are declared there).
- **New room state: `checks`** (96-byte array, same shape as `checksSeen`).
  `handleInit`/`handleReset` initialize/reset it to `new Array(96).fill(0)`,
  same as the other two arrays. A new `isValidChecksArray` validator
  (`worker/src/validation.js`) is a thin wrapper over the existing
  `isValidByteArray` helper, same as `isValidChecksSeenArray`/
  `isValidItemsArray`.
- **`checks` is required on every `/sync` call, same as `items`** — not
  optional, regardless of mode (a plain `checksSeen` room still validates
  it, just never folds it in), for the same reason `items` was made
  required: one validation code path, no mode-conditional wire shape.
- **`checks` only merges in `checksSeen+items+checks` mode, unconditionally
  (no category filter)** — checks aren't item-categorized at all (they're
  a much broader "any progress location" concept: "beat a boss, get an
  item, finish an intro stage"), so there's no equivalent of `shareFlags`
  gating for them. This mirrors `checksSeen+items`'s philosophy: the
  tier that shares everything, shares everything. Same epoch-gated
  stale-contribution discard as `checksSeen`/`items` (the identical
  `body.epoch >= currentEpoch` block in `handleSync`, extended to also
  fold `checks`).
- **The merge-echo and startup-burst fixes just shipped for items apply
  identically to checks.** A new `checkForNewChecks()` in
  `lua/share_info.lua` mirrors `checkForNewItems()`: diffs a new
  `previousChecks` baseline against a fresh `readChecks()`, gated to fire
  only in `checksSeen+items+checks` mode, filtered through the existing
  `ShareLogic.shouldReportAcquired(count, threshold)` (reusing
  `cInitBurstThreshold`, unless live testing shows checks need their own
  separate threshold constant — start shared, split later if needed). And
  in `tryConsumeInbox()`, right after `writeChecks(msg.sync.checks,
  forceOverwrite)`, `previousChecks` gets resynced to a fresh
  `readChecks()`, exactly like the just-shipped `previousItems` fix for
  items — so a merged check landing on a player's own game is never
  mistaken for that player's own completion.
- **`/event`'s body gains an optional `checks: number[]` field, alongside
  the existing `items`.** `checkForNewItems()` and `checkForNewChecks()`
  each independently push their own entry into `pendingEvents` when they
  find something (an entry typically carries just `items` or just
  `checks`, not necessarily both, though both fields being present on one
  entry is valid if both happened to fire the same cycle) —
  `validateEventBody` is relaxed to require at least one of `items`/
  `checks` to be a valid non-empty (1-20 entry) array of ids 0-767, rather
  than mandating `items` specifically. `/event`'s mode gate extends from
  `mode !== "checksSeen+shared" && mode !== "checksSeen+items"` to also
  allow `checksSeen+items+checks` through (a superset tier — it still
  wants item-pickup display too).
- **Duplicate-event-window keys must be namespaced by kind.** The
  existing `recentlyPostedItems` map keys on `` `${player}::${itemId}` ``
  — since check ids and item ids share the same 0-767 numeric space, an
  item id and an unrelated check id with the same number would collide
  under that scheme once checks start flowing through the same
  de-duplication path. Keys become `` `${player}::item::${id}` `` and
  `` `${player}::check::${id}` ``.
- **Check-completion display is deliberately minimal in this spec: the raw
  ported short code, no icon, no localization.** A full localized
  (en/ja/zh-TW) name+icon system matching items' quality bar is real,
  separate work — this spec only ports the existing reference id→code
  table so *something* readable shows up now, and builds the tooling
  needed to grow it into real names later.
- **Item-merging in the new mode must behave exactly like
  `checksSeen+items`.** `checksSeen+items+checks` is a fourth,
  independent string — it does not inherit `checksSeen+items`'s
  behavior automatically. Every existing conditional that currently
  branches on `mode === "checksSeen+items"` for *item* merging
  (`mergeIncomingItems` in `worker/src/room.js`, and any similar mode
  check in `lua/share_info.lua`'s item-side logic) must be updated to
  treat the new mode identically for items — only `checks` merging is
  actually new behavior; items merging in this tier is a verbatim
  continuation of the "all" tier's existing behavior, not a fresh
  implementation.

## Backend changes (`worker/`)

- `worker/src/validation.js`: `VALID_MODES` gains `"checksSeen+items+checks"`.
  New `isValidChecksArray` (mirrors `isValidItemsArray`). `validateEventBody`
  relaxed to accept `items` and/or `checks`.
- `worker/src/room.js`: new `checks` state, threaded through
  `handleInit`/`handleReset`/`handleSync` exactly parallel to `checksSeen`.
  `handleEvent`'s mode gate extended; duplicate-window keys namespaced by
  kind; event storage/broadcast carries whichever of `items`/`checks` was
  present.

## Companion Lua script (`lua/share_info.lua`)

New constant `addrChecks = 0x7FFF60`. New `readChecks()`/`writeChecks()`
(verbatim copies of the checksSeen equivalents). New `previousChecks` local
and `checkForNewChecks()` (verbatim copy of `checkForNewItems()`, gated to
`checksSeen+items+checks` only). `issueRequest()`'s outgoing payload gains
`checks = readChecks()`. `tryConsumeInbox()` applies `writeChecks` and
resyncs `previousChecks`, mirroring the items merge-echo fix.

## Event feed (`tracker/`)

`event_feed.js` recognizes an event's optional `checks` field, rendering
each id via the newly-ported `CHECK_ID_MAP`'s raw short code (no icon
lookup, no name-table lookup yet — that's the follow-up spec). A new
settings-panel checkbox pair, "Show item pickups" / "Show check
completions", persisted to `localStorage` the same way the existing
language preference already is (`event_feed.js`'s existing
`window.localStorage.setItem` pattern), filters which event lines render.
The status line at `event_feed.js:327` uses the new friendly-mode-name
lookup instead of printing `data.mode` raw. `admin/host_admin.html` gets a
4th `<option>` for the new mode, and its existing 3 option labels are
updated to the "Seen"-based wording (no functional change, matching the
precedent already set when `checksSeen + item` was relabeled to "Share
common Items").

## Check-name authoring tooling (new)

- **`tracker/check_id_map.js`** (new): mechanical port of the `checkId`
  object from `ref/RMR_progress_tracker_displayer_ver_js_20260126/
  progress_tracker_js/RMR_progress_tracker_id_maps.js` — same global
  0-766 index convention already used by `ITEM_ID_MAP`.
- **`tracker/check_names_en.js` / `_ja.js` / `_zhtw.js`** (new): scaffolding
  mirroring `item_names_en.js`'s shape (`{[id]: name}`). English gets a
  best-effort first pass (derived from MMX boss/stage knowledge applied to
  the ported short codes); Japanese and zh-TW start empty for the project
  owner's collaborators to fill in.
- **`tracker/check_audit.html` / `check_audit.js`** (new): mirrors
  `icon_audit.html`/`icon_audit.js`'s table-of-every-entry-with-fallback-
  highlighting pattern, but for checks instead of items — one row per
  `CHECK_ID_MAP` entry, showing the raw short code alongside each
  language's current name (or a highlighted "fallback" state when a
  language has no entry yet), so names can be authored/refined against a
  concrete reference page. No icon columns (checks have no sprite-sheet
  equivalent).

## Not changing

- `checksSeen+shared` and `checksSeen+items` are unaffected — `checks`
  merging is exclusive to the new 4th tier.
- No changes to `mergedItems`'s own mechanism, shape, or the item-merge
  fixes already shipped.
- No full localization or icon system for checks in this spec — the audit
  tooling above is scaffolding for that follow-up work, not the work
  itself.
- No `check→item` derivation logic of any kind (explicitly rejected during
  design — checks and items sync as two fully independent arrays).

## Verification

- Extend `worker/test/validation.test.js` for `isValidChecksArray` and the
  relaxed `validateEventBody`.
- Extend `worker/test/room-sync.test.js` for: `checks` OR-merging
  unconditionally in `checksSeen+items+checks` mode; `checks` validated
  but never folded in the other 3 modes; stale-epoch discard for `checks`
  matching `checksSeen`/`items`; reset zeroing `checks`.
- Extend `worker/test/room-event.test.js` for: a `checks`-only event body
  being accepted in the new mode; the namespaced duplicate-window keys not
  cross-colliding between an item id and a check id sharing the same
  number.
- No automated test for `lua/share_info.lua` itself, consistent with prior
  precedent — syntax check plus the existing `share_logic_test.lua`/
  `file_relay_test.lua` suites (extended for `shouldReportAcquired`-style
  coverage if `checkForNewChecks` introduces any new pure logic beyond what
  already exists).
- Manual BizHawk verification: two instances in the same room, mode `Seen +
  All Items + Progress`; Player A defeats a boss; confirm Player B's game
  marks the corresponding check complete (not just a merged item) within
  one `/sync` cycle, and that the event feed shows it as a distinct
  check-completion line (using the raw short code) that can be toggled off
  via the new checkbox without affecting item-pickup lines.
