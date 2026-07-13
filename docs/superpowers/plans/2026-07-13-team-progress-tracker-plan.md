# Team Progress Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Durable Object a persistent, room-wide view of which bosses/stages the team has cleared and how many total deaths/IFG-uses have happened, and surface it as a visual grid in `sync_relay.html` — without ever writing any of this back into a player's own game state.

**Architecture:** Extends the existing `/event` and `/sync` wire protocol (no new HTTP endpoints) with two dedicated additive fields (`deathDelta`/`ifgDelta`) alongside the existing `items`/`checks` fields. `worker/src/room.js`'s Durable Object accumulates a persistent `teamChecks` id list and `totalDeaths`/`totalIfgUses` counters, broadcasting them over the same WebSocket `event_feed.html` already uses. `sync_relay.html` gains its own WebSocket connection (independent of its existing outbox/inbox file relay) to receive this state and render a grid modeled on `ref/RMR_progress_tracker_displayer_ver_js_20260126`.

**Tech Stack:** Cloudflare Workers + Durable Objects (vanilla JS, `vitest` + `@cloudflare/vitest-pool-workers`), BizHawk Lua 5.3+ (`lua/test/*_test.lua`, run via plain `lua` interpreter), vanilla browser JS/HTML/CSS (no build step, no bundler, no test framework — this project's established convention for `pages/tracker/*` is manual browser verification, not automated tests; see Global Constraints).

## Global Constraints

- **Design spec is authoritative**: `docs/superpowers/specs/2026-07-13-team-progress-tracker-design.md`. Every task below implements a specific numbered decision from it — read the referenced decision if a task's rationale is unclear.
- **`sessionSave.checks` is never written back to game state.** No task in this plan adds a `msg.sync` field, a `writeChecks()`-style function, or any Lua code path that reads `teamChecks`/`totalDeaths`/`totalIfgUses` back from the network. If you find yourself about to do this, stop — it contradicts the spec's core constraint.
- **`pages/tracker/*.js` has no automated test suite in this project** (confirmed: no test file anywhere references `event_feed.js`, `icon_map.js`, `check_lookup.js`, or `sync_relay.js`). Tasks touching these files specify **manual browser verification** steps instead of `- [ ] Run test` steps — this matches the project's established convention, it is not a shortcut.
- **Worker tests**: `cd worker && npm test` (runs `vitest run` twice, once per config). **Lua tests**: `cd lua && lua test/share_logic_test.lua` and `lua test/file_relay_test.lua` (each prints `ALL PASS` on success, `error()`s on the first failed assertion).
- **Event id numbering**: real item/check ids occupy `0-767`; synthetic game-clear ids occupy `900-903`. `teamChecks` must be able to hold ids up to `903` — **do not** model it as a 96-byte bit-packed array (that only covers ids `0-767`, silently truncating the game-clear ids). Task 1 uses a plain deduplicated array of ids instead.
- **Do not touch** `worker/src/index.js`, `worker/src/cors.js`, `worker/src/shareCategories.js`, `pages/admin/host_admin.html`, or `handleStatus()`'s existing response shape — none of them are in scope for this feature (see spec's Non-goals), and several existing tests assert `handleStatus()`'s exact response object with `toEqual`.
- **New branch**: per the user's explicit request, all work in this plan happens on a new branch (not `master`) — see the "Branch setup" step below, done once before Task 1.
- Never run `npx wrangler deploy` as part of this plan — deployment is a manual step the user takes after reviewing and merging, same as every prior feature this session.

## Branch setup (once, before Task 1)

```bash
git checkout -b team-progress-tracker
```

(Use `superpowers:using-git-worktrees` if working in an isolated worktree; otherwise a plain branch checkout is sufficient — this matches how the earlier items-merge feature was branched.)

---

### Task 1: Worker — persistent `teamChecks`/`totalDeaths`/`totalIfgUses` state + validation

**Files:**
- Modify: `worker/src/room.js:100-118` (`handleInit`), `worker/src/room.js:134-158` (`handleReset`)
- Modify: `worker/src/validation.js`
- Test: `worker/test/room-admin.test.js`, `worker/test/validation.test.js`

**Interfaces:**
- Produces: DO storage keys `teamChecks` (array of integer ids, e.g. `[240, 245, 900]`, initialized `[]`), `totalDeaths` (integer, initialized `0`), `totalIfgUses` (integer, initialized `0`) — read by Task 2 and Task 3.
- Produces: `validation.js` exports `isValidDeathDelta(value)`, `isValidIfgDelta(value)` — consumed by Task 2's `validateEventBody`.

- [ ] **Step 1: Write the failing tests**

Add to `worker/test/validation.test.js` (new `describe` blocks, anywhere after the existing `isValidGameClearTime` block):

```js
describe("isValidDeathDelta", () => {
  it("accepts undefined and integers from 1 to 50", () => {
    expect(isValidDeathDelta(undefined)).toBe(true);
    expect(isValidDeathDelta(1)).toBe(true);
    expect(isValidDeathDelta(50)).toBe(true);
  });

  it("rejects zero, negative, non-integer, over-50, and non-number values", () => {
    expect(isValidDeathDelta(0)).toBe(false);
    expect(isValidDeathDelta(-1)).toBe(false);
    expect(isValidDeathDelta(1.5)).toBe(false);
    expect(isValidDeathDelta(51)).toBe(false);
    expect(isValidDeathDelta("1")).toBe(false);
    expect(isValidDeathDelta(null)).toBe(false);
  });
});

describe("isValidIfgDelta", () => {
  it("accepts undefined and integers from 1 to 50", () => {
    expect(isValidIfgDelta(undefined)).toBe(true);
    expect(isValidIfgDelta(1)).toBe(true);
    expect(isValidIfgDelta(50)).toBe(true);
  });

  it("rejects zero, negative, non-integer, and over-50 values", () => {
    expect(isValidIfgDelta(0)).toBe(false);
    expect(isValidIfgDelta(-1)).toBe(false);
    expect(isValidIfgDelta(51)).toBe(false);
  });
});
```

Update the import line at the top of `worker/test/validation.test.js` to add `isValidDeathDelta, isValidIfgDelta`:

```js
import { isValidMode, isValidChecksSeenArray, isValidItemsArray, validateEventBody, isValidAdminSecret, isValidEpoch, isValidShareFlags, isValidGameClearTime, isValidDeathDelta, isValidIfgDelta } from "../src/validation.js";
```

Add to the existing `describe("validateEventBody", ...)` block in the same file (after the `"rejects a malformed gameClearTime"` test):

```js
  it("accepts a body with only a deathDelta or only an ifgDelta", () => {
    expect(validateEventBody({ player: "a", game: 1, deathDelta: 1 })).toBeNull();
    expect(validateEventBody({ player: "a", game: 1, ifgDelta: 3 })).toBeNull();
  });

  it("rejects an out-of-range deathDelta or ifgDelta", () => {
    expect(validateEventBody({ player: "a", game: 1, deathDelta: 0 })).toMatch(/deathDelta/);
    expect(validateEventBody({ player: "a", game: 1, ifgDelta: 51 })).toMatch(/ifgDelta/);
  });
```

Add to `worker/test/room-admin.test.js`'s existing `describe("RoomDO admin lifecycle", ...)` block (after `"resets checksSeen and events but keeps mode..."`):

```js
  it("initializes teamChecks/totalDeaths/totalIfgUses to empty/zero on creation", async () => {
    const stub = getStub("test-room-progress-init-1");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "s3cr3t" });
    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true }));
    expect(initMsg.teamChecks).toEqual([]);
    expect(initMsg.totalDeaths).toBe(0);
    expect(initMsg.totalIfgUses).toBe(0);
    ws.close();
  });
```

(This test also exercises Task 3's WebSocket `init` extension — it's written now, before either exists, and will fail for both reasons until Tasks 1 and 3 are both done. That's expected: run it again after Task 3.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd worker && npm test
```

Expected: `isValidDeathDelta`/`isValidIfgDelta` tests fail with "is not a function" (not exported yet). The `room-admin.test.js` teamChecks test fails with `initMsg.teamChecks` being `undefined` (not `[]`).

- [ ] **Step 3: Implement `isValidDeathDelta`/`isValidIfgDelta` in `worker/src/validation.js`**

Add after `isValidGameClearTime` (around line 48):

```js
// Death/IFG-use counts: always additive and always real (share_info.lua only
// reports when the underlying RAM counter increases -- see design spec
// decision 3), so unlike items/checks there's no dedup concern here. The
// upper bound guards against a garbled client claiming an implausible single
// jump, not against legitimate repeated small deltas.
function isValidPositiveDelta(value) {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= 50);
}
export function isValidDeathDelta(value) {
  return isValidPositiveDelta(value);
}
export function isValidIfgDelta(value) {
  return isValidPositiveDelta(value);
}
```

Update `validateEventBody` (replace the existing function body):

```js
export function validateEventBody(body) {
  if (typeof body !== "object" || body === null) {
    return "body must be an object";
  }
  if (typeof body.player !== "string" || body.player.trim().length === 0 || body.player.length > 32) {
    return "player must be a non-empty string up to 32 characters";
  }
  if (!Number.isInteger(body.game) || body.game < 1 || body.game > 3) {
    return "game must be an integer between 1 and 3";
  }
  const hasItems = body.items !== undefined;
  const hasChecks = body.checks !== undefined;
  const hasDeathDelta = body.deathDelta !== undefined;
  const hasIfgDelta = body.ifgDelta !== undefined;
  if (!hasItems && !hasChecks && !hasDeathDelta && !hasIfgDelta) {
    return "body must include at least one of items, checks, deathDelta, or ifgDelta";
  }
  if (hasItems && !isValidIdArray(body.items)) {
    return "items must be a non-empty array of up to 20 integer ids between 0 and 999";
  }
  if (hasChecks && !isValidIdArray(body.checks)) {
    return "checks must be a non-empty array of up to 20 integer ids between 0 and 999";
  }
  if (!isValidGameClearTime(body.gameClearTime)) {
    return "gameClearTime must be an H:MM:SS string";
  }
  if (!isValidDeathDelta(body.deathDelta)) {
    return "deathDelta must be an integer between 1 and 50";
  }
  if (!isValidIfgDelta(body.ifgDelta)) {
    return "ifgDelta must be an integer between 1 and 50";
  }
  return null;
}
```

- [ ] **Step 4: Add `teamChecks`/`totalDeaths`/`totalIfgUses` lifecycle to `handleInit`/`handleReset` in `worker/src/room.js`**

In `handleInit` (around line 109-116), add three lines after the existing `mergedItems` init:

```js
    await this.state.storage.put("mode", body.mode);
    await this.state.storage.put("adminSecret", body.adminSecret);
    await this.state.storage.put("resetEpoch", 0);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("teamChecks", []);
    await this.state.storage.put("totalDeaths", 0);
    await this.state.storage.put("totalIfgUses", 0);
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
```

In `handleReset` (around line 151-154), same three lines after the existing `mergedItems` reset:

```js
    await this.state.storage.put("mode", newMode);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("teamChecks", []);
    await this.state.storage.put("totalDeaths", 0);
    await this.state.storage.put("totalIfgUses", 0);
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
```

(`handleDelete`'s existing `storage.deleteAll()` already wipes these — no change needed there.)

- [ ] **Step 5: Run tests to verify `validation.test.js` passes (the `room-admin.test.js` teamChecks test still fails — expected, needs Task 3)**

```bash
cd worker && npx vitest run test/validation.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/validation.js worker/src/room.js worker/test/validation.test.js worker/test/room-admin.test.js
git commit -m "worker: add teamChecks/totalDeaths/totalIfgUses storage lifecycle and delta validation"
```

---

### Task 2: Worker — `handleEvent` merges checks/deltas into persistent state, broadcasts progress

**Files:**
- Modify: `worker/src/room.js:218-288` (`handleEvent`)
- Test: `worker/test/room-event.test.js`

**Interfaces:**
- Consumes: `teamChecks`/`totalDeaths`/`totalIfgUses` storage keys from Task 1; `isValidDeathDelta`/`isValidIfgDelta` (already wired into `validateEventBody`, no direct import needed here).
- Produces: `broadcastProgress()` method on `RoomDO`, broadcasting `{type: "progress", teamChecks, mergedItems, totalDeaths, totalIfgUses}` — consumed by Task 3 (`handleSync`) and by the new tracker WebSocket client in Task 10.

- [ ] **Step 1: Write the failing tests**

Add to `worker/test/room-event.test.js` (new `describe` block at the end of the file):

```js
describe("RoomDO /event -- death/IFG deltas accumulate into persistent totals", () => {
  it("accepts a deathDelta-only event and adds it to totalDeaths", async () => {
    const stub = getStub("test-room-progress-death-1");
    await initRoom(stub, "checksSeen");
    const res = await postEvent(stub, { player: "a", game: 1, deathDelta: 1 });
    expect(res.status).toBe(200);

    const backlog = await getBacklog(stub);
    expect(backlog[0].deathDelta).toBe(1);
  });

  it("accepts an ifgDelta-only event and adds it to totalIfgUses", async () => {
    const stub = getStub("test-room-progress-ifg-1");
    await initRoom(stub, "checksSeen");
    const res = await postEvent(stub, { player: "a", game: 1, ifgDelta: 2 });
    expect(res.status).toBe(200);

    const backlog = await getBacklog(stub);
    expect(backlog[0].ifgDelta).toBe(2);
  });

  it("sums multiple deathDelta reports across players into one running total, visible via WS init", async () => {
    const stub = getStub("test-room-progress-death-2");
    await initRoom(stub, "checksSeen");
    await postEvent(stub, { player: "a", game: 1, deathDelta: 1 });
    await postEvent(stub, { player: "b", game: 2, deathDelta: 3 });

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true }));
    expect(initMsg.totalDeaths).toBe(4);
    ws.close();
  });

  it("does not dedupe repeated deathDelta reports from the same player within the 15s window (unlike checks/items)", async () => {
    const stub = getStub("test-room-progress-death-3");
    await initRoom(stub, "checksSeen");
    await postEvent(stub, { player: "a", game: 1, deathDelta: 1 });
    await postEvent(stub, { player: "a", game: 1, deathDelta: 1 });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(2); // both logged, neither treated as a duplicate
  });

  it("OR-merges newly-completed check ids into the persistent teamChecks list", async () => {
    const stub = getStub("test-room-progress-checks-1");
    await initRoom(stub, "checksSeen");
    await postEvent(stub, { player: "a", game: 1, checks: [245] });
    await postEvent(stub, { player: "b", game: 1, checks: [245, 900] });

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true }));
    expect(initMsg.teamChecks.sort((x, y) => x - y)).toEqual([245, 900]); // 245 only counted once
    ws.close();
  });

  it("broadcasts a progress message alongside the event message when a check/delta lands", async () => {
    const stub = getStub("test-room-progress-broadcast-1");
    await initRoom(stub, "checksSeen");

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    await new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true })); // discard init

    const messages = [];
    ws.addEventListener("message", (e) => messages.push(JSON.parse(e.data)));
    await postEvent(stub, { player: "a", game: 1, deathDelta: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(messages.some((m) => m.type === "event")).toBe(true);
    expect(messages.some((m) => m.type === "progress" && m.totalDeaths === 1)).toBe(true);
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd worker && npx vitest run test/room-event.test.js
```

Expected: all new tests fail — `deathDelta`/`ifgDelta` aren't stored on the event object yet, `teamChecks` isn't merged, no `"progress"` broadcast exists yet.

- [ ] **Step 3: Implement in `worker/src/room.js`**

Add a small merge helper near the top of the file, alongside `mergeIncomingItems` (after its closing `}` around line 54):

```js
// Cross-player union of event-check ids (boss defeats / stage clears /
// game-clears) into the room's persistent teamChecks list. Deliberately a
// plain deduplicated array, not a bit-packed byte array like
// checksSeen/mergedItems -- those only cover ids 0-767, but the synthetic
// game-clear ids go up to 903 (see design spec's Global Constraints).
function mergeIds(existingIds, newIds) {
  const set = new Set(existingIds);
  for (const id of newIds) {
    set.add(id);
  }
  return [...set].sort((a, b) => a - b);
}
```

Replace the body of `handleEvent` (lines 218-288) with:

```js
  async handleEvent(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    const validationError = validateEventBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    if (body.items !== undefined && mode !== "checksSeen+shared" && mode !== "checksSeen+items") {
      return jsonResponse({ error: "items sharing not enabled for this room" }, 403);
    }
    const now = Date.now();
    for (const [key, postedAt] of this.recentlyPosted) {
      if (now - postedAt > DUPLICATE_EVENT_WINDOW_MS) {
        this.recentlyPosted.delete(key);
      }
    }

    const dedupeNew = (ids, kind) =>
      (ids ?? []).filter((id) => {
        const key = `${body.player}::${kind}::${id}`;
        const lastPosted = this.recentlyPosted.get(key);
        if (lastPosted !== undefined && now - lastPosted <= DUPLICATE_EVENT_WINDOW_MS) {
          return false;
        }
        this.recentlyPosted.set(key, now);
        return true;
      });

    const newItems = dedupeNew(body.items, "item");
    const newChecks = dedupeNew(body.checks, "check");
    // deathDelta/ifgDelta are never deduped -- see design spec decision 3:
    // they're additive counters that legitimately repeat (dying twice in a
    // row), unlike one-time check/item completions.
    const deathDelta = body.deathDelta;
    const ifgDelta = body.ifgDelta;

    if (newItems.length === 0 && newChecks.length === 0 && deathDelta === undefined && ifgDelta === undefined) {
      return jsonResponse({ ok: true });
    }

    const events = (await this.state.storage.get("events")) ?? [];
    const event = { player: body.player, game: body.game, ts: now };
    if (newItems.length > 0) {
      event.items = newItems;
    }
    if (newChecks.length > 0) {
      event.checks = newChecks;
      if (body.gameClearTime !== undefined) {
        event.gameClearTime = body.gameClearTime;
      }
    }
    if (deathDelta !== undefined) {
      event.deathDelta = deathDelta;
    }
    if (ifgDelta !== undefined) {
      event.ifgDelta = ifgDelta;
    }
    events.push(event);
    const trimmed = events.slice(-MAX_EVENTS);
    await this.state.storage.put("events", trimmed);

    if (newChecks.length > 0) {
      const teamChecks = mergeIds((await this.state.storage.get("teamChecks")) ?? [], newChecks);
      await this.state.storage.put("teamChecks", teamChecks);
    }
    if (deathDelta !== undefined) {
      const totalDeaths = ((await this.state.storage.get("totalDeaths")) ?? 0) + deathDelta;
      await this.state.storage.put("totalDeaths", totalDeaths);
    }
    if (ifgDelta !== undefined) {
      const totalIfgUses = ((await this.state.storage.get("totalIfgUses")) ?? 0) + ifgDelta;
      await this.state.storage.put("totalIfgUses", totalIfgUses);
    }

    await this.scheduleExpiry();
    this.broadcast({ type: "event", event });
    await this.broadcastProgress();
    return jsonResponse({ ok: true });
  }

  // Current full team-progress snapshot, broadcast to every connected socket
  // whenever it changes (from handleEvent above, or from handleSync in Task
  // 3 when mergedItems changes) -- see design spec decision 4. A separate
  // message type from {type: "event", event} so event_feed.html's existing
  // "event"-only handling is completely unaffected.
  async broadcastProgress() {
    const teamChecks = (await this.state.storage.get("teamChecks")) ?? [];
    const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    const totalDeaths = (await this.state.storage.get("totalDeaths")) ?? 0;
    const totalIfgUses = (await this.state.storage.get("totalIfgUses")) ?? 0;
    this.broadcast({ type: "progress", teamChecks, mergedItems, totalDeaths, totalIfgUses });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd worker && npx vitest run test/room-event.test.js
```

Expected: all pass, including the pre-existing tests in this file (they should be unaffected).

- [ ] **Step 5: Commit**

```bash
git add worker/src/room.js worker/test/room-event.test.js
git commit -m "worker: merge checks/death/IFG deltas into persistent teamChecks/totals, broadcast progress"
```

---

### Task 3: Worker — WebSocket `init` exposes team state; `handleSync` broadcasts on `mergedItems` change

**Files:**
- Modify: `worker/src/room.js:177-216` (`handleSync`), `worker/src/room.js:290-308` (`handleWebSocket`)
- Test: `worker/test/room-sync.test.js`, `worker/test/room-ws.test.js`

**Interfaces:**
- Consumes: `broadcastProgress()` from Task 2.
- Produces: WS `init` message now includes `teamChecks`, `mergedItems`, `totalDeaths`, `totalIfgUses` — consumed by the tracker WebSocket client in Task 10.

- [ ] **Step 1: Write the failing tests**

Add to `worker/test/room-ws.test.js`'s existing `describe("RoomDO /ws", ...)` block (after `"sends mode and backlog on connect"`):

```js
  it("includes teamChecks/mergedItems/totalDeaths/totalIfgUses in the init message", async () => {
    const stub = getStub("test-room-ws-progress-1");
    await initRoom(stub, "checksSeen");

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.teamChecks).toEqual([]);
    expect(initMsg.mergedItems).toHaveLength(96);
    expect(initMsg.totalDeaths).toBe(0);
    expect(initMsg.totalIfgUses).toBe(0);
    ws.close();
  });
```

(This subsumes the WS-shape assertion drafted informally in Task 1 — that earlier test in `room-admin.test.js` should now also pass.)

Add to `worker/test/room-sync.test.js`, inside its existing `describe("RoomDO /sync", ...)` block (this file already defines `getStub`, `initRoom`, and a `sync(stub, checksSeen, epoch, shareFlags, items = new Array(96).fill(0))` helper — reuse them exactly as-is, do not redefine):

```js
  it("broadcasts a progress message when /sync actually changes mergedItems", async () => {
    const stub = getStub("test-room-sync-progress-1");
    await initRoom(stub, "checksSeen+items");

    const wsRes = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = wsRes.webSocket;
    ws.accept();
    await new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true })); // discard init

    const pending = new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true }));
    const items = new Array(96).fill(0);
    items[0] = 1;
    await sync(stub, new Array(96).fill(0), 0, undefined, items);
    const msg = await pending;
    expect(msg.type).toBe("progress");
    expect(msg.mergedItems[0]).toBe(1);
    ws.close();
  });

  it("does not broadcast when /sync doesn't actually change mergedItems", async () => {
    const stub = getStub("test-room-sync-progress-2");
    await initRoom(stub, "checksSeen"); // items sharing not enabled -- mergedItems never changes

    const wsRes = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = wsRes.webSocket;
    ws.accept();
    await new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true })); // discard init

    let gotMessage = false;
    ws.addEventListener("message", () => { gotMessage = true; });
    const items = new Array(96).fill(0);
    items[0] = 1;
    await sync(stub, new Array(96).fill(0), 0, undefined, items);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gotMessage).toBe(false);
    ws.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd worker && npx vitest run test/room-ws.test.js test/room-sync.test.js
```

Expected: the new `room-ws.test.js` test fails (`initMsg.teamChecks` undefined). The two new `room-sync.test.js` tests fail (no `"progress"` broadcast from `/sync` yet).

- [ ] **Step 3: Implement in `worker/src/room.js`**

In `handleWebSocket` (around line 299-302), replace:

```js
    const mode = (await this.state.storage.get("mode")) ?? null;
    const backlog = (await this.state.storage.get("events")) ?? [];
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
    server.send(JSON.stringify({ type: "init", mode, backlog, shareFlags }));
```

with:

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

In `handleSync` (around lines 203-215), replace:

```js
    let checksSeen = storedChecksSeen;
    let mergedItems = storedMergedItems;
    // A client reporting a stale (pre-reset) epoch has its contribution to
    // BOTH arrays discarded -- same protection checksSeen/items already had.
    if (body.epoch >= currentEpoch) {
      checksSeen = orMergeBytes(storedChecksSeen, body.checksSeen);
      await this.state.storage.put("checksSeen", checksSeen);
      mergedItems = mergeIncomingItems(storedMergedItems, body.items, mode, shareFlags);
      await this.state.storage.put("mergedItems", mergedItems);
    }

    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, mergedItems });
```

with:

```js
    let checksSeen = storedChecksSeen;
    let mergedItems = storedMergedItems;
    // A client reporting a stale (pre-reset) epoch has its contribution to
    // BOTH arrays discarded -- same protection checksSeen/items already had.
    if (body.epoch >= currentEpoch) {
      checksSeen = orMergeBytes(storedChecksSeen, body.checksSeen);
      await this.state.storage.put("checksSeen", checksSeen);
      const newMergedItems = mergeIncomingItems(storedMergedItems, body.items, mode, shareFlags);
      const mergedItemsChanged = JSON.stringify(newMergedItems) !== JSON.stringify(storedMergedItems);
      mergedItems = newMergedItems;
      await this.state.storage.put("mergedItems", mergedItems);
      if (mergedItemsChanged) {
        // Only /sync can change mergedItems (see design spec decision 4) --
        // without this, the team-progress panel would only ever update on a
        // boss-defeat event, never on an item pickup.
        await this.broadcastProgress();
      }
    }

    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, mergedItems });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd worker && npm test
```

Expected: full worker suite passes, including the Task 1 `room-admin.test.js` test that depended on this task.

- [ ] **Step 5: Commit**

```bash
git add worker/src/room.js worker/test/room-ws.test.js worker/test/room-sync.test.js
git commit -m "worker: expose teamChecks/mergedItems/totals via WS init, broadcast on mergedItems change"
```

---

### Task 4: Lua — `ShareLogic.positiveDelta` pure helper

**Files:**
- Modify: `lua/lib/share_logic.lua`
- Test: `lua/test/share_logic_test.lua`

**Interfaces:**
- Produces: `ShareLogic.positiveDelta(before, after)` — returns the positive increase, or `nil` if `before` is `nil` (no baseline yet) or `after <= before`. Consumed by Task 5's `checkForNewIfg`/`checkForNewDeaths`.

- [ ] **Step 1: Write the failing test**

Add to `lua/test/share_logic_test.lua`, after the existing `formatClearTime` assertions (before the `isEventCheckId` section):

```lua
-- positiveDelta: reports the increase only when there's a prior baseline
-- and the value actually went up (deaths/IFG-use counters are monotonic
-- during a session)
assertEqual(ShareLogic.positiveDelta(nil, 5), nil, "positiveDelta no baseline yet")
assertEqual(ShareLogic.positiveDelta(5, 5), nil, "positiveDelta unchanged")
assertEqual(ShareLogic.positiveDelta(5, 3), nil, "positiveDelta decreased")
assertEqual(ShareLogic.positiveDelta(5, 7), 2, "positiveDelta increased")
assertEqual(ShareLogic.positiveDelta(0, 1), 1, "positiveDelta from a real zero baseline")
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd lua && lua test/share_logic_test.lua
```

Expected: `error: attempt to call a nil value (field 'positiveDelta')`.

- [ ] **Step 3: Implement in `lua/lib/share_logic.lua`**

Add after `ShareLogic.formatClearTime` (after its closing `end`, before `ShareLogic.extractSeedKey`):

```lua
-- Returns the positive increase from `before` to `after`, or nil if there's
-- no prior baseline yet (`before` is nil, meaning this is the first read
-- this session) or the value didn't increase. Used for monotonic RAM
-- counters (deaths, IFG uses) where any real change is always an increase --
-- a decrease would mean `before` was stale/never actually observed, not a
-- real decrease.
function ShareLogic.positiveDelta(before, after)
    if before == nil or after <= before then
        return nil
    end
    return after - before
end
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd lua && lua test/share_logic_test.lua
```

Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add lua/lib/share_logic.lua lua/test/share_logic_test.lua
git commit -m "lua: add ShareLogic.positiveDelta pure helper for death/IFG counters"
```

---

### Task 5: Lua — `share_info.lua` reads IFG/death counters, reports deltas

**Files:**
- Modify: `lua/share_info.lua`

**Interfaces:**
- Consumes: `ShareLogic.positiveDelta` from Task 4.
- Produces: `pendingEvents` entries carrying `ifgDelta`/`deathDelta` — consumed by `issueRequest()` (unchanged) and, downstream, by Task 6's `sync_relay.js` forwarding fix.

**No automated test for this step** — `share_info.lua` is BizHawk-dependent (reads `cpu[...]`) and this project has no BizHawk-in-CI harness; every other function in this file (`checkForNewItems`, `checkForNewChecks`, `checkForNewGameClear`) is verified the same way: live BizHawk testing, not a unit test. Verify per Step 3 below.

- [ ] **Step 1: Add new constants and state**

In `lua/share_info.lua`, after the existing `addrMultiworldInfo` block (after line 59, before `cItemCheckFrames`):

```lua
-- ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/
-- RMR_progress_tracker.lua's own addresses, reused verbatim (see design spec
-- decision 5/"Reference material"): a single global IFG-use counter, and a
-- per-title death counter only meaningful for whichever title is currently
-- active (same limitation that reference script has -- it never caches
-- other titles' death counts while inactive).
local addrIFG = 0x7FFFAE
local addrDeathByTitle = { 0x7E1F80, 0x7E1FB3, 0x7E1FB4 }
```

After the existing `local previousAllClear = nil` line (around line 242):

```lua
local previousIfg = nil
local previousDeathByTitle = { nil, nil, nil }
```

- [ ] **Step 2: Add `checkForNewIfg()`/`checkForNewDeaths()`, wire into the main loop**

After `checkForNewGameClear()`'s closing `end` (after line 442, before `while true do`):

```lua
-- Reports IFG (Invincible Frame Generator) usage as a one-off event each
-- time the game's own usage counter increases -- see design spec decision 5
-- and ref/rmr_option.html for what IFG is. Global, not per-title (addrIFG is
-- a single shared address). Never synced/merged, same reasoning as checks:
-- this is a local read-only observation, reported once per real increase.
local function checkForNewIfg()
    local ifgNow = cpu[addrIFG]
    local delta = ShareLogic.positiveDelta(previousIfg, ifgNow)
    if delta then
        table.insert(pendingEvents, { game = currentTitle(), ifgDelta = delta })
        issueRequest()
    end
    previousIfg = ifgNow
end

-- Structural sibling of checkForNewIfg, tracking each title's own death
-- counter instead -- only the currently-active title's address is
-- meaningful (see addrDeathByTitle above), so previousDeathByTitle keeps one
-- baseline per title, updated only for whichever title is active this poll
-- cycle, so switching titles never produces a false jump.
local function checkForNewDeaths()
    local title = currentTitle()
    local deathsNow = cpu[addrDeathByTitle[title]]
    local delta = ShareLogic.positiveDelta(previousDeathByTitle[title], deathsNow)
    if delta then
        table.insert(pendingEvents, { game = title, deathDelta = delta })
        issueRequest()
    end
    previousDeathByTitle[title] = deathsNow
end
```

In the main loop (around line 444-458), add both calls alongside the existing three:

```lua
while true do
    itemCheckFrames = itemCheckFrames - 1
    if itemCheckFrames <= 0 then
        itemCheckFrames = cItemCheckFrames
        tryConsumeInbox()
        checkForNewItems()
        checkForNewChecks()
        checkForNewGameClear()
        checkForNewIfg()
        checkForNewDeaths()
        if outstandingSeq ~= nil then
```

- [ ] **Step 3: Manual verification**

1. Load `boot.lua` then `share_info.lua` (or the whole renamed script folder) in BizHawk, connected to a room via `tracker/sync_relay.html`.
2. Open the Lua Console and trigger IFG once (via the weapon menu, per `ref/rmr_option.html`'s description). Confirm a `share_info DEBUG`-style line is NOT needed (no debug print was added — this is intentionally quiet, matching the finished state of `checkForNewChecks`), but confirm via the WebSocket inspector technique used earlier this session (`inspect_backlog.mjs`-style script, or watch `sync_relay.js`'s status line for `eventsPosted` incrementing) that a new event with `ifgDelta: 1` reaches the room.
3. Deliberately die once in-game. Confirm a `deathDelta: 1` event reaches the room the same way.
4. Confirm neither shows up as a `checks`/`items` field — only as their own dedicated fields.

- [ ] **Step 4: Commit**

```bash
git add lua/share_info.lua
git commit -m "lua: report IFG-use and death-count increases as new event fields"
```

---

### Task 6: Tracker — fix `sync_relay.js`'s `/event` forwarding (guard against a third recurrence)

**Files:**
- Modify: `pages/tracker/sync_relay.js:98-112`

**Interfaces:**
- Consumes: nothing new.
- Produces: `deathDelta`/`ifgDelta` now reach the Worker's `/event` endpoint from Lua's outbox — required before Task 5's Lua reports can ever have any visible effect.

This is the exact failure mode called out in the design spec's "Watch for this" callout (decision 3) — `sync_relay.js` forwards an explicit field list rather than the whole event object, and has already silently dropped a real field twice this session (`checks`, then `gameClearTime`).

**No automated test** — matches the rest of `sync_relay.js` (no test suite exists for it). Verify per Step 2.

- [ ] **Step 1: Fix the forwarding call**

In `pages/tracker/sync_relay.js`, replace (around line 106-110):

```js
        const evResp = await fetch(`${room}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player: req.player, game: ev.game, items: ev.items, checks: ev.checks, gameClearTime: ev.gameClearTime }),
        });
```

with:

```js
        const evResp = await fetch(`${room}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Every field ev might carry is enumerated explicitly here --
          // JSON.stringify drops undefined keys, so this is correct whether
          // ev carries any subset of these. This exact spot has already
          // silently dropped a real field twice (checks, then
          // gameClearTime) because a new Lua-side field was added without
          // updating this list -- if you're adding a new field to the event
          // shape in lua/share_info.lua, it MUST be added here too.
          body: JSON.stringify({
            player: req.player,
            game: ev.game,
            items: ev.items,
            checks: ev.checks,
            gameClearTime: ev.gameClearTime,
            deathDelta: ev.deathDelta,
            ifgDelta: ev.ifgDelta,
          }),
        });
```

- [ ] **Step 2: Manual verification**

Reload `sync_relay.html` in a browser tab with a folder already connected. Trigger a death or IFG use in-game (per Task 5's verification) and confirm the room's WebSocket backlog (via `inspect_backlog.mjs` or the live event feed once Task 7 lands) actually shows the `deathDelta`/`ifgDelta` field — not just that Lua wrote it to the outbox.

- [ ] **Step 3: Commit**

```bash
git add pages/tracker/sync_relay.js
git commit -m "tracker: forward deathDelta/ifgDelta through sync_relay's /event call"
```

---

### Task 7: Tracker — death/IFG flavor-text lines in the scrolling event feed

**Files:**
- Create: `pages/tracker/misc_event_names_en.js`, `pages/tracker/misc_event_names_ja.js`, `pages/tracker/misc_event_names_zhtw.js`
- Modify: `pages/tracker/event_feed.js:213-309` (`renderEntry`), `pages/tracker/event_feed.html:136-146`

**Interfaces:**
- Produces: `MISC_EVENT_NAMES_EN`/`_JA`/`_ZHTW` (each `{death: string, ifgUsed: string}`, `{name}` placeholder for the player name) — consumed by `renderEntry`.

**No automated test** — matches `event_feed.js`'s existing convention (no test suite; verified live in-browser, as established throughout this session for check/item rendering). Verify per Step 3.

- [ ] **Step 1: Create the three name-table files**

`pages/tracker/misc_event_names_en.js`:

```js
// Flavor-text lines for the two non-check, non-item event kinds (see
// design spec decision 6). {name} substitutes event.player, matching the
// existing {time} substitution pattern check_names_en.js's id-903 entry
// uses.
const MISC_EVENT_NAMES_EN = {
  death: "{name} met an unfortunate end, exploding into bubbles. Your deeds of valor will be remembered.",
  ifgUsed: "{name} secretly used IFG. They weren't like this before... who led them astray?",
};
```

`pages/tracker/misc_event_names_ja.js`:

```js
const MISC_EVENT_NAMES_JA = {
  death: "{name}は無念にも泡となって消えた。君の勇敢な行為は語り継がれるだろう。",
  ifgUsed: "{name}はこっそりIFGを使った。前はこんな子じゃなかったのに…悪い友達でもできたのかもしれない。",
};
```

`pages/tracker/misc_event_names_zhtw.js`:

```js
const MISC_EVENT_NAMES_ZHTW = {
  death: "{name} 不幸的變成了泡泡，您的英勇長存人心。",
  ifgUsed: "{name} 偷偷地用了IFG，他以前不是這樣的，一定是交了壞朋友。",
};
```

- [ ] **Step 2: Wire into `event_feed.js` and `event_feed.html`**

In `pages/tracker/event_feed.js`, add a lookup table near the top (after the existing `MODE_LABELS`/`friendlyModeLabel` block, around line 24):

```js
const MISC_EVENT_NAME_TABLES = { en: MISC_EVENT_NAMES_EN, ja: MISC_EVENT_NAMES_JA, "zh-TW": MISC_EVENT_NAMES_ZHTW };
function getMiscEventName(kind, lang, playerName) {
  const table = MISC_EVENT_NAME_TABLES[lang] || MISC_EVENT_NAMES_EN;
  const template = table[kind] || MISC_EVENT_NAMES_EN[kind];
  return template.replace("{name}", playerName);
}
```

In `renderEntry` (around line 213), widen the "nothing to render" guard and add death/IFG rendering. Replace:

```js
function renderEntry(event, showText, lang, shareFlags, showItems, showChecks) {
  const realItems = showItems ? (event.items || []).filter((itemId) => ITEM_ID_MAP[itemId] !== undefined) : [];
  const realChecks = showChecks ? (event.checks || []).filter((checkId) => CHECK_ID_MAP[checkId] !== undefined) : [];
  if (realItems.length === 0 && realChecks.length === 0) {
    return null;
  }
```

with:

```js
function renderEntry(event, showText, lang, shareFlags, showItems, showChecks) {
  const realItems = showItems ? (event.items || []).filter((itemId) => ITEM_ID_MAP[itemId] !== undefined) : [];
  const realChecks = showChecks ? (event.checks || []).filter((checkId) => CHECK_ID_MAP[checkId] !== undefined) : [];
  const hasDeath = event.deathDelta !== undefined;
  const hasIfg = event.ifgDelta !== undefined;
  if (realItems.length === 0 && realChecks.length === 0 && !hasDeath && !hasIfg) {
    return null;
  }
```

Add, right before the function's final `return entry;` (around line 307-308):

```js
  // A deathDelta/ifgDelta greater than 1 (multiple increments between polls)
  // renders the same flavor line once per unit of delta -- matching how a
  // multi-id checks/items batch already renders one line per id, not a
  // single "x3" summary (see design spec decision 6).
  if (hasDeath) {
    for (let i = 0; i < event.deathDelta; i++) {
      const line = document.createElement("span");
      line.className = "item misc-event-item";
      line.textContent = getMiscEventName("death", lang, event.player);
      entry.appendChild(line);
    }
  }
  if (hasIfg) {
    for (let i = 0; i < event.ifgDelta; i++) {
      const line = document.createElement("span");
      line.className = "item misc-event-item";
      line.textContent = getMiscEventName("ifgUsed", lang, event.player);
      entry.appendChild(line);
    }
  }

  return entry;
```

In `pages/tracker/event_feed.html`, add three new `<script>` tags after the existing `check_names_zhtw.js` line (around line 144, before `check_lookup.js`):

```html
<script src="check_names_zhtw.js"></script>
<script src="misc_event_names_en.js"></script>
<script src="misc_event_names_ja.js"></script>
<script src="misc_event_names_zhtw.js"></script>
<script src="check_lookup.js"></script>
```

Add a small CSS rule in `pages/tracker/event_feed.html`'s `<style>` block (after the existing `.entry .check-item .item-label` rule, around line 27):

```css
  .entry .misc-event-item { font-style: italic; color: #bcbcbc; }
```

- [ ] **Step 3: Manual verification**

Open `event_feed.html` connected to a room. Using the WebSocket inspector script pattern from earlier this session (or a live BizHawk death/IFG trigger from Task 5/6), confirm a death or IFG event renders the correct flavor line, in each of the three languages (switch via the settings panel's language dropdown), and that a `deathDelta: 2` event renders the line twice.

- [ ] **Step 4: Commit**

```bash
git add pages/tracker/misc_event_names_en.js pages/tracker/misc_event_names_ja.js pages/tracker/misc_event_names_zhtw.js pages/tracker/event_feed.js pages/tracker/event_feed.html
git commit -m "tracker: render death/IFG flavor-text lines in the event feed"
```

---

### Task 8: Tracker — `team_progress_layout.js` (per-title grid data)

**Files:**
- Create: `pages/tracker/team_progress_layout.js`
- Modify: `pages/tracker/assets/` (copy 2 files from `ref/`)

**Interfaces:**
- Produces: `TEAM_PROGRESS_LAYOUT` (keyed `1`/`2`/`3`), `ALL_CLEAR_CHECK_ID` — consumed by Task 10's grid rendering.

- [ ] **Step 1: Copy the two missing icon assets**

```bash
cp "ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_assets/deaths.png" "pages/tracker/assets/deaths.png"
cp "ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_assets/igf.png" "pages/tracker/assets/igf.png"
```

- [ ] **Step 2: Create `pages/tracker/team_progress_layout.js`**

Every id below is verified directly against `pages/tracker/check_id_map.js`, `pages/tracker/item_id_map.js`, and `pages/tracker/icon_map.js`'s `BOSS_CODE_MAP` (not derived/guessed) — boss order within each title matches `BOSS_CODE_MAP`'s key order exactly, so `weaponIds[i]`/`bossCheckIds[i]` always refer to the same Maverick. Armor pieces use both the `Part` and `Chip` id for each slot (OR'd together in Task 10) since either variant grants that armor piece.

```js
// Per-title grid layout for the team-progress panel in sync_relay.html (see
// design spec decision 7 and its "Alternatives considered" section for why
// this is fresh data rather than adapted from ref's own bundle). gameClear
// ids match lua/share_info.lua's cCheckIdGameClear (900/901/902); the "all 3
// cleared" milestone (903) is tracked once, globally, via ALL_CLEAR_CHECK_ID
// below -- not part of any single title's panel.
const TEAM_PROGRESS_LAYOUT = {
  1: {
    titleIcon: "assets/title_x1.ico",
    openingCheckId: 240,
    bossCheckIds: [241, 242, 243, 244, 245, 246, 247, 248], // LO, SC, AA, BN, SE, SM, BK, IP
    weaponIds: [40, 41, 42, 43, 44, 45, 46, 47],
    sigmaCheckIds: [249, 250, 251],
    armor: [[88, 89], [90, 91], [92, 93], [94, 95]], // Head, Arm, Body, Foot (Part id, Chip id)
    subtankIds: [36, 37, 38, 39],
    superWeaponId: 80, // Hadouken
    gameClearCheckId: 900,
  },
  2: {
    titleIcon: "assets/title_x2.ico",
    openingCheckId: 496,
    bossCheckIds: [497, 498, 499, 500, 501, 502, 503, 504], // MM, WH, BC, FS, MH, CM, SO, WA
    weaponIds: [296, 297, 298, 299, 300, 301, 302, 303],
    sigmaCheckIds: [505, 506, 507, 508], // 508 = stage-4 8-Maverick refight, no single boss
    armor: [[344, 345], [346, 347], [348, 349], [350, 351]],
    subtankIds: [292, 293, 294, 295],
    superWeaponId: 336, // Shoryuken
    gameClearCheckId: 901,
  },
  3: {
    titleIcon: "assets/title_x3.ico",
    openingCheckId: 752,
    bossCheckIds: [753, 754, 755, 756, 757, 758, 759, 760], // EH, FB, GB, AS, EN, SS, SM, ST
    weaponIds: [552, 553, 554, 555, 556, 557, 558, 559],
    sigmaCheckIds: [762, 763, 764, 765, 766], // S1a, S2a, S3, S1b, S2b
    armor: [[600, 601], [602, 603], [604, 605], [606, 607]],
    subtankIds: [548, 549, 550, 551],
    superWeaponId: 592, // Z-Saber
    gameClearCheckId: 902,
  },
};

// ref/aaa/boot.lua's own "all 3 titles cleared" milestone (lua/share_info.lua's
// cCheckIdGameClearAll) -- shown once, globally, not per-title.
const ALL_CLEAR_CHECK_ID = 903;
```

- [ ] **Step 3: Syntax/sanity check**

```bash
node --check pages/tracker/team_progress_layout.js
node -e "
const fs = require('fs');
eval(fs.readFileSync('pages/tracker/team_progress_layout.js', 'utf8'));
for (const title of [1, 2, 3]) {
  const l = TEAM_PROGRESS_LAYOUT[title];
  if (l.bossCheckIds.length !== 8 || l.weaponIds.length !== 8 || l.armor.length !== 4 || l.subtankIds.length !== 4) {
    throw new Error('title ' + title + ' has the wrong slot count');
  }
}
console.log('SHAPE OK');
"
```

Expected: `SHAPE OK`, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add pages/tracker/team_progress_layout.js pages/tracker/assets/deaths.png pages/tracker/assets/igf.png
git commit -m "tracker: add per-title team-progress grid layout data and death/IFG icons"
```

---

### Task 9: Tracker — `sync_relay.html`/`sync_relay.js` gain persisted Worker URL / room key fields

**Files:**
- Modify: `pages/tracker/sync_relay.html`, `pages/tracker/sync_relay.js`

**Interfaces:**
- Produces: `getProgressWorkerUrl()`/`getProgressRoomKey()` accessors and `rmrSyncRelayWorkerUrl`/`rmrSyncRelayRoomKey` localStorage keys — consumed by Task 10's WebSocket connection logic.

**No automated test** — matches `sync_relay.js`'s existing convention. Verify per Step 3.

- [ ] **Step 1: Add the input fields to `sync_relay.html`**

Replace the body (between `<h1>` and the existing buttons, around line 13-22) — insert new fields before the existing `pickBtn`:

```html
<h1>RMR Sync — Relay</h1>
<p>
  Keep this tab open while you play. It reads your game's local sync files
  and relays them to the Cloudflare backend — no other setup needed beyond
  picking the folder that contains <code>boot.lua</code> once.
  Requires Chrome, Edge, or another Chromium-based browser.
</p>

<h2>Team progress</h2>
<p>
  Enter a Worker URL and room key to see the team's progress below — this
  works even without connecting a game folder. If you connect a folder
  below, these fill in automatically from your own game's settings.
</p>
<label>Worker URL<br><input type="text" id="progressWorkerUrl" style="width:100%" autocomplete="off" /></label><br><br>
<label>Room key<br><input type="text" id="progressRoomKey" style="width:100%" autocomplete="off" /></label>
<div id="progressPanel"></div>

<h2>Game connection</h2>
<button id="pickBtn">Choose game folder</button>
<button id="reconnectBtn" style="display:none">Reconnect folder</button>
<div id="status">Not connected.</div>
```

- [ ] **Step 2: Add persistence + auto-fill logic to `sync_relay.js`**

Add near the top of the file (after the existing `let keepAlivePcs = null;` line):

```js
const PROGRESS_WORKER_URL_KEY = "rmrSyncRelayWorkerUrl";
const PROGRESS_ROOM_KEY_KEY = "rmrSyncRelayRoomKey";

function getProgressWorkerUrl() {
  return document.getElementById("progressWorkerUrl").value.trim();
}
function getProgressRoomKey() {
  return document.getElementById("progressRoomKey").value.trim();
}

function persistProgressSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not fatal -- this session just won't be remembered next time
  }
}

function restoreProgressSettings() {
  try {
    const workerUrl = localStorage.getItem(PROGRESS_WORKER_URL_KEY);
    const roomKey = localStorage.getItem(PROGRESS_ROOM_KEY_KEY);
    if (workerUrl) document.getElementById("progressWorkerUrl").value = workerUrl;
    if (roomKey) document.getElementById("progressRoomKey").value = roomKey;
  } catch {
    // localStorage unavailable -- just start blank
  }
}

// Auto-fills the two progress fields from a successfully-read outbox
// request, but only if empty -- so connecting a game folder doesn't
// overwrite a room key the user deliberately typed in to spectate a
// different room (see design spec decision 7).
function maybeAutoFillProgressFields(req) {
  const workerUrlInput = document.getElementById("progressWorkerUrl");
  const roomKeyInput = document.getElementById("progressRoomKey");
  let changed = false;
  if (!workerUrlInput.value.trim() && req.workerUrl) {
    workerUrlInput.value = req.workerUrl;
    persistProgressSetting(PROGRESS_WORKER_URL_KEY, req.workerUrl);
    changed = true;
  }
  if (!roomKeyInput.value.trim() && req.roomKey) {
    roomKeyInput.value = req.roomKey;
    persistProgressSetting(PROGRESS_ROOM_KEY_KEY, req.roomKey);
    changed = true;
  }
  return changed;
}
```

Wire the input fields' `input` listeners and initial restore — add near the bottom of the file, right before the final self-invoking `(async () => { ... })();` block:

```js
document.getElementById("progressWorkerUrl").addEventListener("input", (e) => persistProgressSetting(PROGRESS_WORKER_URL_KEY, e.target.value.trim()));
document.getElementById("progressRoomKey").addEventListener("input", (e) => persistProgressSetting(PROGRESS_ROOM_KEY_KEY, e.target.value.trim()));
restoreProgressSettings();
```

In `tick()` (around line 65-72, right after `req = JSON.parse(...)` succeeds and before the `if (req.session !== lastSession)` check), call the auto-fill:

```js
  } catch {
    return; // no outbox yet, or a torn read -- try again next tick
  }

  maybeAutoFillProgressFields(req);

  if (req.session !== lastSession) {
```

- [ ] **Step 3: Manual verification**

Open `sync_relay.html` with no folder connected. Type a Worker URL and room key into the new fields, reload the page, and confirm both fields still show the typed values (localStorage persistence). Then connect a real game folder and confirm the fields auto-fill from the outbox if they were empty, and do NOT get overwritten if you'd already typed something different.

- [ ] **Step 4: Commit**

```bash
git add pages/tracker/sync_relay.html pages/tracker/sync_relay.js
git commit -m "tracker: add persisted Worker URL/room key fields to sync_relay.html, auto-filled from outbox"
```

---

### Task 10: Tracker — `sync_relay.js` opens its own WebSocket for team-progress state

**Files:**
- Modify: `pages/tracker/sync_relay.js`

**Interfaces:**
- Consumes: `getProgressWorkerUrl()`/`getProgressRoomKey()` from Task 9; the `{type: "init"/"progress"/"event"}` WS message shapes from Tasks 2/3.
- Produces: module-level `teamChecks`/`mergedItems`/`totalDeaths`/`totalIfgUses` state, kept live-updated — consumed by Task 11's grid rendering (calls `renderProgressGrid()`, added as a no-op stub in this task and implemented for real in Task 11).

**No automated test** — matches `sync_relay.js`'s existing convention. Verify per Step 3.

- [ ] **Step 1: Add WebSocket state and connection logic**

Add near the top of the file (after the `PROGRESS_ROOM_KEY_KEY` constant from Task 9):

```js
let progressWs = null;
let progressReconnectDelayMs = 1000;
const PROGRESS_MAX_RECONNECT_DELAY_MS = 15000;
let teamChecks = [];
let mergedItems = new Array(96).fill(0);
let totalDeaths = 0;
let totalIfgUses = 0;

function toProgressWebSocketUrl(workerUrl, room) {
  const httpUrl = new URL(`/room/${encodeURIComponent(room)}/ws`, workerUrl);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

// Implemented for real in a later task (grid rendering) -- a no-op for now
// so this task's WS wiring can be verified independently.
function renderProgressGrid() {
  // placeholder -- see Task 11
}

function applyProgressState(msg) {
  if (msg.teamChecks !== undefined) teamChecks = msg.teamChecks;
  if (msg.mergedItems !== undefined) mergedItems = msg.mergedItems;
  if (msg.totalDeaths !== undefined) totalDeaths = msg.totalDeaths;
  if (msg.totalIfgUses !== undefined) totalIfgUses = msg.totalIfgUses;
  renderProgressGrid();
}

// Connects (or reconnects) to the room's WebSocket purely for team-progress
// display -- entirely independent of the outbox/inbox file relay above (see
// design spec decision 8: nothing from this connection is ever written to
// the inbox file Lua reads).
function connectProgressWs() {
  const workerUrl = getProgressWorkerUrl();
  const roomKey = getProgressRoomKey();
  if (!workerUrl || !roomKey) {
    return;
  }
  if (progressWs) {
    progressWs.close();
  }
  progressWs = new WebSocket(toProgressWebSocketUrl(workerUrl, roomKey));

  progressWs.addEventListener("open", () => {
    progressReconnectDelayMs = 1000;
  });
  progressWs.addEventListener("close", () => {
    setTimeout(connectProgressWs, progressReconnectDelayMs);
    progressReconnectDelayMs = Math.min(progressReconnectDelayMs * 2, PROGRESS_MAX_RECONNECT_DELAY_MS);
  });
  progressWs.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "init" || data.type === "progress") {
      applyProgressState(data);
    }
  });
}
```

- [ ] **Step 2: Wire connection triggers**

Add at the bottom of the file, alongside the Task 9 listener wiring:

```js
document.getElementById("progressWorkerUrl").addEventListener("change", connectProgressWs);
document.getElementById("progressRoomKey").addEventListener("change", connectProgressWs);
```

In `maybeAutoFillProgressFields` (Task 9), call `connectProgressWs()` when it actually changed something — update the function's final lines:

```js
  if (!roomKeyInput.value.trim() && req.roomKey) {
    roomKeyInput.value = req.roomKey;
    persistProgressSetting(PROGRESS_ROOM_KEY_KEY, req.roomKey);
    changed = true;
  }
  if (changed) {
    connectProgressWs();
  }
  return changed;
```

At the very bottom of the file, after `restoreProgressSettings();` (Task 9), connect immediately if fields are already populated:

```js
restoreProgressSettings();
connectProgressWs();
```

- [ ] **Step 3: Manual verification**

Open `sync_relay.html`, type in a real Worker URL + room key (no folder needed), and confirm — using the browser DevTools Network/WS inspector tab — that a WebSocket connection opens to `/room/<key>/ws` and receives an `init` message. Trigger a real check/item/death/IFG event from another connected player (or a live game) and confirm a `progress` message arrives and `teamChecks`/`mergedItems`/`totalDeaths`/`totalIfgUses` (inspect via a `console.log` temporarily, or the browser debugger) update accordingly.

- [ ] **Step 4: Commit**

```bash
git add pages/tracker/sync_relay.js
git commit -m "tracker: open a WebSocket in sync_relay.js for live team-progress state"
```

---

### Task 11: Tracker — render the team-progress grid

**Files:**
- Modify: `pages/tracker/sync_relay.html`, `pages/tracker/sync_relay.js`

**Interfaces:**
- Consumes: `TEAM_PROGRESS_LAYOUT`/`ALL_CLEAR_CHECK_ID` (Task 8), `teamChecks`/`mergedItems`/`totalDeaths`/`totalIfgUses` (Task 10), `getCheckIconInfoForId` (`check_lookup.js`), `getIconInfoForId` (`icon_map.js`).

**No automated test** — matches `sync_relay.js`'s existing convention. Verify per Step 4.

- [ ] **Step 1: Add the script tags and CSS to `sync_relay.html`**

Add before the existing `<script src="sync_relay.js"></script>` line:

```html
<script src="item_id_map.js"></script>
<script src="item_names_en.js"></script>
<script src="item_names_ja.js"></script>
<script src="item_names_zhtw.js"></script>
<script src="icon_map.js"></script>
<script src="check_id_map.js"></script>
<script src="check_names_en.js"></script>
<script src="check_names_ja.js"></script>
<script src="check_names_zhtw.js"></script>
<script src="check_lookup.js"></script>
<script src="team_progress_layout.js"></script>
<script src="sync_relay.js"></script>
```

Add to the existing `<style>` block:

```css
  .title-panel { margin: 0.75em 0; border: 1px solid #ccc; border-radius: 6px; padding: 0.6em 0.8em; }
  .title-panel h3 { display: flex; align-items: center; gap: 0.4em; font-size: 1.05em; margin: 0 0 0.5em; }
  .title-panel h3 img { width: 24px; height: 24px; }
  .icon-row { display: flex; flex-wrap: wrap; gap: 0.25em; margin-bottom: 0.35em; }
  .icon-row img { width: 28px; height: 28px; image-rendering: pixelated; filter: grayscale(100%) brightness(0.55); opacity: 0.45; }
  .icon-row img.done { filter: none; opacity: 1; }
  .misc-row { display: flex; align-items: center; gap: 1.5em; margin-top: 0.5em; font-size: 1.05em; }
  .misc-row img { width: 24px; height: 24px; image-rendering: pixelated; }
```

- [ ] **Step 2: Implement `renderProgressGrid()` for real in `sync_relay.js`**

Replace the Task 10 placeholder:

```js
function renderProgressGrid() {
  // placeholder -- see Task 11
}
```

with:

```js
function isTeamCheckDone(checkId) {
  return teamChecks.includes(checkId);
}

function isItemOwned(itemId) {
  const byteIndex = Math.floor(itemId / 8);
  const mask = 1 << (itemId % 8);
  return (mergedItems[byteIndex] & mask) !== 0;
}

// Either the Part or Chip variant of an armor slot counts as "owned" --
// whichever one the randomizer actually placed at that check.
function isArmorSlotOwned(idPair) {
  return idPair.some((id) => isItemOwned(id));
}

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

function renderProgressGrid() {
  const panel = document.getElementById("progressPanel");
  panel.innerHTML = "";

  for (const title of [1, 2, 3]) {
    const layout = TEAM_PROGRESS_LAYOUT[title];
    const section = document.createElement("div");
    section.className = "title-panel";

    const heading = document.createElement("h3");
    const titleIcon = document.createElement("img");
    titleIcon.src = layout.titleIcon;
    titleIcon.alt = `X${title}`;
    heading.appendChild(titleIcon);
    heading.appendChild(document.createTextNode(`Rockman X${title}`));
    section.appendChild(heading);

    const bossRow = document.createElement("div");
    bossRow.className = "icon-row";
    const openingInfo = getCheckIconInfoForId(layout.openingCheckId);
    bossRow.appendChild(makeGridIcon(openingInfo.file, openingInfo.label, isTeamCheckDone(layout.openingCheckId)));
    for (const checkId of layout.bossCheckIds) {
      const info = getCheckIconInfoForId(checkId);
      bossRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
    }
    section.appendChild(bossRow);

    const weaponRow = document.createElement("div");
    weaponRow.className = "icon-row";
    for (const itemId of layout.weaponIds) {
      const info = getIconInfoForId(itemId);
      weaponRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
    }
    const superInfo = getIconInfoForId(layout.superWeaponId);
    weaponRow.appendChild(makeGridIcon(superInfo.file, superInfo.label, isItemOwned(layout.superWeaponId)));
    section.appendChild(weaponRow);

    const armorRow = document.createElement("div");
    armorRow.className = "icon-row";
    for (const idPair of layout.armor) {
      const info = getIconInfoForId(idPair[0]);
      armorRow.appendChild(makeGridIcon(info.file, info.label, isArmorSlotOwned(idPair)));
    }
    for (const itemId of layout.subtankIds) {
      const info = getIconInfoForId(itemId);
      armorRow.appendChild(makeGridIcon(info.file, info.label, isItemOwned(itemId)));
    }
    section.appendChild(armorRow);

    const sigmaRow = document.createElement("div");
    sigmaRow.className = "icon-row";
    for (const checkId of layout.sigmaCheckIds) {
      const info = getCheckIconInfoForId(checkId);
      sigmaRow.appendChild(makeGridIcon(info.file, info.label, isTeamCheckDone(checkId)));
    }
    const clearInfo = getCheckIconInfoForId(layout.gameClearCheckId);
    sigmaRow.appendChild(makeGridIcon(clearInfo.file, clearInfo.label, isTeamCheckDone(layout.gameClearCheckId)));
    section.appendChild(sigmaRow);

    panel.appendChild(section);
  }

  const miscRow = document.createElement("div");
  miscRow.className = "misc-row";
  const allClearInfo = getCheckIconInfoForId(ALL_CLEAR_CHECK_ID);
  miscRow.appendChild(makeGridIcon(allClearInfo.file, allClearInfo.label, isTeamCheckDone(ALL_CLEAR_CHECK_ID)));

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

  panel.appendChild(miscRow);
}
```

- [ ] **Step 3: Syntax check**

```bash
node --check pages/tracker/sync_relay.js
```

- [ ] **Step 4: Manual verification**

Open `sync_relay.html` with a Worker URL + room key for a room that already has some progress (e.g. the room used earlier this session). Confirm:
1. All three title panels render with the correct title icon, 9 boss-row icons (opening + 8 Mavericks), 9 weapon-row icons (8 weapons + super weapon), 4 armor + 4 subtank icons, and a sigma row.
2. Previously-completed checks/items show at full color; everything else shows greyed-out/dim.
3. The deaths/IFG counters show the correct running totals and their icons render (confirms Task 8's asset copy worked).
4. Triggering a new check/item/death/IFG event (from a live game or another tab) updates the grid live, with no page reload.
5. Zoom out or resize the window to a narrow width and confirm the icon rows wrap without any layout breakage (this page has no responsive design work done elsewhere to copy from — a quick visual check is enough, not pixel-perfect).

- [ ] **Step 5: Commit**

```bash
git add pages/tracker/sync_relay.html pages/tracker/sync_relay.js
git commit -m "tracker: render the team-progress grid in sync_relay.html"
```

---

## Final verification (after all tasks)

```bash
cd worker && npm test
cd ../lua && lua test/share_logic_test.lua && lua test/file_relay_test.lua
```

Both must pass in full before moving to `superpowers:finishing-a-development-branch` (merge/PR/keep/discard choice) — deployment of the production `rmr-sync` Worker remains a manual, explicitly-requested step after that, same as every prior feature this session.
