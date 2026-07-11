# Full-Array Cross-Player Item Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `itemMergeSiblings` cross-title-projection mechanism (confirmed live to corrupt non-whitelisted items — picking up one boss weapon silently granted an unrelated key in another title) and replace it with a same-title, cross-**player** OR-merge: each Lua client sends its own full 96-byte `items` snapshot on every `/sync` call, the Worker OR-merges it into room-level `mergedItems`, and returns the merged result — exactly mirroring how `checksSeen` already works, including its stale-epoch discard protection.

**Architecture:** `/sync` gains a required `items` field (96-byte packed-bit array, same convention as `checksSeen`). `checksSeen+item` mode folds in only bits whose id belongs to one of the 7 whitelisted categories (bit-granular, not byte-granular — `subTank`'s range doesn't start on a byte boundary). `checksSeen+item+all` folds in the entire array unconditionally. Neither mode ever projects a bit from one title's byte range into another title's byte range — merging is always same-title, cross-player only. `/event` stops computing any merge at all; it goes back to being purely the display/event-feed/toast pipeline.

**Tech Stack:** Cloudflare Workers (Durable Objects, Vitest), Lua (BizHawk).

## Global Constraints

- `/sync` request body gains a new **required** field, `items` — a 96-byte array of integers `0-255`, same bit-packing as `checksSeen` (byte `Math.floor(id/8)`, bit `id % 8`), sent unconditionally on every `/sync` call regardless of room mode (the Lua client doesn't know the room's mode before its first response, exactly like `checksSeen` today). A missing or malformed `items` field is a 400, even in plain `checksSeen` mode.
- `/sync`'s **response** field name stays `mergedItems` (no rename) — only how it's computed changes.
- Epoch protection for `items` must be **identical** to `checksSeen`'s existing `body.epoch >= currentEpoch` gate: a stale-epoch `/sync` call has its `items` contribution discarded exactly like its `checksSeen` contribution, under the same `if` block.
- Category filtering for `checksSeen+item` must be **bit-granular, not byte-granular**. `subTank`'s range (`0x24`-`0x27`) does not start on a byte boundary — byte 4 of each title's block also contains ids `0x20`-`0x23` (the unused gap, `shareCategoryForId` returns `null`). Filtering by whole bytes would incorrectly merge those gap ids whenever any subTank id shares their byte. The loop must check `shareCategoryForId(id)` per individual id (0 to 767).
- `checksSeen+item+all` performs a plain, unconditional `orMergeBytes` of the incoming `items` array — no category loop, no `shareFlags` lookup.
- Plain `checksSeen` mode: `items` is still required and validated on every `/sync` call, but its contents are never folded into `mergedItems`.
- `handleEvent`'s merge-computation block is deleted entirely. Its mode gate, duplicate-filtering, event-log append, and WS broadcast are unchanged — `/event` exists purely for the event-feed/toast display, decoupled from merging.
- `worker/src/shareCategories.js`'s `itemMergeSiblings` is deleted outright (confirmed via `Grep`: exactly one production call site in `room.js`, one test-only call site in `shareCategories.test.js`, both being removed by this plan). `shareCategoryForId` is unchanged and still needed.
- Files explicitly **not** touched by this plan: `worker/src/bits.js` (already has `setBit`), `worker/src/index.js`, `worker/src/cors.js`, `admin/host_admin.html`, `tracker/**`, `worker/test/room-admin.test.js`, `worker/test/shareCategories.crosscheck.test.js`, `worker/test/bits.test.js`, `lua/share_logic.lua`, `lua/file_relay.lua`, `lua/config.lua`, `worker/src/room.js`'s `handleInit`/`handleReset`/`handleStatus` (already correct, confirmed by reading them).
- **Explicitly accepted tradeoff** (approved by the project owner): a player who exclusively plays one title will no longer automatically receive an item that was only found in a title they've never touched — the previous sibling-projection was the only thing making that happen, and it's being removed on purpose. Do not attempt to preserve it.

---

### Task 1: `worker/src/validation.js` — add `isValidItemsArray`

**Files:**
- Modify: `worker/src/validation.js`
- Modify: `worker/test/validation.test.js`

**Interfaces:**
- Produces: `isValidItemsArray(arr): boolean` — a 96-length array of integers `0-255`. Consumed by Task 3's `room.js` changes.

- [ ] **Step 1: Update `worker/src/validation.js`.**

  Current full file:
  ```js
  const VALID_MODES = ["checksSeen", "checksSeen+item", "checksSeen+item+all"];
  const CHECKS_SEEN_LENGTH = 96;
  const SHARE_FLAG_KEYS = ["lifeUp", "energyUp", "armor", "subTank", "finalWeapon", "sigmaKey", "upgradeItem"];

  export function isValidMode(mode) {
    return VALID_MODES.includes(mode);
  }

  export function isValidChecksSeenArray(arr) {
    if (!Array.isArray(arr) || arr.length !== CHECKS_SEEN_LENGTH) return false;
    return arr.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
  }

  export function validateEventBody(body) {
    // ...unchanged...
  }

  export function isValidAdminSecret(secret) {
    // ...unchanged...
  }

  export function isValidEpoch(value) {
    // ...unchanged...
  }

  export function isValidShareFlags(value) {
    // ...unchanged...
  }
  ```

  Replace the `CHECKS_SEEN_LENGTH`/`isValidChecksSeenArray` section with:
  ```js
  const VALID_MODES = ["checksSeen", "checksSeen+item", "checksSeen+item+all"];
  const CHECKS_SEEN_LENGTH = 96;
  const ITEMS_LENGTH = 96;
  const SHARE_FLAG_KEYS = ["lifeUp", "energyUp", "armor", "subTank", "finalWeapon", "sigmaKey", "upgradeItem"];

  export function isValidMode(mode) {
    return VALID_MODES.includes(mode);
  }

  // Both checksSeen and items are 96-byte arrays, one bit per id (byte
  // Math.floor(id/8), bit id % 8) -- shared validator, exposed under two
  // names so each call site stays self-documenting.
  function isValidByteArray(arr, length) {
    if (!Array.isArray(arr) || arr.length !== length) return false;
    return arr.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
  }

  export function isValidChecksSeenArray(arr) {
    return isValidByteArray(arr, CHECKS_SEEN_LENGTH);
  }

  // The client's full 96-byte item-ownership snapshot (lua/share_info.lua's
  // readItems(), reading addrItems directly -- already flat/all-3-titles, no
  // per-title slicing needed), sent on every /sync alongside checksSeen so
  // room.js's handleSync can OR-merge it across players into mergedItems.
  export function isValidItemsArray(arr) {
    return isValidByteArray(arr, ITEMS_LENGTH);
  }
  ```

  Leave `validateEventBody`, `isValidAdminSecret`, `isValidEpoch`, and `isValidShareFlags` untouched.

- [ ] **Step 2: Add tests to `worker/test/validation.test.js`.**

  Update the import line:
  ```js
  import { isValidMode, isValidChecksSeenArray, isValidItemsArray, validateEventBody, isValidAdminSecret, isValidEpoch, isValidShareFlags } from "../src/validation.js";
  ```

  Add a new `describe` block immediately after the existing `describe("isValidChecksSeenArray", ...)` block:
  ```js
  describe("isValidItemsArray", () => {
    it("accepts a 96-length array of byte values", () => {
      expect(isValidItemsArray(new Array(96).fill(0))).toBe(true);
    });

    it("rejects wrong length", () => {
      expect(isValidItemsArray(new Array(95).fill(0))).toBe(false);
    });

    it("rejects out-of-range or non-integer values", () => {
      const bad1 = new Array(96).fill(0);
      bad1[0] = 256;
      expect(isValidItemsArray(bad1)).toBe(false);

      const bad2 = new Array(96).fill(0);
      bad2[0] = 1.5;
      expect(isValidItemsArray(bad2)).toBe(false);
    });

    it("rejects non-arrays", () => {
      expect(isValidItemsArray("not an array")).toBe(false);
      expect(isValidItemsArray(null)).toBe(false);
    });
  });
  ```

- [ ] **Step 3: Run the test suite.** From `worker/`: `npm test`. Expected: all pass, including the 4 new `isValidItemsArray` tests.

- [ ] **Step 4: Commit.**
  ```bash
  git add worker/src/validation.js worker/test/validation.test.js
  git commit -m "Add isValidItemsArray for the new /sync items field"
  ```

---

### Task 2: `worker/src/shareCategories.js` — delete `itemMergeSiblings`

**Files:**
- Modify: `worker/src/shareCategories.js`
- Modify: `worker/test/shareCategories.test.js`

**Interfaces:**
- Removes: `itemMergeSiblings` (no longer exported). `shareCategoryForId` unchanged.

- [ ] **Step 1: Delete `itemMergeSiblings` from `worker/src/shareCategories.js`.**

  Remove the `itemMergeSiblings` function and its comment block entirely. The file becomes just `shareCategoryForId`, unchanged.

- [ ] **Step 2: Remove its test from `worker/test/shareCategories.test.js`.**

  Change the import line from:
  ```js
  import { shareCategoryForId, itemMergeSiblings } from "../src/shareCategories.js";
  ```
  to:
  ```js
  import { shareCategoryForId } from "../src/shareCategories.js";
  ```

  Delete the entire `describe("itemMergeSiblings", ...)` block:
  ```js
  describe("itemMergeSiblings", () => {
    it("returns the same 3 ids regardless of which title's id you start from", () => {
      expect(itemMergeSiblings(36)).toEqual([36, 292, 548]); // Sub Tank #1, starting from title 1
      expect(itemMergeSiblings(292)).toEqual([36, 292, 548]); // same slot, starting from title 2
      expect(itemMergeSiblings(548)).toEqual([36, 292, 548]); // same slot, starting from title 3
    });
  });
  ```

- [ ] **Step 3: Run the test suite.** From `worker/`: `npm test -- shareCategories`. Expected: pass (`shareCategoryForId` tests unaffected; `shareCategories.crosscheck.test.js` also still passes since it never imported `itemMergeSiblings`).

- [ ] **Step 4: Commit.**
  ```bash
  git add worker/src/shareCategories.js worker/test/shareCategories.test.js
  git commit -m "Delete itemMergeSiblings -- cross-title slot projection is being replaced"
  ```

---

### Task 3: `worker/src/room.js` — full-array cross-player OR-merge on `/sync`

**Files:**
- Modify: `worker/src/room.js`
- Modify: `worker/test/room-sync.test.js`
- Modify: `worker/test/room-event.test.js`

**Interfaces:**
- Consumes: `isValidItemsArray` (Task 1), `shareCategoryForId` (Task 2, now the only export used from `shareCategories.js`), `setBit`/`orMergeBytes` (already in `bits.js`, unchanged).
- Produces: `/sync` accepts and validates `items`, OR-merges it into `mergedItems` per mode, with the same stale-epoch discard as `checksSeen`. `/event` no longer touches `mergedItems` at all.

- [ ] **Step 1: Rewrite the failing/stale tests in `worker/test/room-sync.test.js` first.**

  Update the `sync()` helper to accept an optional 5th `items` argument defaulting to an all-zero 96-array, so none of the existing tests above it need editing:
  ```js
  function sync(stub, checksSeen, epoch, shareFlags, items = new Array(96).fill(0)) {
    return stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen, epoch, shareFlags, items }),
    });
  }
  ```

  Rewrite the existing `"zeroes mergedItems on reset"` test (currently drives the merge via `/event`, which no longer merges anything) to drive it via `/sync`'s `items` field instead:
  ```js
  it("zeroes mergedItems on reset", async () => {
    const stub = getStub("test-room-sync-12");
    await initRoom(stub, "checksSeen+item");
    const itemsWithSubTank = new Array(96).fill(0);
    itemsWithSubTank[4] = 0x10; // id 36, 1ItSubtank1
    await sync(stub, new Array(96).fill(0), 0, { subTank: true }, itemsWithSubTank);
    const before = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(before.mergedItems[4] & 0x10).toBe(0x10);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });
    const after = await (await sync(stub, new Array(96).fill(0), 1)).json();
    expect(after.mergedItems).toEqual(new Array(96).fill(0));
  });
  ```

  Append these new tests after it (still inside `describe("RoomDO /sync", ...)`):
  ```js
  it("OR-merges the full items array unconditionally across multiple players in checksSeen+item+all mode", async () => {
    const stub = getStub("test-room-sync-13");
    await initRoom(stub, "checksSeen+item+all");

    const playerA = new Array(96).fill(0);
    playerA[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, undefined, playerA);

    const playerB = new Array(96).fill(0);
    playerB[5] = 0x01; // id 40, 1ItWeaponLO -- no category, and that's fine in "+all" mode
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, playerB);

    const { mergedItems } = await res.json();
    expect(mergedItems[4]).toBe(0x10);
    expect(mergedItems[5]).toBe(0x01);
  });

  it("checksSeen+item mode only merges whitelisted-category bits from the incoming items array", async () => {
    const stub = getStub("test-room-sync-14");
    await initRoom(stub, "checksSeen+item");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0x10; // id 36, subTank -- whitelisted
    incoming[5] = 0x01; // id 40, 1ItWeaponLO -- no category, must NOT merge
    await sync(stub, new Array(96).fill(0), 0, { subTank: true }, incoming);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems[4]).toBe(0x10);
    expect(mergedItems[5]).toBe(0x00);
  });

  it("filters at bit granularity within a single byte -- subTank's range doesn't start on a byte boundary", async () => {
    const stub = getStub("test-room-sync-15");
    await initRoom(stub, "checksSeen+item");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0xff; // ids 32-39: 32-35 are the unused gap (no category), 36-39 are subTank
    await sync(stub, new Array(96).fill(0), 0, { subTank: true }, incoming);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems[4]).toBe(0xf0); // only bits 4-7 (ids 36-39) merged; bits 0-3 (ids 32-35) must not be
  });

  it("does not merge a category that's explicitly false in shareFlags", async () => {
    const stub = getStub("test-room-sync-16");
    await initRoom(stub, "checksSeen+item");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, { subTank: false }, incoming);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems.every((b) => b === 0)).toBe(true);
  });

  it("does not merge a category with no shareFlags entry at all", async () => {
    const stub = getStub("test-room-sync-17");
    await initRoom(stub, "checksSeen+item");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, {}, incoming);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems.every((b) => b === 0)).toBe(true);
  });

  it("never merges items in plain checksSeen mode, even given a fully-set incoming array", async () => {
    const stub = getStub("test-room-sync-18");
    await initRoom(stub, "checksSeen");
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0xff));
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems.every((b) => b === 0)).toBe(true);
  });

  it("discards a stale client's items contribution the same way it discards checksSeen (checksSeen+item+all mode)", async () => {
    const stub = getStub("test-room-sync-19");
    await initRoom(stub, "checksSeen+item+all");

    const freshItems = new Array(96).fill(0);
    freshItems[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, undefined, freshItems);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });

    const staleItems = new Array(96).fill(0);
    staleItems[5] = 0x01; // id 40, this player's own already-known bit, from before the reset
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, staleItems); // still reporting epoch 0

    const data = await res.json();
    expect(data.epoch).toBe(1); // room moved on to epoch 1
    expect(data.mergedItems.every((b) => b === 0)).toBe(true); // stale contribution NOT merged in

    const res2 = await sync(stub, new Array(96).fill(0), 1, undefined, new Array(96).fill(0));
    expect((await res2.json()).mergedItems.every((b) => b === 0)).toBe(true);
  });

  it("rejects a sync missing the items field, or with the wrong length", async () => {
    const stub = getStub("test-room-sync-20");
    await initRoom(stub, "checksSeen");
    const res1 = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), epoch: 0 }), // no items at all
    });
    expect(res1.status).toBe(400);

    const res2 = await sync(stub, new Array(96).fill(0), 0, undefined, [0, 1, 2]);
    expect(res2.status).toBe(400);
  });

  it("reflects merged item bits in admin/status's mergedItemsBitsSet after a /sync merge", async () => {
    const stub = getStub("test-room-sync-21");
    await initRoom(stub, "checksSeen+item+all");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, undefined, incoming);
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.mergedItemsBitsSet).toBe(1);
  });
  ```

- [ ] **Step 2: Rewrite the stale merge tests in `worker/test/room-event.test.js`.**

  Delete the two describe blocks `describe("RoomDO /event -- item merging (checksSeen+item mode)", ...)` and `describe("RoomDO /event -- item merging (checksSeen+item+all mode)", ...)` (everything from the `function sync(...)` helper at the bottom of the file through the end of file) and replace with:
  ```js
  // mergedItems merging now happens exclusively via /sync's own `items` field
  // (see room-sync.test.js) -- /event only logs to the event feed and
  // broadcasts over WS. These tests guard against the old event-driven merge
  // computation silently creeping back into handleEvent.
  function sync(stub, epoch = 0) {
    return stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch }),
    });
  }

  describe("RoomDO /event -- no longer merges items (moved to /sync)", () => {
    it("posting a whitelisted-category item via /event does not change mergedItems", async () => {
      const stub = getStub("test-room-event-merge-1");
      await initRoom(stub, "checksSeen+item");
      await stub.fetch("https://do/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch: 0, shareFlags: { subTank: true } }),
      });
      await postEvent(stub, { player: "a", game: 1, items: [36] }); // 1ItSubtank1
      const { mergedItems } = await (await sync(stub)).json();
      expect(mergedItems.every((b) => b === 0)).toBe(true);
    });

    it("posting a non-whitelisted item via /event in checksSeen+item+all mode does not change mergedItems", async () => {
      const stub = getStub("test-room-event-merge-2");
      await initRoom(stub, "checksSeen+item+all");
      await postEvent(stub, { player: "a", game: 1, items: [40] }); // 1ItWeaponLO, no category
      const { mergedItems } = await (await sync(stub)).json();
      expect(mergedItems.every((b) => b === 0)).toBe(true);
    });
  });
  ```
  (`getStub`, `initRoom`, and `postEvent` at the top of the file are unchanged and already suffice.)

- [ ] **Step 3: Run the tests to confirm they fail** (implementation not yet updated). From `worker/`: `npm test`. Expected: new/rewritten tests in both files FAIL; all other previously-existing tests still pass.

- [ ] **Step 4: Update `worker/src/room.js`.**

  Change the `shareCategories.js` import line to:
  ```js
  import { shareCategoryForId } from "./shareCategories.js";
  ```

  Add a module-scope helper function directly above `export class RoomDO {` (after the existing `jsonResponse` helper):
  ```js
  // Cross-PLAYER, same-byte-position OR-merge of one client's full 96-byte
  // items snapshot into the room's stored mergedItems. This NEVER projects a
  // bit from one title's byte range into another title's byte range (unlike
  // the old, deleted itemMergeSiblings sibling-projection) -- it's a straight
  // per-title, per-byte-position merge across players, so there is no more
  // "same slot number != same item across titles" risk for any item, in any
  // mode.
  function mergeIncomingItems(stored, incoming, mode, shareFlags) {
    if (mode === "checksSeen+item+all") {
      // No category filter at all -- the entire array OR-merges unconditionally.
      return orMergeBytes(stored, incoming);
    }
    if (mode !== "checksSeen+item") {
      // Plain "checksSeen" mode: items sharing isn't enabled for this room --
      // the field is still validated above (so a malformed client is still
      // caught), it's just never folded into mergedItems.
      return stored;
    }
    // "checksSeen+item": only fold in bits whose id belongs to one of the 7
    // whitelisted categories AND that category is enabled in this room's
    // shareFlags. This must be bit-granular, not byte-granular: subTank's
    // range (0x24-0x27) does not start on a byte boundary, so the byte that
    // holds subTank ids 36-39 also holds the unrelated, unwhitelisted ids
    // 32-35 -- merging the whole byte would incorrectly pull those in too.
    const merged = stored.slice();
    for (let id = 0; id < ITEMS_LENGTH * 8; id++) {
      const byteIndex = Math.floor(id / 8);
      const mask = 1 << (id % 8);
      if ((incoming[byteIndex] & mask) === 0) continue; // not set in this client's snapshot
      const category = shareCategoryForId(id);
      if (!category || !shareFlags[category]) continue; // not whitelisted, or not enabled
      if ((merged[byteIndex] & mask) === 0) {
        setBit(merged, id);
      }
    }
    return merged;
  }
  ```

  Replace `handleSync` with:
  ```js
  async handleSync(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
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
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    const storedChecksSeen = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const storedMergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);

    // Static per-seed data (read once from ROM by lua/share_info.lua, not derived
    // from player progress) -- just store whatever's sent, no merge logic needed.
    if (body.shareFlags !== undefined) {
      await this.state.storage.put("shareFlags", body.shareFlags);
    }
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};

    let checksSeen = storedChecksSeen;
    let mergedItems = storedMergedItems;
    // A client reporting a stale (pre-reset) epoch has its contribution to
    // BOTH arrays discarded -- checksSeen has always had this protection;
    // items now needs it too, since items is client-supplied on every /sync
    // as of this change (previously mergedItems was accumulated purely
    // server-side from /event, which carried no epoch, so this gate never
    // applied to it).
    if (body.epoch >= currentEpoch) {
      checksSeen = orMergeBytes(storedChecksSeen, body.checksSeen);
      await this.state.storage.put("checksSeen", checksSeen);
      mergedItems = mergeIncomingItems(storedMergedItems, body.items, mode, shareFlags);
      await this.state.storage.put("mergedItems", mergedItems);
    }

    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, mergedItems });
  }
  ```

  In `handleEvent`, delete the entire merge-computation block (the comment plus the `if (mode === "checksSeen+item" || mode === "checksSeen+item+all") { ... }` block, currently between the `if (newItems.length === 0) { ... }` early return and `const events = ...`). The function becomes:
  ```js
  async handleEvent(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    if (mode !== "checksSeen+item" && mode !== "checksSeen+item+all") {
      return jsonResponse({ error: "items sharing not enabled for this room" }, 403);
    }
    const body = await request.json().catch(() => null);
    const validationError = validateEventBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    const now = Date.now();
    // Prune stale entries so this map doesn't grow unbounded over a long session.
    for (const [key, postedAt] of this.recentlyPostedItems) {
      if (now - postedAt > DUPLICATE_EVENT_WINDOW_MS) {
        this.recentlyPostedItems.delete(key);
      }
    }

    const newItems = body.items.filter((itemId) => {
      const key = `${body.player}::${itemId}`;
      const lastPosted = this.recentlyPostedItems.get(key);
      if (lastPosted !== undefined && now - lastPosted <= DUPLICATE_EVENT_WINDOW_MS) {
        return false; // recent duplicate, skip it
      }
      this.recentlyPostedItems.set(key, now);
      return true;
    });

    if (newItems.length === 0) {
      // Every item in this request was a recent duplicate -- nothing new to log.
      return jsonResponse({ ok: true });
    }

    const events = (await this.state.storage.get("events")) ?? [];
    const event = { player: body.player, game: body.game, items: newItems, ts: now };
    events.push(event);
    const trimmed = events.slice(-MAX_EVENTS);
    await this.state.storage.put("events", trimmed);
    await this.scheduleExpiry();
    this.broadcast({ type: "event", event });
    return jsonResponse({ ok: true });
  }
  ```

  Update the `validation.js` import line to include `isValidItemsArray`:
  ```js
  import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidItemsArray, isValidEpoch, isValidShareFlags, validateEventBody } from "./validation.js";
  ```

  `handleInit`, `handleReset`, and `handleStatus` are unchanged — they already zero/count `mergedItems` correctly regardless of how it's populated.

- [ ] **Step 5: Run the full Worker test suite.** From `worker/`: `npm test`. Expected: all tests pass, including every new/rewritten one from Steps 1-2.

- [ ] **Step 6: Commit.**
  ```bash
  git add worker/src/room.js worker/test/room-sync.test.js worker/test/room-event.test.js
  git commit -m "Replace event-driven itemMergeSiblings merge with full-array cross-player OR-merge on /sync"
  ```

---

### Task 4: `lua/share_info.lua` — send the full items snapshot on every `/sync`

**Files:**
- Modify: `lua/share_info.lua`

**Interfaces:**
- Produces: the outgoing `/sync` payload's `sync.items` field, via the already-existing `readItems()`.

- [ ] **Step 1: Add `items = readItems()` to `issueRequest()`'s outgoing payload.**

  Current:
  ```lua
  local function issueRequest()
      seq = seq + 1
      outstandingSeq = seq
      Relay.writeOutbox({
          session = session,
          seq = seq,
          workerUrl = cfg.worker_url,
          roomKey = ShareLogic.extractSeedKey(sessionSave.param),
          player = cfg.player_name,
          sync = { checksSeen = readChecksSeen(), epoch = knownEpoch, shareFlags = shareFlags },
          events = pendingEvents,
      })
  end
  ```

  Change to:
  ```lua
  local function issueRequest()
      seq = seq + 1
      outstandingSeq = seq
      Relay.writeOutbox({
          session = session,
          seq = seq,
          workerUrl = cfg.worker_url,
          roomKey = ShareLogic.extractSeedKey(sessionSave.param),
          player = cfg.player_name,
          sync = { checksSeen = readChecksSeen(), items = readItems(), epoch = knownEpoch, shareFlags = shareFlags },
          events = pendingEvents,
      })
  end
  ```

  `readItems()` (already defined, reading the full flat `addrItems` region directly from `cpu`, no per-title slicing) requires no changes itself — it already returns exactly the shape the Worker's `isValidItemsArray` expects (96-length, 1-indexed Lua array of 0-255 integers).

  No other changes are needed in this file:
  - `writeMergedItems` already applies whatever `mergedItems` the Worker returns via an unconditional OR/overwrite loop — it's agnostic to how the Worker computed the array.
  - `tryConsumeInbox()` already calls `writeMergedItems(msg.sync.mergedItems, forceOverwrite)` guarded by `if msg.sync.mergedItems then` — unaffected.
  - `checkForNewItems()` remains purely a display/event-feed concern, entirely decoupled from merging now — it only ever queues an outgoing `/event` post for the toast/event-feed pipeline. It was never involved in computing `mergedItems` even under the old mechanism (that computation always lived server-side in `handleEvent`), so there's nothing to change or decouple here.

- [ ] **Step 2: Syntax-check.**

  Run: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" -e "local f,err=loadfile('lua/share_info.lua'); print(f and 'SYNTAX_OK' or ('SYNTAX_ERROR: '..err))"` from the repo root.
  Expected: `SYNTAX_OK`.

- [ ] **Step 3: Run the existing Lua test suites (regression check — this task doesn't touch either file).**

  From `lua/`: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" share_logic_test.lua` and `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" file_relay_test.lua`.
  Expected: `ALL PASS` for both.

- [ ] **Step 4: Commit.**
  ```bash
  git add lua/share_info.lua
  git commit -m "Send the full items snapshot on every /sync (readItems), not just on pickup events"
  ```

---

### Task 5: Spec addendum

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-item-merge-mode-design.md`

- [ ] Add a new addendum section (after the existing `## Addendum (2026-07-11): checksSeen+item+all mode` section) documenting this replacement: the deletion of `itemMergeSiblings`, the new `/sync`-level `items`/`mergedItems` full-array cross-player OR-merge, the bit-granular category filter for `checksSeen+item`, the new epoch-gating of `items`, and the explicitly accepted tradeoff (a single-title player no longer auto-receives items only ever found in a title they've never touched).
- [ ] Commit:
  ```bash
  git add docs/superpowers/specs/2026-07-10-item-merge-mode-design.md
  git commit -m "Document the full-array cross-player item sync replacement in the spec"
  ```

---

## Verification (end-to-end, after all 5 tasks)

- Full Worker suite green: `cd worker && npm test`.
- Full Lua syntax + unit-test check: Task 4's Steps 2 and 3.
- Manual, live verification (the real gate for any change to actual gameplay state over a network): two BizHawk instances joined to the same room.
  - `checksSeen+item` mode, a seed with e.g. Sub Tank marked shared: Player A picks up a shared item; within one `/sync` cycle, confirm Player B's game grants it (pause menu, not just the event feed), and that a non-whitelisted item Player A picks up (e.g. a boss weapon) does **not** appear for Player B.
  - `checksSeen+item+all` mode: confirm literally everything Player A picks up (including boss weapons/keys) shows up for Player B in the *same* title Player A picked it up in — and confirm a title Player B has never touched does **not** receive anything (the accepted tradeoff), since there is no more cross-title projection at all.
  - Confirm survival across a title switch away and back for both tiers (exercises `sessionSave.items` durability, not just the immediate WRAM write).
