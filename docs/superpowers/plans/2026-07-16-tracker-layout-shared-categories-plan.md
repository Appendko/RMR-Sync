# Tracker Row Reorder, Common Block, and Active-Title Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder each title panel so the game-clear icon replaces the
heading, add a "Common" block for seed-shared item categories (plus
deaths/IFG), detect and hide titles this seed doesn't randomize (a real
Lua → Worker → client data-plumbing addition), and simplify gauge text to
a bare count in a larger font.

**Architecture:** One cross-stack addition (`randomizedGames`, mirroring
the existing `shareFlags` field exactly: Lua reads it from ROM once,
sends it on every `/sync`, the Worker stores/validates/echoes it and
includes it in the WebSocket `init` message) plus purely client-side
rendering changes in `pages/tracker/`.

**Tech Stack:** Lua (BizHawk), Cloudflare Worker + Durable Object
(`vitest`), plain HTML/CSS/vanilla JS client (no test suite, per
established convention).

**Full design rationale:** see
`docs/superpowers/specs/2026-07-16-tracker-layout-shared-categories-design.md`.
This plan implements that spec exactly; read it first if anything below
seems under-explained.

## Global Constraints

- `randomizedGames` follows `shareFlags`'s exact existing pattern at every
  layer: an optional `/sync` body field, `undefined` is always valid
  (older Lua clients), stored value defaults to a safe "nothing hidden"
  state (`[true, true, true]`, mirroring `shareFlags`'s `{}` default),
  included in the `/sync` response and the WS `init` message only (never
  the `"progress"` broadcast — static for the whole session).
- No changes to `worker/src/room.js`'s `mergeIncomingItems` or its
  existing `shareFlags` parameter — that's a different, pre-existing
  consumer of the same seed setting (cross-player item-merge gating),
  untouched by this plan.
- Every `worker/` change gets real `vitest` coverage, matching this
  project's existing convention. `pages/tracker/*` client changes are
  manually/hand-trace verified only — no automated test suite exists for
  them (confirmed exception: `pages/tracker/icon_map.test.mjs`, which
  nothing in this plan touches).
- `armor` and `finalWeapon` share categories are explicitly out of scope
  for the Common-block consolidation — only `sigmaKey`, `lifeUp`,
  `energyUp`, `subTank` move there when shared; buster/charge upgrade
  tiers always stay per-game regardless of `shareFlags.upgradeItem`.

---

### Task 1: `randomizedGames` plumbing (Lua + Worker + tests)

**Files:**
- Modify: `lua/share_info.lua:351` (`issueRequest`'s `sync` table)
- Modify: `worker/src/validation.js` (new `isValidRandomizedGames`)
- Modify: `worker/src/room.js` (import, `handleInit`, `handleReset`,
  `handleSync`, `handleWebSocket`)
- Modify: `worker/test/validation.test.js`, `worker/test/room-sync.test.js`,
  `worker/test/room-ws.test.js`

**Interfaces:**
- Produces: `isValidRandomizedGames(value)` (exported from
  `validation.js`), the `/sync` request/response `randomizedGames` field,
  the WS `init` message's `randomizedGames` field — all consumed by
  Task 2.

- [ ] **Step 1: Add `randomizedGames` to the Lua sync payload**

In `lua/share_info.lua`, replace the `sync` field inside `issueRequest()`
(the existing line reads exactly):

```lua
        sync = { checksSeen = readChecksSeen(), items = readItems(), epoch = knownEpoch, shareFlags = shareFlags },
```

with:

```lua
        sync = { checksSeen = readChecksSeen(), items = readItems(), epoch = knownEpoch, shareFlags = shareFlags, randomizedGames = randomizedGames },
```

(`randomizedGames` is the module-level local already set by `local
randomizedGames = readRandomizedGames()` earlier in this file — no new
Lua logic needed, just sending an already-computed value.)

- [ ] **Step 2: Add `isValidRandomizedGames` to `worker/src/validation.js`**

Add at the end of the file, after `isValidShareFlags`:

```js
// Optional field on the /sync body -- which of the 3 titles this seed
// actually randomizes (read from ROM by lua/share_info.lua's
// readRandomizedGames, static for the whole session), used by the
// team-progress tracker to hide a title's panel entirely when it isn't
// part of the seed. Older Lua clients that predate this field simply omit
// it, so `undefined` is valid too -- same pattern as isValidShareFlags.
export function isValidRandomizedGames(value) {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "boolean");
}
```

- [ ] **Step 3: Wire `randomizedGames` through `worker/src/room.js`**

Update the import (line 2) from:

```js
import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidItemsArray, isValidEpoch, isValidShareFlags, validateEventBody } from "./validation.js";
```

to:

```js
import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidItemsArray, isValidEpoch, isValidShareFlags, isValidRandomizedGames, validateEventBody } from "./validation.js";
```

In `handleInit`, add a line right after `await
this.state.storage.put("shareFlags", {});`:

```js
    await this.state.storage.put("shareFlags", {});
    await this.state.storage.put("randomizedGames", [true, true, true]);
```

In `handleReset`, add the identical line right after its own `await
this.state.storage.put("shareFlags", {});`:

```js
    await this.state.storage.put("shareFlags", {});
    await this.state.storage.put("randomizedGames", [true, true, true]);
```

In `handleSync`, replace the validation block:

```js
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !isValidChecksSeenArray(body.checksSeen) ||
      !isValidItemsArray(body.items) ||
      !isValidEpoch(body.epoch) ||
      !isValidShareFlags(body.shareFlags)
    ) {
      return jsonResponse({ error: "invalid checksSeen, items, epoch, or shareFlags" }, 400);
    }
```

with:

```js
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !isValidChecksSeenArray(body.checksSeen) ||
      !isValidItemsArray(body.items) ||
      !isValidEpoch(body.epoch) ||
      !isValidShareFlags(body.shareFlags) ||
      !isValidRandomizedGames(body.randomizedGames)
    ) {
      return jsonResponse({ error: "invalid checksSeen, items, epoch, shareFlags, or randomizedGames" }, 400);
    }
```

Then, right after the existing `shareFlags` store/read block:

```js
    if (body.shareFlags !== undefined) {
      await this.state.storage.put("shareFlags", body.shareFlags);
    }
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
```

add:

```js
    if (body.randomizedGames !== undefined) {
      await this.state.storage.put("randomizedGames", body.randomizedGames);
    }
    const randomizedGames = (await this.state.storage.get("randomizedGames")) ?? [true, true, true];
```

Then update `handleSync`'s final return from:

```js
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, mergedItems });
```

to:

```js
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, randomizedGames, mergedItems });
```

Finally, in `handleWebSocket`, replace:

```js
    const mode = (await this.state.storage.get("mode")) ?? null;
    const backlog = (await this.state.storage.get("events")) ?? [];
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
    const teamChecks = (await this.state.storage.get("teamChecks")) ?? [];
    const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    const totalDeaths = (await this.state.storage.get("totalDeaths")) ?? 0;
    const totalIfgUses = (await this.state.storage.get("totalIfgUses")) ?? 0;
    server.send(JSON.stringify({ type: "init", mode, backlog, shareFlags, teamChecks, mergedItems, totalDeaths, totalIfgUses }));
```

with:

```js
    const mode = (await this.state.storage.get("mode")) ?? null;
    const backlog = (await this.state.storage.get("events")) ?? [];
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
    const randomizedGames = (await this.state.storage.get("randomizedGames")) ?? [true, true, true];
    const teamChecks = (await this.state.storage.get("teamChecks")) ?? [];
    const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    const totalDeaths = (await this.state.storage.get("totalDeaths")) ?? 0;
    const totalIfgUses = (await this.state.storage.get("totalIfgUses")) ?? 0;
    server.send(JSON.stringify({ type: "init", mode, backlog, shareFlags, randomizedGames, teamChecks, mergedItems, totalDeaths, totalIfgUses }));
```

- [ ] **Step 4: Add tests to `worker/test/validation.test.js`**

Add the import `isValidRandomizedGames` to the existing top-of-file
import line (alongside `isValidShareFlags`), then add this new `describe`
block right after the existing `describe("isValidShareFlags", ...)`
block:

```js
describe("isValidRandomizedGames", () => {
  it("accepts undefined (older Lua clients that predate this field)", () => {
    expect(isValidRandomizedGames(undefined)).toBe(true);
  });

  it("accepts a 3-element boolean array", () => {
    expect(isValidRandomizedGames([true, true, true])).toBe(true);
    expect(isValidRandomizedGames([true, false, true])).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidRandomizedGames([true, true])).toBe(false);
    expect(isValidRandomizedGames([true, true, true, true])).toBe(false);
  });

  it("rejects non-boolean entries", () => {
    expect(isValidRandomizedGames([true, "yes", true])).toBe(false);
    expect(isValidRandomizedGames([1, 0, 1])).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidRandomizedGames({})).toBe(false);
    expect(isValidRandomizedGames(null)).toBe(false);
  });
});
```

- [ ] **Step 5: Add tests to `worker/test/room-sync.test.js`**

Extend the existing `sync` helper (currently `function sync(stub,
checksSeen, epoch, shareFlags, items = new Array(96).fill(0)) { ... }`)
with a 6th, optional parameter — append-only, so every existing call site
(which only ever passes 4-5 positional args) is unaffected:

```js
function sync(stub, checksSeen, epoch, shareFlags, items = new Array(96).fill(0), randomizedGames = undefined) {
  return stub.fetch("https://do/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksSeen, epoch, shareFlags, items, randomizedGames }),
  });
}
```

Then add these 5 tests immediately after the existing `it("rejects an
invalid shareFlags object", ...)` test (right before `it("defaults to an
empty mergedItems array before any shared item is picked up", ...)`):

```js
  it("defaults to [true, true, true] for randomizedGames when no client has ever sent one", async () => {
    const stub = getStub("test-room-sync-rg-1");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect((await res.json()).randomizedGames).toEqual([true, true, true]);
  });

  it("stores and echoes back a client-provided randomizedGames array", async () => {
    const stub = getStub("test-room-sync-rg-2");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), [true, false, true]);
    expect((await res.json()).randomizedGames).toEqual([true, false, true]);
  });

  it("keeps the last-known randomizedGames for a client that omits it", async () => {
    const stub = getStub("test-room-sync-rg-3");
    await initRoom(stub, "checksSeen");
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), [true, false, true]);
    const res = await sync(stub, new Array(96).fill(0), 0); // no randomizedGames this time
    expect((await res.json()).randomizedGames).toEqual([true, false, true]);
  });

  it("rejects an invalid randomizedGames array", async () => {
    const stub = getStub("test-room-sync-rg-4");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), [true, "nope", true]);
    expect(res.status).toBe(400);
  });

  it("resets randomizedGames back to [true, true, true] on admin/reset", async () => {
    const stub = getStub("test-room-sync-rg-5");
    await initRoom(stub, "checksSeen");
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), [true, false, true]);
    const before = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(before.randomizedGames).toEqual([true, false, true]);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });
    const after = await (await sync(stub, new Array(96).fill(0), 1)).json();
    expect(after.randomizedGames).toEqual([true, true, true]);
  });
```

- [ ] **Step 6: Add tests to `worker/test/room-ws.test.js`**

Add these 2 tests right after the existing `it("includes shareFlags
reported by an earlier /sync call in the init message", ...)` test:

```js
  it("defaults randomizedGames to [true, true, true] in the init message when never set", async () => {
    const stub = getStub("test-room-ws-rg-default");
    await initRoom(stub, "checksSeen");
    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.randomizedGames).toEqual([true, true, true]);
    ws.close();
  });

  it("includes randomizedGames reported by an earlier /sync call in the init message", async () => {
    const stub = getStub("test-room-ws-rg");
    await initRoom(stub, "checksSeen+shared");
    await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch: 0, randomizedGames: [true, false, true] }),
    });

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.randomizedGames).toEqual([true, false, true]);
    ws.close();
  });
```

- [ ] **Step 7: Run the full worker suite**

```bash
cd worker && npm test
```

Expected: all test files pass, including the 12 new tests added in Steps
4-6 (5 in `validation.test.js`, 5 in `room-sync.test.js`, 2 in
`room-ws.test.js`), output pristine.

- [ ] **Step 8: Commit**

```bash
git add lua/share_info.lua worker/src/validation.js worker/src/room.js worker/test/validation.test.js worker/test/room-sync.test.js worker/test/room-ws.test.js
git commit -m "worker+lua: plumb randomizedGames from Lua through to the WS init message"
```

---

### Task 2: Client captures `shareFlags`/`randomizedGames`; hides non-randomized titles

**Files:**
- Modify: `pages/tracker/sync_relay.js`

**Interfaces:**
- Consumes: `randomizedGames`/`shareFlags` fields now present on WS
  `init`/`/sync` messages (Task 1).
- Produces: module-level `shareFlags`/`randomizedGames` variables,
  consumed by Task 4 (gauge category filtering, Common block).

- [ ] **Step 1: Add module-level state**

In `pages/tracker/sync_relay.js`, add two new variables right after the
existing `let totalIfgUses = 0;` line:

```js
let shareFlags = {};
let randomizedGames = [true, true, true];
```

- [ ] **Step 2: Capture both fields in `applyProgressState`**

Replace:

```js
function applyProgressState(msg) {
  if (msg.teamChecks !== undefined) teamChecks = msg.teamChecks;
  if (msg.mergedItems !== undefined) mergedItems = msg.mergedItems;
  if (msg.totalDeaths !== undefined) totalDeaths = msg.totalDeaths;
  if (msg.totalIfgUses !== undefined) totalIfgUses = msg.totalIfgUses;
  renderProgressGrid();
}
```

with:

```js
function applyProgressState(msg) {
  if (msg.teamChecks !== undefined) teamChecks = msg.teamChecks;
  if (msg.mergedItems !== undefined) mergedItems = msg.mergedItems;
  if (msg.totalDeaths !== undefined) totalDeaths = msg.totalDeaths;
  if (msg.totalIfgUses !== undefined) totalIfgUses = msg.totalIfgUses;
  if (msg.shareFlags !== undefined) shareFlags = msg.shareFlags;
  if (msg.randomizedGames !== undefined) randomizedGames = msg.randomizedGames;
  renderProgressGrid();
}
```

- [ ] **Step 3: Skip a title's panel when it isn't randomized this seed**

In `renderProgressGrid()`, the per-title loop currently starts:

```js
  for (const title of [1, 2, 3]) {
    const layout = TEAM_PROGRESS_LAYOUT[title];
    const section = document.createElement("div");
```

Add the skip check right after `const layout = ...` line:

```js
  for (const title of [1, 2, 3]) {
    const layout = TEAM_PROGRESS_LAYOUT[title];
    if (randomizedGames[title - 1] === false) continue;
    const section = document.createElement("div");
```

(Explicit `=== false` only — a missing/partial array element is
`undefined`, not `false`, so it never accidentally hides a title.)

- [ ] **Step 4: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
randomizedGames = [true, false, true];
renderProgressGrid();
```

Expected: the X2 panel disappears entirely; X1 and X3 still render
normally. Then run `randomizedGames = [true, true, true];
renderProgressGrid();` to confirm all 3 panels come back.

- [ ] **Step 5: Commit**

```bash
git add pages/tracker/sync_relay.js
git commit -m "tracker: capture shareFlags/randomizedGames; hide non-randomized titles"
```

---

### Task 3: Row reorder + heading removal

**Files:**
- Modify: `pages/tracker/sync_relay.js` (`renderProgressGrid()`)
- Modify: `pages/tracker/sync_relay.html` (remove now-dead `.title-panel
  h3` CSS)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed elsewhere — purely a rendering-order
  change within `renderProgressGrid()`.

- [ ] **Step 1: Remove the heading, move the game-clear icon to row 1, reorder row 3**

In `renderProgressGrid()`, replace this whole block (from the `const
heading = ...` line through the `sigmaRow`'s `section.appendChild(sigmaRow);`
line):

```js
    const heading = document.createElement("h3");
    const titleIcon = document.createElement("img");
    titleIcon.src = layout.titleIcon;
    titleIcon.alt = `X${title}`;
    heading.appendChild(titleIcon);
    heading.appendChild(document.createTextNode(`Rockman X${title}`));
    section.appendChild(heading);

    const bossRow = document.createElement("div");
    bossRow.className = "icon-grid";
    const openingInfo = getCheckIconInfoForId(layout.openingCheckId);
    bossRow.appendChild(makeGridIcon(openingInfo.file, openingInfo.label, isTeamCheckDone(layout.openingCheckId)));
    for (const checkId of layout.bossCheckIds) {
      const info = getCheckIconInfoForId(checkId);
      bossRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
    }
    section.appendChild(bossRow);

    const weaponRow = document.createElement("div");
    weaponRow.className = "icon-grid";
    weaponRow.appendChild(makeArmorOverlay(title, layout));
    for (const itemId of layout.weaponIds) {
      const info = getIconInfoForId(itemId);
      weaponRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
    }
    section.appendChild(weaponRow);

    const sigmaRow = document.createElement("div");
    sigmaRow.className = "icon-grid";
    for (const checkId of layout.sigmaCheckIds) {
      const info = getCheckIconInfoForId(checkId);
      sigmaRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
    }
    const superInfo = getIconInfoForId(layout.superWeaponId);
    sigmaRow.appendChild(makeGridIcon(superInfo.file, superInfo.label, isItemOwned(layout.superWeaponId)));
    const clearInfo = getCheckIconInfoForId(layout.gameClearCheckId);
    sigmaRow.appendChild(makeGridIcon(clearInfo.file, clearInfo.label, isTeamCheckDone(layout.gameClearCheckId)));
    section.appendChild(sigmaRow);
```

with:

```js
    const bossRow = document.createElement("div");
    bossRow.className = "icon-grid";
    const clearInfo = getCheckIconInfoForId(layout.gameClearCheckId);
    bossRow.appendChild(makeGridIcon(clearInfo.file, clearInfo.label, isTeamCheckDone(layout.gameClearCheckId)));
    for (const checkId of layout.bossCheckIds) {
      const info = getCheckIconInfoForId(checkId);
      bossRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
    }
    section.appendChild(bossRow);

    const weaponRow = document.createElement("div");
    weaponRow.className = "icon-grid";
    weaponRow.appendChild(makeArmorOverlay(title, layout));
    for (const itemId of layout.weaponIds) {
      const info = getIconInfoForId(itemId);
      weaponRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
    }
    section.appendChild(weaponRow);

    const sigmaRow = document.createElement("div");
    sigmaRow.className = "icon-grid";
    const superInfo = getIconInfoForId(layout.superWeaponId);
    sigmaRow.appendChild(makeGridIcon(superInfo.file, superInfo.label, isItemOwned(layout.superWeaponId)));
    const openingInfo = getCheckIconInfoForId(layout.openingCheckId);
    sigmaRow.appendChild(makeGridIcon(openingInfo.file, openingInfo.label, isTeamCheckDone(layout.openingCheckId)));
    for (const checkId of layout.sigmaCheckIds) {
      const info = getCheckIconInfoForId(checkId);
      sigmaRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
    }
    section.appendChild(sigmaRow);
```

(The gauge row, the title-specific 5th row, and the final
`panel.appendChild(section);`/misc-row code below this block are
untouched by this task — Task 4 handles those.)

- [ ] **Step 2: Remove the now-dead heading CSS**

In `pages/tracker/sync_relay.html`, remove these 2 lines (now unused
since the `<h3>` heading no longer exists anywhere):

```css
  .title-panel h3 { display: flex; align-items: center; gap: 0.4em; font-size: 1.05em; margin: 0 0 0.5em; color: var(--text); }
  .title-panel h3 img { width: 24px; height: 24px; }
```

- [ ] **Step 3: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
teamChecks = [900];
mergedItems = new Array(96).fill(0);
renderProgressGrid();
```

Expected: no heading text ("Rockman X1" etc.) appears above any panel —
each panel starts directly with its icon rows. The X1 panel's very first
icon (top-left of its first row) is now the X1 logo/clear icon, shown in
full color (since `teamChecks` includes 900); X2 and X3's equivalent
first icons are grayscale (not cleared). In the third row of each panel,
the super-weapon icon now comes first, followed by the opening-stage
icon, followed by the sigma-fortress-check icons.

- [ ] **Step 4: Commit**

```bash
git add pages/tracker/sync_relay.js pages/tracker/sync_relay.html
git commit -m "tracker: move game-clear icon to row 1, drop heading, reorder row 3"
```

---

### Task 4: Gauge category tagging, per-game hiding, and the Common block

**Files:**
- Modify: `pages/tracker/team_progress_layout.js` (add `category` field
  to 4 gauge entries per title)
- Modify: `pages/tracker/sync_relay.js` (gauge-row filtering, new
  `renderCommonBlock()`, replace the old `miscRow`)
- Modify: `pages/tracker/sync_relay.html` (remove now-dead `.misc-row`
  CSS)

**Interfaces:**
- Consumes: `shareFlags`/`totalDeaths`/`totalIfgUses` (existing/Task 2),
  `layout.gauges[*].category` (this task's own new field).
- Produces: nothing consumed by Task 5.

- [ ] **Step 1: Add `category` to the 4 relevant gauge entries in each title**

In `pages/tracker/team_progress_layout.js`, for **title 1**, replace:

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76] },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29] },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [36, 37, 38, 39] },
```

with:

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76], category: "sigmaKey" },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], category: "lifeUp" },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29], category: "energyUp" },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [36, 37, 38, 39], category: "subTank" },
```

For **title 2**, replace:

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332] },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269] },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285] },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [292, 293, 294, 295] },
```

with:

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332], category: "sigmaKey" },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269], category: "lifeUp" },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285], category: "energyUp" },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [292, 293, 294, 295], category: "subTank" },
```

For **title 3**, replace:

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589] },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525] },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541] },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [548, 549, 550, 551] },
```

with:

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589], category: "sigmaKey" },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525], category: "lifeUp" },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541], category: "energyUp" },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [548, 549, 550, 551], category: "subTank" },
```

(In all 3 titles, the 5 buster-tier entries right after these 4 lines
are untouched -- no `category` field, they never hide. The post-object
loop at the bottom of the file that wires the subtank gauge's `ids` to
`layout.subtankIds` is also untouched -- it runs after these edits and
still finds the same entry by its `label`.)

- [ ] **Step 2: Filter shared categories out of each title's gauge row**

In `renderProgressGrid()`, replace:

```js
    const gaugeRow = document.createElement("div");
    gaugeRow.className = "icon-grid";
    for (const gauge of layout.gauges) {
      gaugeRow.appendChild(renderGaugeCell(gauge));
    }
    section.appendChild(gaugeRow);
```

with:

```js
    const gaugeRow = document.createElement("div");
    gaugeRow.className = "icon-grid";
    for (const gauge of layout.gauges) {
      if (gauge.category && shareFlags[gauge.category]) continue; // shown once in the Common block instead
      gaugeRow.appendChild(renderGaugeCell(gauge));
    }
    section.appendChild(gaugeRow);
```

- [ ] **Step 3: Add `renderCommonBlock()`**

Add this new constant and function to `pages/tracker/sync_relay.js`,
right before `renderProgressGrid`:

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

- [ ] **Step 4: Replace the old `miscRow` with `renderCommonBlock()`**

At the end of `renderProgressGrid()`, replace:

```js
  const miscRow = document.createElement("div");
  miscRow.className = "misc-row";
  const allClearInfo = getCheckIconInfoForId(ALL_CLEAR_CHECK_ID);
  miscRow.appendChild(makeGridIcon(allClearInfo.file, allClearInfo.label, isTeamCheckDone(ALL_CLEAR_CHECK_ID)));

  miscRow.appendChild(makeGaugeIcon("assets/deaths.png", "Deaths", String(totalDeaths)));
  miscRow.appendChild(makeGaugeIcon("assets/igf.png", "IFG uses", String(totalIfgUses)));

  panel.appendChild(miscRow);
}
```

with:

```js
  panel.appendChild(renderCommonBlock());
}
```

- [ ] **Step 5: Remove the now-dead `.misc-row` CSS**

In `pages/tracker/sync_relay.html`, remove these 2 lines (the Common
block reuses `.title-panel`/`.icon-grid` sizing instead):

```css
  .misc-row { display: flex; align-items: center; gap: 1em; margin-top: 0.5em; }
  .misc-row .icon-cell, .misc-row .gauge-cell { width: 32px; height: 32px; padding: 0; flex-shrink: 0; }
```

- [ ] **Step 6: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
shareFlags = { sigmaKey: true };
teamChecks = [900, 901, 902, 903];
mergedItems = new Array(96).fill(0);
mergedItems[8] = 0b00000111; // ids 64,65,66 -- 3 of X1's 13 sigma keys
mergedItems[40] = 0b00000001; // id 320 -- 1 of X2's 13 sigma keys
renderProgressGrid();
```

Expected: none of the 3 title panels show a "Sigma keys collected" cell
in their gauge row anymore. After the 3 panels, a new bordered block
appears (same border/background as the game panels) whose first icon is
the combined "all 3 titles cleared" logo, shown in full color (`teamChecks`
includes 903); its next cell is one sigma-key gauge showing `4` (the 3
owned in X1 plus the 1 owned in X2, out of all 40 combined ids across the
3 titles); followed by the deaths and IFG counts (both `0`).

- [ ] **Step 7: Commit**

```bash
git add pages/tracker/team_progress_layout.js pages/tracker/sync_relay.js pages/tracker/sync_relay.html
git commit -m "tracker: add Common block for shared categories, hide them per-game"
```

---

### Task 5: Bigger gauge text, no "/total"

**Files:**
- Modify: `pages/tracker/sync_relay.js` (`renderGaugeCell`)
- Modify: `pages/tracker/sync_relay.html` (`.hud-number` font-size)

**Interfaces:** none — purely a text/styling tweak to the existing
gauge-cell rendering.

- [ ] **Step 1: Drop the "/total" suffix**

In `pages/tracker/sync_relay.js`, replace:

```js
function renderGaugeCell(gauge) {
  const count = gauge.ids.filter(isItemOwned).length;
  return makeGaugeIcon(gauge.file, gauge.label, `${count}/${gauge.ids.length}`);
}
```

with:

```js
function renderGaugeCell(gauge) {
  const count = gauge.ids.filter(isItemOwned).length;
  return makeGaugeIcon(gauge.file, gauge.label, `${count}`);
}
```

- [ ] **Step 2: Bump `.hud-number`'s font size**

In `pages/tracker/sync_relay.html`, change:

```css
    font-family: "DSEG7Classic-Italic", "Courier New", ui-monospace, monospace; font-weight: 700; font-size: 0.8em; color: #000;
```

to:

```css
    font-family: "DSEG7Classic-Italic", "Courier New", ui-monospace, monospace; font-weight: 700; font-size: 1.6em; color: #000;
```

- [ ] **Step 3: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
mergedItems = new Array(96).fill(0);
mergedItems[8] = 0b00000111;
renderProgressGrid();
```

Expected: every gauge cell (sigma-key, life-up, energy-up, subtank, the 5
buster tiers, and the Common block's deaths/IFG) shows a bare number (no
`/13`-style suffix anywhere), noticeably larger than before. If any digit
looks clipped or overflows its cell at this size, that's a live visual
call to make in an actual browser — note it rather than guessing a
different value blind.

- [ ] **Step 4: Commit**

```bash
git add pages/tracker/sync_relay.js pages/tracker/sync_relay.html
git commit -m "tracker: drop /total suffix from gauge text, bump hud-number font size"
```

---

## Final whole-branch check

After all 5 tasks: run `cd worker && npm test` (full suite green,
including the 12 new `randomizedGames` tests from Task 1) and `cd
pages/tracker && node --test icon_map.test.mjs` (unaffected, still
29/29). Open `pages/tracker/sync_relay.html` with no console overrides —
confirm no heading text anywhere, each panel's first icon is its
game-clear logo, row 3 starts with the super weapon, the Common block
renders (even with nothing shared, it should still show at least the
all-clear icon plus deaths/IFG), and gauge numbers are bare counts in the
larger font.
