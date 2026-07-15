# Tracker Row Reorder, Common Block, and Active-Title Detection

## Context

The tracker visual redesign (merged, `docs/superpowers/specs/2026-07-14-tracker-visual-redesign-design.md`)
gave each title panel a heading (title icon + "Rockman X{n}") and 5 rows of
icons/gauges. This follow-up does three things:

1. **Reorders icons so the heading becomes unnecessary.** The game-clear
   check icon (900/901/902) already renders the exact same
   `title_x{1,2,3}.ico` logo the heading's own title icon uses (confirmed:
   `pages/tracker/check_lookup.js`'s `CHECK_BOSS_PORTRAIT_FILE` maps
   `900/901/902` to `assets/title_x{1,2,3}.ico` directly, not a boss
   portrait). Moving it to the first icon of row 1 means the panel
   identifies itself without a separate heading.
2. **Adds a "Common" block** for item categories the seed's own
   `boot.lua` has configured as shared across all 3 titles (already
   computed by `lua/share_info.lua`'s `readShareFlags()`, already sent to
   the Worker in every `/sync` call, already reaching the browser in the
   WebSocket `init` message -- just never captured client-side until now).
   When a category is shared, showing it 3 times (once per title, all
   reading the same combined pool) is redundant and confusing; showing it
   once in a dedicated block is clearer.
3. **Detects which titles this seed actually randomizes**, hiding a
   title's entire panel when it isn't part of the seed. `lua/share_info.lua`
   already computes this locally (`readRandomizedGames()`, used today only
   for this project's own all-clear check logic) but never sends it
   anywhere. This is the one piece that needs new plumbing across all 3
   layers (Lua, Worker, client) rather than being a client-only change.

All three were confirmed via `AskUserQuestion` before this spec was written:
super weapon stays in row 3 (ordered super-weapon, then intro, then sigma
-fortress checks); all 4 gauge-style categories (sigma-key, life-up,
energy-up, subtank) get the shared/Common treatment, not just the 3 named
in the original ask; buster/charge upgrade tiers always stay per-game
regardless of `shareFlags.upgradeItem`; the active-title detection is
in scope now, not deferred.

The DSEG7 Classic Italic font swap (self-hosted, replacing the earlier
temporary MuzaiPixel CDN dependency) and the italic font choice itself were
handled as a separate, already-committed change and are not part of this
spec.

## Design

### 1. Row reorder + heading removal

Per title panel, `renderProgressGrid()`'s row construction becomes:

- **Row 1:** `gameClearCheckId` icon, then the 8 `bossCheckIds` (9 cells).
  The opening check icon (previously first here) moves to row 3.
- **Row 2:** armor overlay, then the 8 `weaponIds` (9 cells) -- unchanged.
- **Row 3:** `superWeaponId` icon, then `openingCheckId` icon, then the
  `sigmaCheckIds` (count varies 3-6 cells by title, as today).
- **Row 4 (gauges):** sigma-key, life-up, energy-up, subtank gauges --
  each omitted when its category is shared this seed (see section 2) --
  then the 5 buster-tier gauges (always shown, never affected by sharing).
- **Row 5:** X2's `zeroIds` / X3's `rideArmorIds`+`subbossCheckIds`,
  title-conditional -- unchanged.

The per-title `<h3>` heading (title icon + "Rockman X{n}" text) is removed
entirely. `layout.titleIcon` becomes unused by `renderProgressGrid()` as a
result -- kept in `team_progress_layout.js` regardless, since nothing else
in this spec needs it removed and it costs nothing to leave.

### 2. Shared-category consolidation + Common block

`shareFlags` (an object like `{lifeUp: true, energyUp: false, ...}`,
already defined in `pages/tracker/icon_map.js`'s `shareCategoryFor`
category names: `lifeUp`, `energyUp`, `subTank`, `sigmaKey`, `armor`,
`finalWeapon`, `upgradeItem`) is already sent by `lua/share_info.lua` in
every `/sync` call's body (`sync = { ..., shareFlags = shareFlags }`,
`lua/share_info.lua:351`) and already included in the WebSocket `init`
message (`worker/src/room.js:380`) -- `pages/tracker/sync_relay.js` just
never captured it. Fix: add `let shareFlags = {};` (module-level, default
empty so nothing is treated as shared until real data arrives) and in
`applyProgressState`, `if (msg.shareFlags !== undefined) shareFlags =
msg.shareFlags;`.

Each of the 4 relevant entries in every title's `gauges` array (added in
the original redesign) gets a new `category` field tagging which
`shareFlags` key controls it. The 5 buster-tier entries get no `category`
(`undefined` -- they never hide):

```js
{ file: "assets/sigma.png", label: "Sigma keys collected", ids: [...], category: "sigmaKey" },
{ file: "assets/heart.png", label: "Life-up upgrades", ids: [...], category: "lifeUp" },
{ file: "assets/energy.png", label: "Energy-up upgrades", ids: [...], category: "energyUp" },
{ file: "assets/etank.png", label: "Subtanks collected", ids: [...], category: "subTank" },
{ file: "assets/b.png", label: "Buster ammo capacity", ids: [...] },
{ file: "assets/ba.png", label: "Buster attack power", ids: [...] },
{ file: "assets/br.png", label: "Buster fire rate", ids: [...] },
{ file: "assets/bd.png", label: "Dash shot capacity", ids: [...] },
{ file: "assets/bc.png", label: "Charge speed", ids: [...] },
```

When building a title's gauge row, skip any gauge whose `category` is set
and `shareFlags[gauge.category]` is true:

```js
for (const gauge of layout.gauges) {
  if (gauge.category && shareFlags[gauge.category]) continue; // shown once in Common instead
  gaugeRow.appendChild(renderGaugeCell(gauge));
}
```

**Common block** renders once, after all 3 title panels (in the same
position the old standalone deaths/IFG row occupied). It reuses
`.title-panel`/`.icon-grid`/`.gauge-cell` -- same border, same icon
sizing as every game panel, giving it "a frame" and visual consistency.
Its first icon is `ALL_CLEAR_CHECK_ID` (903, `assets/title_x123.ico`,
boolean via `isTeamCheckDone`) -- the same "icon replaces heading" trick
as section 1, so no text label is needed here either. Then, for each of
the 4 shareable categories that's actually true this seed, one combined
gauge -- **ids drawn from the same 3 titles' existing `gauges` arrays**,
not a new duplicated list (this project's last final-review already
flagged one duplicate-source-of-truth bug from copy-pasting ids instead of
referencing them; this avoids repeating that mistake):

```js
const SHARED_GAUGE_DEFS = [
  { category: "sigmaKey", file: "assets/sigma.png", label: "Sigma keys collected (shared)" },
  { category: "lifeUp", file: "assets/heart.png", label: "Life-up upgrades (shared)" },
  { category: "energyUp", file: "assets/energy.png", label: "Energy-up upgrades (shared)" },
  { category: "subTank", file: "assets/etank.png", label: "Subtanks collected (shared)" },
];

function renderCommonBlock() {
  const section = document.createElement("div");
  section.className = "title-panel";
  const row = document.createElement("div");
  row.className = "icon-grid";
  const allClearInfo = getCheckIconInfoForId(ALL_CLEAR_CHECK_ID);
  row.appendChild(makeGridIcon(allClearInfo.file, allClearInfo.label, isTeamCheckDone(ALL_CLEAR_CHECK_ID)));
  for (const shared of SHARED_GAUGE_DEFS) {
    if (!shareFlags[shared.category]) continue;
    const ids = [1, 2, 3].flatMap((title) =>
      TEAM_PROGRESS_LAYOUT[title].gauges.find((g) => g.category === shared.category).ids
    );
    row.appendChild(renderGaugeCell({ file: shared.file, label: shared.label, ids }));
  }
  row.appendChild(makeGaugeIcon("assets/deaths.png", "Deaths", String(totalDeaths)));
  row.appendChild(makeGaugeIcon("assets/igf.png", "IFG uses", String(totalIfgUses)));
  section.appendChild(row);
  return section;
}
```

This replaces the old standalone `miscRow` construction at the end of
`renderProgressGrid()` (which built the all-clear icon + deaths + IFG
directly into a bare `.misc-row` div) -- deaths/IFG move into this new
bordered block instead. `.misc-row`'s CSS (the fixed 32px sizing override)
is no longer needed once deaths/IFG live in a normal `.icon-grid` row
sized like every other row; it can be removed.

**Explicitly not covered by the shared/Common treatment:** `armor` and
`finalWeapon` categories (per the confirmed answer, only the 4 gauge
-style categories are in scope) -- if a seed shares armor or the super
weapon across titles, each title's panel still shows its own copy,
unchanged. Not a bug, a deliberate scope line.

### 3. Active-title detection

`lua/share_info.lua` already computes `randomizedGames` (a 3-element table,
`{[1]=bool, [2]=bool, [3]=bool}`, via `readRandomizedGames()`, line 131) but
only uses it locally (the all-clear check at line 485). It's added to the
same `sync` table `issueRequest()` already builds:

```lua
sync = { checksSeen = readChecksSeen(), items = readItems(), epoch = knownEpoch, shareFlags = shareFlags, randomizedGames = randomizedGames },
```

Verified this serializes correctly: `lua/lib/json.lua`'s `encodeValue`
treats a table as a JSON array when every key is numeric and `n == #v`
(line 39-50) -- a 3-entry table keyed 1/2/3 with boolean values (never
`nil`, so no length-operator ambiguity) always encodes as a proper
3-element JSON array, e.g. `[true,false,true]`.

**`worker/src/validation.js`:** new `isValidRandomizedGames(value)` --
must be an array of exactly 3 booleans (mirroring `isValidShareFlags`'s
existing strictness style).

**`worker/src/room.js`:**
- `handleSync`: validate `body.randomizedGames` the same way
  `body.shareFlags` is validated (reject the whole request with 400 if
  present-but-invalid); if valid and present, `await
  this.state.storage.put("randomizedGames", body.randomizedGames)`; read
  back `const randomizedGames = (await
  this.state.storage.get("randomizedGames")) ?? [true, true, true]`
  (default: nothing hidden, matching the client's own safe default);
  include `randomizedGames` in the `/sync` JSON response alongside
  `shareFlags`.
- `admin/init` and `admin/reset`: reset stored `randomizedGames` back to
  `[true, true, true]`, mirroring the existing `shareFlags` reset
  (`await this.state.storage.put("shareFlags", {})`) at both call sites --
  a reset implies a new seed may be starting, so stale randomized-games
  data from the previous seed shouldn't linger.
- WS `init` message: add `randomizedGames` (read from storage the same
  way `shareFlags` already is at `worker/src/room.js:375`), included in the
  `server.send(...)` payload. **Not** added to the `"progress"` broadcast --
  static for the whole session, same reasoning `shareFlags` already uses
  for being init-only.

**`pages/tracker/sync_relay.js`:** `let randomizedGames = [true, true,
true];` (module-level, safe default -- nothing hides until real data
arrives, so older Lua/Worker versions that never send this field cause no
regression). In `applyProgressState`: `if (msg.randomizedGames !==
undefined) randomizedGames = msg.randomizedGames;`. In
`renderProgressGrid()`'s per-title loop: `if (randomizedGames[title - 1]
=== false) continue;` (skip the whole panel -- explicit `false` only, so a
missing/partial array never accidentally hides a title it shouldn't).

**Backward compatibility, both directions** (this project's established
concern, previously verified the same way for `shareFlags`/`teamChecks`):
an old Lua script talking to a new Worker never sends `randomizedGames` --
the Worker's `if (body.randomizedGames !== undefined)` guard skips storing
it, the stored default `[true, true, true]` keeps every title visible, no
behavior change. A new tracker page talking to an old Worker never
receives `randomizedGames` in `init` -- the client's own default
`[true, true, true]` applies, same result.

### 4. Bigger gauge text, no "/total"

`renderGaugeCell` changes from `` `${count}/${gauge.ids.length}` `` to
just `` `${count}` `` -- the reference tracker itself never showed a
denominator either; this project only added one during the original
redesign, and dropping it frees up room for a larger, more legible digit.
`.hud-number`'s `font-size` goes from `0.8em` to `1.6em` (a reasoned
starting point given a bare 1-2 digit count now has much more room in the
same cell than the old "13/14"-style string did -- flagged for a visual
check once rendered, same as every other font-size decision in this
project so far that couldn't be verified in a live browser).

## Files changed

- `lua/share_info.lua` -- add `randomizedGames` to the `sync` table in
  `issueRequest()`.
- `worker/src/validation.js` -- new `isValidRandomizedGames`.
- `worker/src/room.js` -- validate/store/return `randomizedGames` in
  `handleSync`; reset it in `admin/init`/`admin/reset`; include it in the
  WS `init` message.
- `worker/test/validation.test.js` -- tests for `isValidRandomizedGames`.
- `worker/test/room-sync.test.js` -- tests for storing/returning
  `randomizedGames` via `/sync`, backward-compat (field omitted).
- `worker/test/room-ws.test.js` -- test that `init` includes
  `randomizedGames` (confirmed this is where the existing analogous
  `shareFlags`-in-`init` tests already live, e.g. "includes shareFlags
  reported by an earlier /sync call in the init message").
- `pages/tracker/team_progress_layout.js` -- add `category` field to the
  4 relevant `gauges` entries per title.
- `pages/tracker/sync_relay.js` -- capture `shareFlags`/`randomizedGames`
  from WS messages; row reorder in `renderProgressGrid()`; gauge-row
  category filtering; new `renderCommonBlock()` replacing the old
  `miscRow` construction; drop the heading; skip non-randomized titles;
  `renderGaugeCell` drops the `/total` suffix.
- `pages/tracker/sync_relay.html` -- remove the now-unused `.title-panel
  h3`/`.misc-row` CSS (heading and old misc-row are both gone); bump
  `.hud-number` font-size.

## Non-goals

- `armor` and `finalWeapon` shared categories are not consolidated into
  Common, per the confirmed scope -- always per-game.
- No change to `worker/src/room.js`'s `mergeIncomingItems` or its own
  `shareFlags` parameter (a different, pre-existing use of the same data
  for cross-player item-merge gating in `checksSeen+shared` mode) --
  this spec only adds a second, independent consumer of the same
  already-computed seed setting.
- No automated tests for the `pages/tracker/*` rendering changes
  (established convention -- manual/hand-trace verification), but the new
  `worker/` changes DO get real `vitest` coverage, matching how every
  other worker-side change in this project is tested.
