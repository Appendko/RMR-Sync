# Team Progress Grid Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `pages/tracker/sync_relay.html`'s team-progress grid so it
reads as a polished at-a-glance tracker instead of a debug page: a
collapsible connection panel, a dark-themed CSS-grid layout matching
`ref/RMR_progress_tracker_displayer_ver_js_20260126`'s actual technique, a
composite armor overlay, and every remaining item category
(`mergedItems` already carries) surfaced as gauge or boolean cells.

**Architecture:** Pure client-side change across 3 existing files
(`pages/tracker/sync_relay.html`, `pages/tracker/sync_relay.js`,
`pages/tracker/team_progress_layout.js`) plus a one-branch fix in
`pages/tracker/icon_map.js`. No `worker/` or `lua/` changes — every item id
this plan renders is already flowing into `sync_relay.js` today via the
existing WebSocket `init`/`progress` messages.

**Tech Stack:** Plain HTML/CSS/vanilla JS, no build step, no framework, no
CDN — matching every other file in `pages/tracker/`.

**Full design rationale, asset provenance, and the "known gaps vs. the
reference tracker" audit:** see
`docs/superpowers/specs/2026-07-14-tracker-visual-redesign-design.md`. This
plan implements that spec exactly; read it first if anything below seems
under-explained.

## Global Constraints

- No build step, no external CDN, no JS framework — plain inline
  `<style>`/`<script>`, matching every other file in `pages/tracker/`.
- No automated tests for `pages/tracker/*` — this project's established
  convention (see the spec's Non-goals). Verification in every task below
  is manual: open `pages/tracker/sync_relay.html` in a browser, run a
  given console snippet, check the described visual result.
- Do not rename or remove the existing `localStorage` keys
  (`rmrSyncRelayWorkerUrl`, `rmrSyncRelayRoomKey`) or alter the WebSocket
  reconnect-thrash guard (`if (progressWs !== ws) return;` checks in
  `connectProgressWs()`) — both are load-bearing fixes from earlier work.
- All 8 new asset files (`b.png`, `ba.png`, `br.png`, `bd.png`, `bc.png`,
  `x2_zero_head.ico`, `x2_zero_body.ico`, `x2_zero_foot.ico`) already exist
  in `pages/tracker/assets/` and are already committed — no task below
  needs to add them.
- Every new/changed piece of gameplay data (item/check ids) must be cross
  -checked against `pages/tracker/item_id_map.js`/`check_id_map.js` before
  use — the exact ids for every task below were already verified this way
  during spec-writing; if a task's code disagrees with those files, the
  files are the source of truth.

---

### Task 1: Dark theme, CSS-grid icon cells, gauge-cell counter styling

**Files:**
- Modify: `pages/tracker/sync_relay.html:6-18` (the `<style>` block)
- Modify: `pages/tracker/sync_relay.js:44-53` (`makeGridIcon`), `:117-136`
  (the misc-row deaths/IFG construction inside `renderProgressGrid`)

**Interfaces:**
- Consumes: nothing new — this task only restyles the existing render
  path (`renderProgressGrid()` in `sync_relay.js`, called from
  `applyProgressState()`).
- Produces: `makeGridIcon(file, label, done)` now returns a wrapper
  `<div class="icon-cell">` containing the `<img>` (previously returned
  the bare `<img>`) — every existing caller already just does
  `row.appendChild(makeGridIcon(...))`, so no caller needs to change.
  `makeGaugeIcon(file, label, text)` is a new function later tasks (3-5)
  will also reuse for gauge cells.

This task is a **pure mechanical reskin** — every icon that renders today
still renders in the exact same row/grouping; only class names, wrapper
markup, and CSS change. Row regrouping (armor overlay, gauges, title
-specific extras) happens in later tasks.

- [ ] **Step 1: Replace the `<style>` block**

Replace `pages/tracker/sync_relay.html` lines 6-18 (from `<style>` through
`</style>`, i.e. everything between the `<title>` line and `</head>`) with:

```html
<style>
  :root {
    --bg: #14141a;
    --panel-bg: #1c1c24;
    --panel-border: #ffffff;
    --text: #e8e8ec;
    --text-dim: #9a9aa4;
  }
  body {
    font-family: sans-serif;
    max-width: 640px;
    margin: 2em auto;
    background: var(--bg);
    color: var(--text);
  }
  #status { white-space: pre-wrap; background: #262630; padding: 1em; border-radius: 4px; }
  button { font-size: 1em; padding: 0.5em 1em; margin-right: 0.5em; }

  .title-panel { margin: 0.75em 0; border: 2px solid var(--panel-border); border-radius: 5px; padding: 0.6em 0.8em; background: var(--panel-bg); }
  .title-panel h3 { display: flex; align-items: center; gap: 0.4em; font-size: 1.05em; margin: 0 0 0.5em; color: var(--text); }
  .title-panel h3 img { width: 24px; height: 24px; }

  .icon-grid { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 4px; margin-bottom: 0.35em; }

  .icon-cell { padding: 6%; aspect-ratio: 1; }
  .icon-cell img { width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; image-rendering: pixelated; filter: grayscale(100%) brightness(0.55); opacity: 0.45; transition: filter 0.4s ease, opacity 0.4s ease; }
  .icon-cell img.done { filter: none; opacity: 1; }

  .gauge-cell { position: relative; padding: 6%; aspect-ratio: 1; }
  .gauge-cell img { width: 100%; height: 100%; object-fit: contain; display: block; image-rendering: pixelated; }
  .hud-number {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: "Courier New", ui-monospace, monospace; font-weight: 700; font-size: 0.8em; color: #000;
    text-shadow:
      2px 0 0 #fff, 1.76px 0.96px 0 #fff, 1.08px 1.68px 0 #fff,
      0.14px 1.99px 0 #fff, -0.83px 1.82px 0 #fff, -1.6px 1.2px 0 #fff,
      -1.98px 0.28px 0 #fff, -1.87px -0.7px 0 #fff, -1.31px -1.51px 0 #fff,
      -0.42px -1.96px 0 #fff, 0.57px -1.92px 0 #fff, 1.42px -1.41px 0 #fff,
      1.92px -0.56px 0 #fff;
  }

  .misc-row { display: flex; align-items: center; gap: 1em; margin-top: 0.5em; }
  .misc-row .icon-cell, .misc-row .gauge-cell { width: 32px; height: 32px; padding: 0; flex-shrink: 0; }
</style>
```

(`.armor-overlay`/`.armor-part` CSS is added in Task 3; the collapse
-toggle CSS is added in Task 2 — kept out of this block to keep this task's
diff limited to the reskin.)

- [ ] **Step 2: Update `makeGridIcon` to return a wrapped cell**

In `pages/tracker/sync_relay.js`, replace the existing `makeGridIcon`
function (lines 44-53):

```js
function makeGridIcon(file, label, done) {
  const img = document.createElement("img");
  img.src = file;
  img.alt = label;
  img.title = label;
  if (done) {
    img.classList.add("done");
  }
  return img;
}
```

with:

```js
function makeGridIcon(file, label, done) {
  const cell = document.createElement("div");
  cell.className = "icon-cell";
  const img = document.createElement("img");
  img.src = file;
  img.alt = label;
  img.title = label;
  if (done) {
    img.classList.add("done");
  }
  cell.appendChild(img);
  return cell;
}

function makeGaugeIcon(file, label, text) {
  const cell = document.createElement("div");
  cell.className = "gauge-cell";
  const img = document.createElement("img");
  img.src = file;
  img.alt = label;
  img.title = label;
  cell.appendChild(img);
  const number = document.createElement("span");
  number.className = "hud-number";
  number.textContent = text;
  cell.appendChild(number);
  return cell;
}
```

- [ ] **Step 3: Rename `icon-row` to `icon-grid` everywhere it's used**

In `renderProgressGrid()`, `pages/tracker/sync_relay.js`, change every
`.className = "icon-row"` assignment to `.className = "icon-grid"` (4
occurrences: `bossRow`, `weaponRow`, `armorRow`, `sigmaRow`). Do not change
anything else about these blocks yet (armor overlay and row regrouping are
Task 3).

- [ ] **Step 4: Convert the deaths/IFG counters to gauge cells**

Replace this block in `renderProgressGrid()` (currently building
`miscRow`'s deaths/IFG icons as a bare `<img>` + adjacent `<span>`):

```js
  const deathsIcon = document.createElement("img");
  deathsIcon.src = "assets/deaths.png";
  deathsIcon.alt = "Deaths";
  miscRow.appendChild(deathsIcon);
  const deathsCount = document.createElement("span");
  deathsCount.textContent = String(totalDeaths);
  miscRow.appendChild(deathsCount);

  const ifgIcon = document.createElement("img");
  ifgIcon.src = "assets/igf.png";
  ifgIcon.alt = "IFG uses";
  miscRow.appendChild(ifgIcon);
  const ifgCount = document.createElement("span");
  ifgCount.textContent = String(totalIfgUses);
  miscRow.appendChild(ifgCount);
```

with:

```js
  miscRow.appendChild(makeGaugeIcon("assets/deaths.png", "Deaths", String(totalDeaths)));
  miscRow.appendChild(makeGaugeIcon("assets/igf.png", "IFG uses", String(totalIfgUses)));
```

- [ ] **Step 5: Manually verify in a browser**

Open `pages/tracker/sync_relay.html` directly in a browser (a `file://`
URL is fine — this check only exercises local rendering, not the folder
-picker or WebSocket features). Open devtools console and paste:

```js
teamChecks = [240, 241, 900];
mergedItems = new Array(96).fill(0);
mergedItems[5] = 0x01; // id 40, 1ItWeaponLO
totalDeaths = 3;
totalIfgUses = 7;
renderProgressGrid();
```

Expected: the page has a dark background; each title panel has a white
2px rounded border; the X1 panel's opening icon and its first boss icon
are in full color, the rest grayscale; the X1 weapon row's first icon
(`1ItWeaponLO`) is in full color; at the bottom, the deaths icon shows a
bold black "3" with a white outline centered on it, and the IFG icon
shows "7" the same way.

- [ ] **Step 6: Commit**

```bash
git add pages/tracker/sync_relay.html pages/tracker/sync_relay.js
git commit -m "tracker: dark theme + CSS-grid icon cells + gauge-cell counters"
```

---

### Task 2: Collapsible connection panel

**Files:**
- Modify: `pages/tracker/sync_relay.html` (style block additions, body
  markup restructure)
- Modify: `pages/tracker/sync_relay.js` (new collapse-toggle + status-dot
  logic, wired into existing connection/folder functions)

**Interfaces:**
- Consumes: `dirHandle` (existing module-level variable, non-null when a
  game folder is connected), `progressWs` (existing module-level
  WebSocket-or-null).
- Produces: `updateStatusDot()`, `setPanelCollapsed(collapsed)`,
  `restorePanelCollapsed()` — none of these are consumed by later tasks,
  this is a self-contained feature.

- [ ] **Step 1: Add the collapse/corner-controls CSS**

Add to the end of the `<style>` block in `pages/tracker/sync_relay.html`
(right before the closing `</style>` tag added in Task 1):

```css
  .panel-toggle-row { display: flex; justify-content: flex-end; margin-bottom: 0.5em; }
  #hidePanelBtn { background: none; border: 1px solid var(--text-dim); color: var(--text); border-radius: 4px; font-size: 0.85em; padding: 0.3em 0.7em; cursor: pointer; }

  .corner-controls { position: fixed; top: 1em; right: 1em; display: none; align-items: center; gap: 0.5em; z-index: 10; }
  .corner-controls.visible { display: flex; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #888; }
  .status-dot.connected { background: #3ecf6a; }
  .status-dot.partial { background: #e0a83e; }
  .status-dot.disconnected { background: #d94f4f; }
  #reopenPanelBtn { border-radius: 50%; width: 2.2em; height: 2.2em; padding: 0; font-size: 1.1em; line-height: 1; background: var(--panel-bg); border: 1px solid var(--text-dim); color: var(--text); cursor: pointer; }

  #connectionPanel.collapsed { display: none; }
```

- [ ] **Step 2: Restructure the body markup**

Replace everything in `pages/tracker/sync_relay.html` from `<h1>RMR Sync —
Relay</h1>` through the `<div id="status">Not connected.</div>` line
(i.e. all of the current body content before the `<script>` tags) with:

```html
<h1>RMR Sync — Relay</h1>

<div class="corner-controls" id="cornerControls">
  <span class="status-dot" id="statusDot"></span>
  <button id="reopenPanelBtn" title="Show connection settings">⚙</button>
</div>

<div id="connectionPanel">
  <p>
    Keep this tab open while you play. It reads your game's local sync files
    and relays them to the Cloudflare backend — no other setup needed beyond
    picking the folder that contains <code>boot.lua</code> once.
    Requires Chrome, Edge, or another Chromium-based browser.
  </p>

  <div class="panel-toggle-row">
    <button id="hidePanelBtn">Hide setup</button>
  </div>

  <h2>Team progress</h2>
  <p>
    Enter a Worker URL and room key to see the team's progress below — this
    works even without connecting a game folder. If you connect a folder
    below, these fill in automatically from your own game's settings.
  </p>
  <label>Worker URL<br><input type="text" id="progressWorkerUrl" style="width:100%" autocomplete="off" /></label><br><br>
  <label>Room key<br><input type="text" id="progressRoomKey" style="width:100%" autocomplete="off" /></label>

  <h2>Game connection</h2>
  <button id="pickBtn">Choose game folder</button>
  <button id="reconnectBtn" style="display:none">Reconnect folder</button>
  <div id="status">Not connected.</div>
</div>

<div id="progressPanel"></div>
```

Note `#progressPanel` now sits **outside** `#connectionPanel`, so the grid
stays visible when the panel collapses.

- [ ] **Step 3: Add the collapse-toggle and status-dot functions**

Add to `pages/tracker/sync_relay.js`, right after the existing
`PROGRESS_ROOM_KEY_KEY` constant declaration (line 12):

```js
const PANEL_COLLAPSED_KEY = "rmrSyncRelayPanelCollapsed";

function setPanelCollapsed(collapsed) {
  document.getElementById("connectionPanel").classList.toggle("collapsed", collapsed);
  document.getElementById("cornerControls").classList.toggle("visible", collapsed);
  try {
    localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // not fatal -- this session just won't remember the choice next time
  }
}

function restorePanelCollapsed() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  } catch {
    // localStorage unavailable -- default to expanded
  }
  setPanelCollapsed(collapsed);
}

function updateStatusDot() {
  const dot = document.getElementById("statusDot");
  const folderConnected = dirHandle !== null;
  const wsConnected = progressWs !== null && progressWs.readyState === WebSocket.OPEN;
  dot.className = "status-dot";
  if (folderConnected && wsConnected) {
    dot.classList.add("connected");
  } else if (wsConnected) {
    dot.classList.add("partial");
  } else {
    dot.classList.add("disconnected");
  }
}
```

- [ ] **Step 4: Wire `updateStatusDot()` into the existing connection events**

In `connectProgressWs()`'s `open` listener, after
`progressReconnectDelayMs = 1000;`, add `updateStatusDot();` so the final
listener body reads:

```js
  ws.addEventListener("open", () => {
    if (progressWs !== ws) return; // superseded before it even opened
    progressReconnectDelayMs = 1000;
    updateStatusDot();
  });
```

In the same function's `close` listener, after the
`progressReconnectDelayMs = Math.min(...)` line, add `updateStatusDot();`
so it reads:

```js
  ws.addEventListener("close", () => {
    if (progressWs !== ws) return;
    setTimeout(connectProgressWs, progressReconnectDelayMs);
    progressReconnectDelayMs = Math.min(progressReconnectDelayMs * 2, PROGRESS_MAX_RECONNECT_DELAY_MS);
    updateStatusDot();
  });
```

In the `pickBtn` click handler, after `startPolling();`, add
`updateStatusDot();`:

```js
pickBtn.addEventListener("click", async () => {
  try {
    dirHandle = await pickFolder();
    reconnectBtn.style.display = "none";
    startPolling();
    updateStatusDot();
  } catch (e) {
    log("Folder selection cancelled or failed: " + e);
  }
});
```

In the `reconnectBtn` click handler, after `startPolling();` inside the
`granted === "granted"` branch, add `updateStatusDot();`:

```js
reconnectBtn.addEventListener("click", async () => {
  const handle = await idbGet("dirHandle");
  if (!handle) { log("No previously connected folder found."); return; }
  const granted = await handle.requestPermission({ mode: "readwrite" });
  if (granted === "granted") {
    dirHandle = handle;
    reconnectBtn.style.display = "none";
    startPolling();
    updateStatusDot();
  } else {
    log("Permission not granted.");
  }
});
```

At the end of the bottom IIFE (after its `if/else if/else` chain, so it
runs regardless of which branch the folder-restore took), add
`updateStatusDot();`:

```js
(async () => {
  const restored = await restoreFolder();
  if (restored === "needs-permission") {
    log("Previously connected folder needs permission again.");
    reconnectBtn.style.display = "inline-block";
  } else if (restored) {
    dirHandle = restored;
    startPolling();
  } else {
    log("Not connected. Click \"Choose game folder\" to select the folder containing boot.lua.");
  }
  updateStatusDot();
})();
```

- [ ] **Step 5: Wire the toggle buttons and restore collapsed state on load**

Add near the bottom of `pages/tracker/sync_relay.js`, right after the
existing `restoreProgressSettings();` / `connectProgressWs();` lines:

```js
document.getElementById("hidePanelBtn").addEventListener("click", () => setPanelCollapsed(true));
document.getElementById("reopenPanelBtn").addEventListener("click", () => setPanelCollapsed(false));
restorePanelCollapsed();
updateStatusDot();
```

- [ ] **Step 6: Manually verify in a browser**

Open `pages/tracker/sync_relay.html` in a browser. Expected on first
load (no `localStorage` entry yet): the connection panel (intro text,
Worker URL/room key fields, "Choose game folder" button) is visible, the
corner controls are hidden, and the status dot would be red if visible.
Click "Hide setup" — the panel disappears, a small circular gear button
appears in the top-right corner next to a red dot. Reload the page —
the panel stays hidden (collapsed state persisted). Click the corner
gear button — the panel reappears and the corner controls hide. Open
devtools console and run `localStorage.getItem("rmrSyncRelayPanelCollapsed")`
— confirm it reads `"1"` or `"0"` matching the current state.

- [ ] **Step 7: Commit**

```bash
git add pages/tracker/sync_relay.html pages/tracker/sync_relay.js
git commit -m "tracker: collapsible connection panel with corner toggle + status dot"
```

---

### Task 3: Armor overlay + row regroup

**Files:**
- Modify: `pages/tracker/sync_relay.html` (append `.armor-overlay`/
  `.armor-part` CSS)
- Modify: `pages/tracker/sync_relay.js` (`renderProgressGrid()`'s
  weapon/armor/sigma row construction)

**Interfaces:**
- Consumes: `layout.armor` (existing `team_progress_layout.js` field,
  `[[headPartId, headChipId], [armId, armChipId], [bodyId, bodyChipId],
  [footId, footChipId]]`), `isArmorSlotOwned(idPair)` (existing helper in
  `sync_relay.js`).
- Produces: `makeArmorOverlay(title, layout)`, not consumed elsewhere.

- [ ] **Step 1: Add the armor-overlay CSS**

Add to the end of the `<style>` block in `pages/tracker/sync_relay.html`:

```css
  .armor-overlay { position: relative; padding: 6%; aspect-ratio: 1; }
  .armor-overlay img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
  .armor-part { opacity: 0; transition: opacity 0.4s ease; }
  .armor-part.done { opacity: 1; }
```

(The container's own `padding: 6%` shrinks its padding box in by 6%
first; each absolutely-positioned child then sits at `inset: 0` relative
to that already-shrunk padding box, so the net inset is 6% once, matching
`.icon-cell`'s own single inset — not double-applied.)

- [ ] **Step 2: Add the `makeArmorOverlay` function**

Add to `pages/tracker/sync_relay.js`, right after `makeGaugeIcon` (added
in Task 1):

```js
const ARMOR_PART_NAMES = ["head", "arm", "body", "foot"];

function makeArmorOverlay(title, layout) {
  const cell = document.createElement("div");
  cell.className = "armor-overlay";
  const base = document.createElement("img");
  base.src = "assets/x.png";
  base.alt = "X";
  cell.appendChild(base);
  layout.armor.forEach((idPair, i) => {
    const partName = ARMOR_PART_NAMES[i];
    const part = document.createElement("img");
    part.src = `assets/x${title}_x_${partName}.png`;
    part.alt = partName;
    part.title = partName;
    part.className = "armor-part";
    if (isArmorSlotOwned(idPair)) {
      part.classList.add("done");
    }
    cell.appendChild(part);
  });
  return cell;
}
```

- [ ] **Step 3: Regroup the weapon/armor/sigma rows**

In `renderProgressGrid()`, replace the existing `weaponRow`, `armorRow`,
and `sigmaRow` construction (everything from `const weaponRow = ...`
through `section.appendChild(sigmaRow);`) with:

```js
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
    for (const itemId of layout.subtankIds) {
      const info = getIconInfoForId(itemId);
      sigmaRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
    }
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

This removes the separate `armorRow` variable entirely (its 4 armor icons
are replaced by the one `makeArmorOverlay` cell prepended to `weaponRow`;
its subtank icons move into `sigmaRow`), and moves the super-weapon icon
out of `weaponRow` into `sigmaRow` (matching the reference tracker's own
grouping — see the spec's section 2, row 2 vs row 3). Subtank icons still
render individually here for now — Task 4 removes this loop when the
gauge row takes over subtank display.

- [ ] **Step 4: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
mergedItems = new Array(96).fill(0);
mergedItems[11] = 0x01; // id 88, 1ItHeadPart
mergedItems[11] |= 0x04; // id 90, 1ItArmPart
renderProgressGrid();
```

Expected: the X1 panel's weapon row now starts with a single cell showing
the unarmored X sprite with the head and arm pieces visibly drawn on top
of it in full color (not grayscale), while the body and foot remain
invisible (fully transparent, showing just the base X underneath, since
`.armor-part` without `.done` is `opacity: 0`). The rest of the weapon row
(8 weapon icons) follows immediately after this one cell, and the
super-weapon icon has moved down into the row that also has subtank
icons, sigma-key checks, and the game-clear icon.

- [ ] **Step 5: Commit**

```bash
git add pages/tracker/sync_relay.html pages/tracker/sync_relay.js
git commit -m "tracker: composite armor overlay replacing 4 separate part icons"
```

---

### Task 4: Gauge row (sigma-key, subtank, HP, energy, buster tiers)

**Files:**
- Modify: `pages/tracker/team_progress_layout.js` (add `gauges` field to
  all 3 titles)
- Modify: `pages/tracker/sync_relay.js` (`renderGaugeCell` helper, wire
  the new row into `renderProgressGrid()`, remove the now-redundant
  subtank loop from `sigmaRow`)

**Interfaces:**
- Consumes: `isItemOwned(itemId)` (existing helper), `makeGaugeIcon` (from
  Task 1).
- Produces: `layout.gauges` (new field other tasks don't need),
  `renderGaugeCell(gauge)` (new function, not consumed elsewhere).

- [ ] **Step 1: Add `gauges` to each title's `team_progress_layout.js` entry**

In `pages/tracker/team_progress_layout.js`, add a `gauges` field to each
of the 3 title objects, right after that title's `subtankIds` line. For
title `1` (after the `subtankIds: [36, 37, 38, 39],` line):

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76] },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29] },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [36, 37, 38, 39] },
      { file: "assets/b.png", label: "Buster ammo capacity", ids: [96, 97, 98, 99, 100] },
      { file: "assets/ba.png", label: "Buster attack power", ids: [101, 102] },
      { file: "assets/br.png", label: "Buster fire rate", ids: [104, 105, 106, 107, 108, 109] },
      { file: "assets/bd.png", label: "Dash shot capacity", ids: [110, 111] },
      { file: "assets/bc.png", label: "Charge speed", ids: [112, 113, 114, 115] },
    ],
```

For title `2` (after `subtankIds: [292, 293, 294, 295],`):

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332] },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269] },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285] },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [292, 293, 294, 295] },
      { file: "assets/b.png", label: "Buster ammo capacity", ids: [352, 353, 354, 355, 356] },
      { file: "assets/ba.png", label: "Buster attack power", ids: [357, 358] },
      { file: "assets/br.png", label: "Buster fire rate", ids: [360, 361, 362, 363, 364, 365] },
      { file: "assets/bd.png", label: "Dash shot capacity", ids: [366, 367] },
      { file: "assets/bc.png", label: "Charge speed", ids: [368, 369, 370, 371] },
    ],
```

For title `3` (after `subtankIds: [548, 549, 550, 551],`):

```js
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589] },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525] },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541] },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [548, 549, 550, 551] },
      { file: "assets/b.png", label: "Buster ammo capacity", ids: [608, 609, 610, 611, 612] },
      { file: "assets/ba.png", label: "Buster attack power", ids: [613, 614] },
      { file: "assets/br.png", label: "Buster fire rate", ids: [616, 617, 618, 619, 620, 621] },
      { file: "assets/bd.png", label: "Dash shot capacity", ids: [622, 623] },
      { file: "assets/bc.png", label: "Charge speed", ids: [624, 625, 626, 627] },
    ],
```

- [ ] **Step 2: Add `renderGaugeCell` and add the CSS grid row for it**

Add to `pages/tracker/sync_relay.js`, right after `makeArmorOverlay`
(added in Task 3):

```js
function renderGaugeCell(gauge) {
  const count = gauge.ids.filter(isItemOwned).length;
  return makeGaugeIcon(gauge.file, gauge.label, `${count}/${gauge.ids.length}`);
}
```

- [ ] **Step 3: Remove the subtank loop from `sigmaRow`; add the gauge row**

In `renderProgressGrid()`, remove this loop from the `sigmaRow`
construction added in Task 3 (it's now redundant — subtank ownership is
shown by the `gauges` row's "Subtanks collected" cell instead):

```js
    for (const itemId of layout.subtankIds) {
      const info = getIconInfoForId(itemId);
      sigmaRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
    }
```

Immediately after `section.appendChild(sigmaRow);`, add:

```js
    const gaugeRow = document.createElement("div");
    gaugeRow.className = "icon-grid";
    for (const gauge of layout.gauges) {
      gaugeRow.appendChild(renderGaugeCell(gauge));
    }
    section.appendChild(gaugeRow);
```

- [ ] **Step 4: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
mergedItems = new Array(96).fill(0);
mergedItems[8] = 0b00000111; // ids 64,65,66 -- 3 of X1's 13 sigma keys
mergedItems[4] = 0x10; // id 36, 1ItSubtank1 -- 1 of X1's 4 subtanks
renderProgressGrid();
```

Expected: the X1 panel no longer shows individual subtank icons next to
the sigma-fortress checks; instead, a new row of 9 icons appears after
that row, and its first cell (sigma key icon) shows "3/13", its 4th cell
(subtank icon) shows "1/4", and every other cell (life-up, energy-up, and
the 5 buster-tier icons) shows "0/N" for that category's size.

- [ ] **Step 5: Commit**

```bash
git add pages/tracker/team_progress_layout.js pages/tracker/sync_relay.js
git commit -m "tracker: add sigma-key/subtank/HP/energy/buster gauge row"
```

---

### Task 5: X2 Zero armor, X3 ride armor & sub-bosses

**Files:**
- Modify: `pages/tracker/icon_map.js:92-96` (fix the Zero-armor sprite
  lookup)
- Modify: `pages/tracker/team_progress_layout.js` (add `zeroIds` to title
  2, `rideArmorIds`/`subbossCheckIds` to title 3)
- Modify: `pages/tracker/sync_relay.js` (`renderProgressGrid()`: render a
  5th, title-conditional row)

**Interfaces:**
- Consumes: `getIconInfoForId`/`isItemOwned` (existing, for
  `zeroIds`/`rideArmorIds`), `getCheckIconInfoForId`/`isTeamCheckDone`
  (existing, for `subbossCheckIds`).
- Produces: nothing new consumed by other tasks — this is the last task.

- [ ] **Step 1: Fix the Zero-armor icon lookup in `icon_map.js`**

In `pages/tracker/icon_map.js`, replace the existing `zeroPartMatch`
block (lines 92-96):

```js
  const zeroPartMatch = idString.match(/^2ItZero(Head|FHead|Body|Foot)$/);
  if (zeroPartMatch) {
    const part = zeroPartMatch[1] === "FHead" ? "head" : PART_ASSET_NAMES[zeroPartMatch[1]] || zeroPartMatch[1].toLowerCase();
    return { file: `assets/x2_x_${part}.png`, label };
  }
```

with:

```js
  const zeroPartMatch = idString.match(/^2ItZero(Head|FHead|Body|Foot)$/);
  if (zeroPartMatch) {
    const part = zeroPartMatch[1] === "FHead" ? "head" : zeroPartMatch[1].toLowerCase();
    return { file: `assets/x2_zero_${part}.ico`, label };
  }
```

(Previously this borrowed X's own body-part sprites — `assets/x2_x_head.png`
etc., the same files the armor overlay uses — as a placeholder. The real
`x2_zero_{head,body,foot}.ico` assets now exist in `pages/tracker/assets/`,
copied from the reference tracker during spec-writing.)

- [ ] **Step 2: Add `zeroIds` to title 2 in `team_progress_layout.js`**

Add to title `2`'s object in `pages/tracker/team_progress_layout.js`,
right after its `gauges` field (added in Task 4):

```js
    zeroIds: [313, 314, 312], // 2ItZeroFHead, 2ItZeroBody, 2ItZeroFoot -- head/body/foot order
```

- [ ] **Step 3: Add `rideArmorIds`/`subbossCheckIds` to title 3**

Add to title `3`'s object in `pages/tracker/team_progress_layout.js`,
right after its `gauges` field (added in Task 4):

```js
    rideArmorIds: [599, 598, 597, 596], // 3ItRideArmorF/H/K/N, F/H/K/N order
    subbossCheckIds: [750, 751, 761], // 3ChVajurilaFF, 3ChMandarelaBB, 3ChVAClear
```

- [ ] **Step 4: Render the title-specific 5th row**

In `renderProgressGrid()`, immediately after the gauge-row block added in
Task 4 (after `section.appendChild(gaugeRow);`), add:

```js
    if (layout.zeroIds || layout.rideArmorIds || layout.subbossCheckIds) {
      const extraRow = document.createElement("div");
      extraRow.className = "icon-grid";
      for (const itemId of layout.zeroIds || []) {
        const info = getIconInfoForId(itemId);
        extraRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
      }
      for (const itemId of layout.rideArmorIds || []) {
        const info = getIconInfoForId(itemId);
        extraRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
      }
      for (const checkId of layout.subbossCheckIds || []) {
        const info = getCheckIconInfoForId(checkId);
        extraRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
      }
      section.appendChild(extraRow);
    }
```

- [ ] **Step 5: Manually verify in a browser**

Open `pages/tracker/sync_relay.html`, open devtools console, and run:

```js
mergedItems = new Array(96).fill(0);
mergedItems[39] = 0x04; // id 314, 2ItZeroBody
mergedItems[74] = 0x80; // id 599, 3ItRideArmorF
teamChecks = [750]; // 3ChVajurilaFF
renderProgressGrid();
```

Expected: **only** the X2 panel gets a new row below its gauge row, with
3 icons (Zero head/body/foot in that order) — the middle one (body) in
full color, the other two grayscale. **Only** the X3 panel gets a new row
with 4 ride-armor icons (F/H/K/N order — the first, F, in full color) + 3
sub-boss icons (Vajurila/Mandarela/Vava order — the first, Vajurila, in
full color). The X1 panel gets no 5th row at all (it has no
`zeroIds`/`rideArmorIds`/`subbossCheckIds`).

- [ ] **Step 6: Commit**

```bash
git add pages/tracker/icon_map.js pages/tracker/team_progress_layout.js pages/tracker/sync_relay.js
git commit -m "tracker: add X2 Zero armor and X3 ride armor/sub-boss rows"
```

---

## Final whole-branch check

After all 5 tasks: open `pages/tracker/sync_relay.html` in a browser with
no console overrides (a clean load). Confirm: dark theme throughout,
connection panel visible by default with a working "Hide setup" toggle,
all 3 title panels render their full row sequence (boss row, armor
-overlay+weapon row, sigma+super+clear row, 9-cell gauge row, and — for
X2/X3 only — the title-specific extras row) with no console errors.
