# Team Progress Grid Visual Redesign

## Context

`pages/tracker/sync_relay.html` gained a "Team progress" grid in the
team-progress-tracker work (now merged to master): a per-title panel showing
boss/weapon/armor/sigma icons as a flat, grayscale-vs-color `icon-row` of
`<img>` tags, plus a plain white page with sans-serif text and bare `<input>`
fields for the Worker URL/room key and a "Choose game folder" button always
visible above the grid. It works, but reads as a debug page, not something
you'd want on screen while playing: (1) the connection controls are always
there even once everything is already connected and working, (2) the visual
language is generic (no theming, flat icon rows, no sense of "equipment"),
and (3) armor pieces show as four separate small icons rather than showing
them worn on the character, which is how a player actually recognizes "do I
have the head part" at a glance.

`ref/RMR_progress_tracker_displayer_ver_js_20260126/` is a separate,
pre-existing community tool (by f6bfb5 and fsworld009, source at
github.com/fsworld009/rockman-x-route-matrix-randomizer-progress-displayer,
branch `feat/integrate-tracker-js`) that already solves all three problems,
built as a SolidJS + Tailwind OBS-overlay widget. Its source was cloned and
read for this design (not guessed from the minified bundle we have locally
in `ref/`). Relevant confirmed techniques, from its actual source:

- **Armor overlay** (`src/component/Common.tsx`): a `position: relative`
  div holds the base unarmored `x.png`, then each owned armor slot renders
  as a `position: absolute; inset: 0` image of just that part, conditionally
  shown. All of this project's own part sprites
  (`pages/tracker/assets/x{1,2,3}_x_{head,arm,body,foot}.png`) are already
  the same 30x34 canvas size as the shared `assets/x.png` base (verified via
  PNG header inspection), so they were clearly authored as overlays already
  — this technique drops in directly with no new assets needed.
- **Grid/panel styling** (`src/component/GridContainer.tsx`,
  `src/index.css`): a plain CSS grid (`grid-template-columns: repeat(9,
  1fr)`) per section, each section wrapped in a `2px solid white`,
  `border-radius: 5px` panel. Each icon sits in a padded, `aspect-square`
  cell with `object-contain`, rounded corners, and a `grayscale` filter
  toggled off once owned, with a CSS `transition` so the swap isn't an
  instant snap.
- **Counter overlay** (`src/component/Miscellaneous.tsx`, `Text.tsx`): the
  deaths/IFG counters render as a number centered directly on top of the
  icon (absolute-positioned, flex-centered), styled with a thick white
  outline via a 13-point stacked `text-shadow` (a cheap, pure-CSS "pixel
  HUD numeral" look) on black text.

Two things from the reference are deliberately **not** being copied:
- It loads its pixel fonts (`MuzaiPixel`, `FusionPixelFont12pxMono`) from an
  external CDN (`font.emtech.cc`). This project has zero external runtime
  dependencies anywhere (every other tracker page is plain inline
  `<style>`/`<script>`, no CDN, no build step) and `sync_relay.html` needs
  to keep working reliably for a player who may not have a reliable third
  -party CDN available mid-session. The counter numerals use the same
  outlined-numeral CSS technique but with a local monospace font stack
  instead.
- It targets a transparent background for OBS compositing over gameplay
  footage. `sync_relay.html` is a normal browser tab, not a stream overlay,
  so it gets a dark solid background instead of transparency — everything
  else (borders, grid, icon treatment) carries over unchanged. If this page
  is later added as an OBS Browser Source, OBS's own per-source "Custom
  CSS" field can override `body`'s background to transparent for
  compositing, without needing a second variant of this page — not part of
  this redesign, but worth remembering when that's set up.
- Its "unlock" animation (a spinning/scaling padlock icon via the
  `solid-motionone` library) is not reproduced — that's a JS animation
  library dependency for a flourish this project doesn't otherwise have.
  The grayscale-to-color CSS transition alone communicates the state change.

## Goals

1. The connection/setup controls (Worker URL + room key inputs, "Choose
   game folder" button, status text) can be fully hidden, leaving only the
   team-progress grid on screen.
2. The grid's visual language (panel borders, grid layout, icon treatment,
   counter styling) matches the reference tracker's actual technique as
   closely as practical without adopting Tailwind or a CDN font dependency.
3. Each title's armor row shows one composite character sprite (unarmored
   X + owned parts layered on top) instead of four separate small icons.

## Design

### 1. Collapsible connection panel

- A "Hide setup" text link/button sits at the top of the connection
  section (covering both the "Team progress" Worker URL/room key inputs
  and the "Game connection" folder button + status). Clicking it hides
  that whole block, leaving just the `<h1>` title and the grid.
- When collapsed, a small circular icon button appears fixed in the
  top-right corner. Hovering it doesn't do anything by itself in terms of
  layout (no separate "peek" state) — clicking it re-shows the full
  connection section. This matches how the user described it: a manual
  toggle, with a corner icon as the way back in.
- The collapsed/expanded state persists across reloads via
  `localStorage` (new key `rmrSyncRelayPanelCollapsed`, `"1"`/`"0"`),
  the same pattern already used for the Worker URL/room key fields
  (`PROGRESS_WORKER_URL_KEY`/`PROGRESS_ROOM_KEY_KEY` in `sync_relay.js`).
  Default (key absent) is expanded, so a first-time user always sees the
  inputs.
- A small status dot (green = both folder + progress WS connected, amber
  = progress WS connected but no folder, red = nothing connected) sits
  next to the corner toggle icon even while collapsed, so a dropped
  connection is still visible without reopening the panel.

### 2. Visual restyle

New page-level tokens (plain CSS custom properties on `:root`, no
framework):

```css
:root {
  --bg: #14141a;
  --panel-bg: #1c1c24;
  --panel-border: #ffffff;
  --text: #e8e8ec;
  --text-dim: #9a9aa4;
}
```

- `body` gets `background: var(--bg); color: var(--text);` and a system
  sans-serif stack (unchanged font otherwise — only the counter numerals
  get a special treatment, see below).
- Each title section (`.title-panel`) keeps its current role but is
  restyled to `border: 2px solid var(--panel-border); border-radius: 5px;
  background: var(--panel-bg);` matching the reference's `section-border`
  class exactly on the border/radius values.
- Icon rows become CSS grid instead of flex-wrap:
  `display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap:
  4px;`. Each title gets three such grids in sequence (mirroring the
  reference's three `GridContainer` blocks, adapted to this project's own
  data — it doesn't track buster/HP/energy consumables the way the
  reference does, so those rows are simply omitted rather than padded
  with unused cells):
  1. Opening check icon + 8 boss check icons (9 cells).
  2. Armor overlay (1 cell, see below) + 8 weapon icons (9 cells).
  3. 4 subtank icons + this title's sigma-key checks + the super weapon
     icon + the game-clear check icon (count varies 9-11 by title since
     X2/X3 have more sigma keys than X1 — the grid simply wraps to a
     second row for those titles; no special-casing needed).
- Each icon cell: `padding: 6%; aspect-ratio: 1;` wrapping an `<img>` with
  `width/height: 100%; object-fit: contain; border-radius: 4px; transition:
  filter 0.4s ease, opacity 0.4s ease;`. Not-owned keeps this project's
  existing `grayscale(100%) brightness(0.55); opacity: 0.45;` (kept as-is
  rather than switched to the reference's grayscale-only treatment,
  since this project isn't reproducing the reference's padlock-icon
  flourish that normally reinforces the "locked" read — the extra dimming
  does that job instead here).
- Deaths/IFG counters: the icon and its live count share one relative cell,
  the count centered directly on the icon via
  `position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center;`, styled with:

  ```css
  .hud-number {
    font-family: "Courier New", ui-monospace, monospace;
    font-weight: 700;
    font-size: 1.1em;
    color: #000;
    text-shadow:
      2px 0 0 #fff, 1.76px 0.96px 0 #fff, 1.08px 1.68px 0 #fff,
      0.14px 1.99px 0 #fff, -0.83px 1.82px 0 #fff, -1.6px 1.2px 0 #fff,
      -1.98px 0.28px 0 #fff, -1.87px -0.7px 0 #fff, -1.31px -1.51px 0 #fff,
      -0.42px -1.96px 0 #fff, 0.57px -1.92px 0 #fff, 1.42px -1.41px 0 #fff,
      1.92px -0.56px 0 #fff;
  }
  ```

  (the same 13-point stacked-shadow outline technique as the reference's
  `Text.tsx`, values carried over unchanged since it's pure geometry, not
  tied to their specific font).

### 3. Armor overlay

Per title, `layout.armor` in `team_progress_layout.js` already stores
`[[headPartId, headChipId], [armPartId, armChipId], [bodyPartId,
bodyChipId], [footPartId, footChipId]]` in head/arm/body/foot order — no
data changes needed. `renderProgressGrid()` in `sync_relay.js` builds one
armor cell per title as:

```html
<div class="armor-overlay">
  <img src="assets/x.png" class="armor-base" alt="X" />
  <img src="assets/x{title}_x_head.png" class="armor-part{ done ? ' done' : '' }" />
  <img src="assets/x{title}_x_arm.png"  class="armor-part{ done ? ' done' : '' }" />
  <img src="assets/x{title}_x_body.png" class="armor-part{ done ? ' done' : '' }" />
  <img src="assets/x{title}_x_foot.png" class="armor-part{ done ? ' done' : '' }" />
</div>
```

with:

```css
.armor-overlay { position: relative; aspect-ratio: 1; padding: 6%; }
.armor-overlay img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.armor-part { opacity: 0; transition: opacity 0.4s ease; }
.armor-part.done { opacity: 1; }
```

(the container's own `padding: 6%` shrinks its padding box in by 6% first;
each absolutely-positioned child then sits at `inset: 0` relative to that
already-shrunk padding box, so the net inset is 6% once, matching every
other icon cell — not double-applied.)

`isArmorSlotOwned(idPair)` (already implemented, checks either the Part or
Chip id) decides each part image's `done` class, exactly the same
ownership rule already used for today's 4-icon armor row — only the
rendering changes, not the ownership logic. The 4 subtank icons keep
rendering as their own separate small icons immediately after the armor
cell in the same grid row, unchanged from today.

## Files changed

- `pages/tracker/sync_relay.html` — full `<style>` rewrite (dark theme,
  grid tokens, armor-overlay/hud-number classes, collapse toggle markup),
  small markup change wrapping the connection controls in a collapsible
  container plus the corner toggle button.
- `pages/tracker/sync_relay.js` — `renderProgressGrid()` rewritten to
  build three grids per title (rather than four flat icon-rows) with the
  armor composite cell; new small module for the collapse-toggle
  behavior (read/write `rmrSyncRelayPanelCollapsed`, wire the "Hide
  setup"/corner-icon buttons, drive the status dot's color from existing
  connection state).
- `pages/tracker/team_progress_layout.js` — unchanged (existing armor
  id-pair ordering already fits the overlay technique directly).

## Non-goals

- No changes to `worker/` or `lua/` — this is a pure client-side rendering
  change; the data already flowing into `sync_relay.js` (teamChecks,
  mergedItems, totalDeaths, totalIfgUses) is unchanged.
- Not reproducing the reference tracker's buster-ammo/attack/fire-rate/
  charge-tier tracking, its Zero-armor tracking (X2), its ride-armor/
  sub-boss tracking (X3), or its per-language translation tables — this
  project's own team-progress feature was scoped to checks/items/deaths/
  IFG only, and this redesign only restyles that existing scope.
- No automated tests — consistent with this project's existing convention
  that `pages/tracker/*` (browser-only UI) has no test suite; verified via
  manual browser testing instead.
