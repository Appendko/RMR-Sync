# checksSeen+item Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `checksSeen+item` room mode — real cross-player item merging for categories a seed's own settings configured as shared — renaming today's display-only `checksSeen+items` mode to `checksSeen+item` in the process, per `docs/superpowers/specs/2026-07-10-item-merge-mode-design.md`.

**Architecture:** A new 96-byte `mergedItems` room-state array (same shape as `checksSeen`) is OR-merged server-side whenever `/event` receives a pickup whose category is enabled in the room's stored `shareFlags`, using sibling-id arithmetic (`id % 256`, `+256`, `+512`) rather than a lookup table. `/sync` returns it; `lua/share_info.lua` writes it directly into WRAM (`cpu[addrItems+i]`) and into `sessionSave.items` for durability, mirroring `writeChecksSeen` exactly.

**Tech Stack:** Cloudflare Workers + Durable Objects (Vitest + `@cloudflare/vitest-pool-workers`), Lua 5.4 (BizHawk).

## Global Constraints

- New mode string is exactly `"checksSeen+item"` (singular), replacing `"checksSeen+items"` everywhere in `worker/`, `admin/host_admin.html`, and `lua/share_info.lua` — **except** the two historical files `docs/superpowers/specs/2026-07-04-share-information-mod-design.md` and `docs/superpowers/plans/2026-07-04-share-information-mod.md`, which describe already-shipped work and must not be edited.
- `mergedItems`: a 96-byte array, one byte per 8 packed item-id bits (id → byte `Math.floor(id/8)`, bit `id % 8`) — identical packing convention to `checksSeen`/`readItems()`.
- The 7 category keys are exactly: `lifeUp`, `energyUp`, `subTank`, `sigmaKey`, `finalWeapon`, `armor`, `upgradeItem` — matching `worker/src/validation.js`'s existing `SHARE_FLAG_KEYS` exactly (no new/renamed keys).
- Sibling ids for merging: `id % 256`, `(id % 256) + 256`, `(id % 256) + 512`.
- Merging only ever applies when the room's `mode === "checksSeen+item"` AND `shareFlags[category] === true`. Never merge a category with no `shareCategoryForId` match (boss weapons/keys, stage-varied, Vava-family, Ride Armor, Zero parts, `ItLifeS`/`ItWeaponS`/`ItFullRecover`/`ItEmpty`).
- `mergedItems` is zeroed on `/admin/init` and `/admin/reset`, and returned by `/sync` — never included in the WS `/ws` `init` message (event-feed display doesn't need it).
- Do **not** add a `mergedItemsBitsSet` field or otherwise touch `handleStatus` — out of scope for this plan, not part of the reviewed spec, and would ripple into 5 exact-shape assertions in `worker/test/room-admin.test.js` for no requirement that asked for it.
- `ref/` and the two 2026-07-04 spec/plan docs are read-only reference material — never modified.

---

### Task 1: Rename `checksSeen+items` → `checksSeen+item`

**Files:**
- Modify: `worker/src/validation.js:1`
- Modify: `worker/src/room.js:165`
- Modify: `lua/share_info.lua:184`
- Modify: `admin/host_admin.html:31`
- Modify: `worker/test/validation.test.js:7`
- Modify: `worker/test/room-event.test.js` (7 occurrences: lines 56, 67, 74, 84, 99, 116, 128)
- Modify: `worker/test/room-ws.test.js` (4 occurrences: lines 32, 45, 54, 71)
- Modify: `worker/test/room-admin.test.js` (11 occurrences: lines 28, 65, 67, 69, 92, 93, 95, 111, 119, 156, 159)
- Modify: `worker/test/routing.test.js:21`

**Interfaces:**
- Produces: the string `"checksSeen+item"` as the only non-`"checksSeen"` value accepted anywhere in `VALID_MODES` and everywhere else this task touches. Every later task in this plan uses this exact string.

- [ ] **Step 1: Replace every literal occurrence of the string `checksSeen+items` with `checksSeen+item` in the 10 files listed above.**

  This is a pure find-and-replace of one literal string — every occurrence in each listed file changes the same way, e.g. `"checksSeen+items"` → `"checksSeen+item"` (JS/test files), `mode ~= "checksSeen+items"` → `mode ~= "checksSeen+item"` (Lua), and in `admin/host_admin.html` both the `value` and visible label:
  ```html
  <option value="checksSeen+item">checksSeen + item</option>
  ```
  Do **not** touch `docs/superpowers/specs/2026-07-04-share-information-mod-design.md` or `docs/superpowers/plans/2026-07-04-share-information-mod.md` — both contain the old string describing already-shipped history and must stay as written.

- [ ] **Step 2: Add a regression test asserting the old string is now rejected.**

  In `worker/test/validation.test.js`, in the `describe("isValidMode", ...)` block's `"rejects anything else"` test, add one line:
  ```js
  it("rejects anything else", () => {
    expect(isValidMode("items")).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(123)).toBe(false);
    expect(isValidMode("checksSeen+items")).toBe(false);
  });
  ```

- [ ] **Step 3: Verify no occurrences remain outside the two protected historical files.**

  Run: `grep -rn "checksSeen+items" --include="*.js" --include="*.lua" --include="*.html" .` from the repo root (or the Grep tool with the same pattern). Expected: zero matches in any file under `worker/`, `lua/`, or `admin/`.

- [ ] **Step 4: Run the full Worker test suite.**

  Run from `worker/`: `npm test`
  Expected: all tests pass (same count as before this task, since this is a pure rename with one new assertion added).

- [ ] **Step 5: Syntax-check the Lua file.**

  Run: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" -e "local f,err=loadfile('lua/share_info.lua'); print(f and 'SYNTAX_OK' or ('SYNTAX_ERROR: '..err))"` from the repo root.
  Expected: `SYNTAX_OK`.

- [ ] **Step 6: Commit.**
  ```bash
  git add worker/src/validation.js worker/src/room.js lua/share_info.lua admin/host_admin.html worker/test/validation.test.js worker/test/room-event.test.js worker/test/room-ws.test.js worker/test/room-admin.test.js worker/test/routing.test.js
  git commit -m "Rename checksSeen+items mode to checksSeen+item"
  ```

---

### Task 2: Add `setBit` to `worker/src/bits.js`

**Files:**
- Modify: `worker/src/bits.js`
- Modify: `worker/test/bits.test.js`

**Interfaces:**
- Produces: `setBit(bytes: number[], id: number): void` — mutates `bytes` in place, setting the bit for `id` (packing convention: byte `Math.floor(id/8)`, bit `id % 8`). Consumed by Task 4's `room.js` changes.

- [ ] **Step 1: Add `setBit` to `worker/src/bits.js`.**

  Current full file:
  ```js
  export function orMergeBytes(a, b) {
    if (a.length !== b.length) {
      throw new Error(`orMergeBytes: length mismatch (${a.length} vs ${b.length})`);
    }
    const merged = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      merged[i] = (a[i] | b[i]) & 0xff;
    }
    return merged;
  }

  export function countSetBits(bytes) {
    let count = 0;
    for (const byte of bytes) {
      let v = byte;
      while (v > 0) {
        count += v & 1;
        v >>= 1;
      }
    }
    return count;
  }
  ```

  Add this function at the end of the file:
  ```js

  // Sets a single item id's bit in a byte array using the same packing
  // convention as checksSeen/mergedItems/addrItems: byte Math.floor(id/8),
  // bit (id % 8). Mutates `bytes` in place.
  export function setBit(bytes, id) {
    const byteIndex = Math.floor(id / 8);
    const mask = 1 << (id % 8);
    bytes[byteIndex] = (bytes[byteIndex] | mask) & 0xff;
  }
  ```

- [ ] **Step 2: Write the test.**

  Add to `worker/test/bits.test.js` (update the import line and append a new `describe` block):
  ```js
  import { orMergeBytes, countSetBits, setBit } from "../src/bits.js";
  ```
  ```js
  describe("setBit", () => {
    it("sets the correct bit within the correct byte", () => {
      const bytes = new Array(96).fill(0);
      setBit(bytes, 36); // byte 4, bit 4 (0x10)
      expect(bytes[4]).toBe(0x10);
      expect(bytes.filter((b) => b !== 0)).toHaveLength(1);
    });

    it("ORs into an existing byte without clobbering other bits", () => {
      const bytes = new Array(96).fill(0);
      bytes[4] = 0x01; // some other bit already set in the same byte
      setBit(bytes, 36); // bit 4 (0x10) of the same byte
      expect(bytes[4]).toBe(0x11);
    });

    it("is idempotent -- setting an already-set bit changes nothing", () => {
      const bytes = new Array(96).fill(0);
      setBit(bytes, 36);
      setBit(bytes, 36);
      expect(bytes[4]).toBe(0x10);
    });
  });
  ```

- [ ] **Step 3: Run the test suite.**

  Run from `worker/`: `npm test`
  Expected: all tests pass, including the 3 new `setBit` tests.

- [ ] **Step 4: Commit.**
  ```bash
  git add worker/src/bits.js worker/test/bits.test.js
  git commit -m "Add setBit helper to worker/src/bits.js"
  ```

---

### Task 3: `worker/src/shareCategories.js` — item-id category classifier

**Files:**
- Create: `worker/src/shareCategories.js`
- Test: `worker/test/shareCategories.test.js`

**Interfaces:**
- Produces: `shareCategoryForId(id: number): string | null` and `itemMergeSiblings(id: number): [number, number, number]`. Consumed by Task 4's `room.js` changes.

- [ ] **Step 1: Write the failing tests first.**

  Create `worker/test/shareCategories.test.js`:
  ```js
  import { describe, it, expect } from "vitest";
  import { readFileSync } from "node:fs";
  import vm from "node:vm";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  import { shareCategoryForId, itemMergeSiblings } from "../src/shareCategories.js";

  describe("shareCategoryForId", () => {
    it("classifies lifeUp (0x00-0x0F)", () => {
      expect(shareCategoryForId(0)).toBe("lifeUp"); // 1ItLifeUp1
      expect(shareCategoryForId(13)).toBe("lifeUp"); // 1ItLifeUpD6, 0x0D
      expect(shareCategoryForId(256)).toBe("lifeUp"); // 2ItLifeUp1
      expect(shareCategoryForId(512 + 13)).toBe("lifeUp"); // 3ItLifeUpD6
    });

    it("classifies energyUp (0x10-0x1F)", () => {
      expect(shareCategoryForId(16)).toBe("energyUp"); // 1ItEnergyUp1
      expect(shareCategoryForId(29)).toBe("energyUp"); // 1ItEnergyUp14, 0x1D
    });

    it("classifies subTank (0x24-0x27)", () => {
      expect(shareCategoryForId(36)).toBe("subTank"); // 1ItSubtank1
      expect(shareCategoryForId(39)).toBe("subTank"); // 1ItSubtank4
    });

    it("classifies sigmaKey (0x40-0x4F)", () => {
      expect(shareCategoryForId(64)).toBe("sigmaKey"); // 1ItKeyS1
      expect(shareCategoryForId(76)).toBe("sigmaKey"); // 1ItKeyS13, 0x4C
      expect(shareCategoryForId(589)).toBe("sigmaKey"); // 3ItKeyS14, 512+0x4D
    });

    it("classifies finalWeapon (exactly 0x50)", () => {
      expect(shareCategoryForId(80)).toBe("finalWeapon"); // 1ItHadouken
      expect(shareCategoryForId(336)).toBe("finalWeapon"); // 2ItShoryuken
      expect(shareCategoryForId(592)).toBe("finalWeapon"); // 3ItSaber
    });

    it("classifies armor (0x58-0x5F)", () => {
      expect(shareCategoryForId(88)).toBe("armor"); // 1ItHeadPart
      expect(shareCategoryForId(95)).toBe("armor"); // 1ItFootChip
    });

    it("classifies upgradeItem (0x60-0x73)", () => {
      expect(shareCategoryForId(96)).toBe("upgradeItem"); // 1ItBusterAmmo1
      expect(shareCategoryForId(115)).toBe("upgradeItem"); // 1ItCharge150, 0x73
    });

    it("returns null for boss weapons/keys, stage-varied codes, and the gap between energyUp and subTank", () => {
      expect(shareCategoryForId(40)).toBeNull(); // 1ItWeaponLO, 0x28
      expect(shareCategoryForId(48)).toBeNull(); // 1ItKeyLO, 0x30
      expect(shareCategoryForId(57)).toBeNull(); // 1ItStageVariedSC, 0x39
      expect(shareCategoryForId(32)).toBeNull(); // 0x20, unused gap (boot.lua's own "Unknown Item" range)
    });

    it("returns null for the ItEmpty sentinel", () => {
      expect(shareCategoryForId(255)).toBeNull();
    });
  });

  describe("itemMergeSiblings", () => {
    it("returns the same 3 ids regardless of which title's id you start from", () => {
      expect(itemMergeSiblings(36)).toEqual([36, 292, 548]); // Sub Tank #1, starting from title 1
      expect(itemMergeSiblings(292)).toEqual([36, 292, 548]); // same slot, starting from title 2
      expect(itemMergeSiblings(548)).toEqual([36, 292, 548]); // same slot, starting from title 3
    });
  });

  // Cross-checks against tracker/icon_map.js's shareCategoryFor (string-code
  // based) for every real id in tracker/item_id_map.js, guarding the two
  // independent implementations against drifting apart -- see
  // docs/superpowers/specs/2026-07-10-item-merge-mode-design.md's
  // Verification section.
  describe("shareCategoryForId matches tracker/icon_map.js's shareCategoryFor", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const trackerDir = path.join(dir, "..", "..", "tracker");
    const context = {};
    vm.createContext(context);

    // item_id_map.js declares ITEM_ID_MAP via `const`, which vm does NOT
    // expose as a context object property (unlike `function`/`var`
    // declarations) -- bridge it onto the context object explicitly from
    // within the same script execution, where the const binding is in scope.
    const itemIdMapSrc = readFileSync(path.join(trackerDir, "item_id_map.js"), "utf8");
    vm.runInContext(itemIdMapSrc + "\nthis.ITEM_ID_MAP = ITEM_ID_MAP;\n", context);
    for (const file of ["item_names_en.js", "item_names_ja.js", "item_names_zhtw.js", "icon_map.js"]) {
      vm.runInContext(readFileSync(path.join(trackerDir, file), "utf8"), context);
    }
    const { ITEM_ID_MAP, shareCategoryFor } = context;

    it("agrees for every id in ITEM_ID_MAP", () => {
      for (const idStr of Object.keys(ITEM_ID_MAP)) {
        const id = Number(idStr);
        const code = ITEM_ID_MAP[id];
        expect(shareCategoryForId(id)).toBe(shareCategoryFor(code));
      }
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail (the module doesn't exist yet).**

  Run from `worker/`: `npm test -- shareCategories`
  Expected: FAIL with a module-not-found error for `../src/shareCategories.js`.

- [ ] **Step 3: Write `worker/src/shareCategories.js`.**
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

  // The three sibling ids representing "the same slot" across all 3 titles --
  // each title's own item block is exactly 256 ids wide.
  export function itemMergeSiblings(id) {
    const slot = id % 256;
    return [slot, slot + 256, slot + 512];
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass.**

  Run from `worker/`: `npm test -- shareCategories`
  Expected: PASS, all cases including the full cross-check against `tracker/icon_map.js`.

- [ ] **Step 5: Run the full Worker test suite.**

  Run from `worker/`: `npm test`
  Expected: all tests pass.

- [ ] **Step 6: Commit.**
  ```bash
  git add worker/src/shareCategories.js worker/test/shareCategories.test.js
  git commit -m "Add shareCategories.js: numeric item-id classifier for cross-player merging"
  ```

---

### Task 4: `worker/src/room.js` — `mergedItems` storage, merge-on-event, sync response

**Files:**
- Modify: `worker/src/room.js`
- Modify: `worker/test/room-sync.test.js`
- Modify: `worker/test/room-event.test.js`

**Interfaces:**
- Consumes: `setBit` from `worker/src/bits.js` (Task 2), `shareCategoryForId`/`itemMergeSiblings` from `worker/src/shareCategories.js` (Task 3), the renamed `"checksSeen+item"` string (Task 1).
- Produces: `/sync` responses include a `mergedItems` field (96-byte array); `/admin/init` and `/admin/reset` both initialize/reset it to an all-zero 96-byte array; `/event` OR-merges eligible pickups into it.

- [ ] **Step 1: Write the failing tests first.**

  In `worker/test/room-sync.test.js`, add (after the existing tests, before the closing `});` of the `describe("RoomDO /sync", ...)` block):
  ```js
  it("defaults to an empty mergedItems array before any shared item is picked up", async () => {
    const stub = getStub("test-room-sync-11");
    await initRoom(stub, "checksSeen+item");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect((await res.json()).mergedItems).toEqual(new Array(96).fill(0));
  });

  it("zeroes mergedItems on reset", async () => {
    const stub = getStub("test-room-sync-12");
    await initRoom(stub, "checksSeen+item");
    await sync(stub, new Array(96).fill(0), 0, { subTank: true });
    await stub.fetch("https://do/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "a", game: 1, items: [36] }),
    });
    const before = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(before.mergedItems.some((b) => b !== 0)).toBe(true);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });
    const after = await (await sync(stub, new Array(96).fill(0), 1)).json();
    expect(after.mergedItems).toEqual(new Array(96).fill(0));
  });
  ```
  This requires `sync()`'s existing signature (`sync(stub, checksSeen, epoch, shareFlags)`, already accepting a 4th `shareFlags` argument) — no changes needed to that helper.

  In `worker/test/room-event.test.js`, add a new `describe` block after the existing `describe("RoomDO /event", ...)` block closes:
  ```js
  function sync(stub, epoch = 0) {
    return stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), epoch }),
    });
  }

  async function initRoomWithShareFlags(stub, shareFlags) {
    await initRoom(stub, "checksSeen+item");
    await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), epoch: 0, shareFlags }),
    });
  }

  describe("RoomDO /event -- item merging (checksSeen+item mode)", () => {
    it("merges a shared-category pickup into all 3 titles' sibling ids", async () => {
      const stub = getStub("test-room-merge-1");
      await initRoomWithShareFlags(stub, { subTank: true });
      await postEvent(stub, { player: "a", game: 1, items: [36] }); // 1ItSubtank1
      const { mergedItems } = await (await sync(stub)).json();
      expect(mergedItems[4] & 0x10).toBe(0x10); // id 36: byte 4, bit 4
      expect(mergedItems[36] & 0x10).toBe(0x10); // id 292: byte 36, bit 4
      expect(mergedItems[68] & 0x10).toBe(0x10); // id 548: byte 68, bit 4
    });

    it("does not merge a category that's explicitly false in shareFlags", async () => {
      const stub = getStub("test-room-merge-2");
      await initRoomWithShareFlags(stub, { subTank: false });
      await postEvent(stub, { player: "a", game: 1, items: [36] });
      const { mergedItems } = await (await sync(stub)).json();
      expect(mergedItems.every((b) => b === 0)).toBe(true);
    });

    it("does not merge a category with no shareFlags entry at all", async () => {
      const stub = getStub("test-room-merge-3");
      await initRoomWithShareFlags(stub, {});
      await postEvent(stub, { player: "a", game: 1, items: [36] });
      const { mergedItems } = await (await sync(stub)).json();
      expect(mergedItems.every((b) => b === 0)).toBe(true);
    });

    it("never merges an item with no share category, even if every flag is enabled", async () => {
      const stub = getStub("test-room-merge-4");
      await initRoomWithShareFlags(stub, {
        lifeUp: true, energyUp: true, subTank: true, sigmaKey: true,
        finalWeapon: true, armor: true, upgradeItem: true,
      });
      await postEvent(stub, { player: "a", game: 1, items: [40] }); // 1ItWeaponLO, no category
      const { mergedItems } = await (await sync(stub)).json();
      expect(mergedItems.every((b) => b === 0)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run from `worker/`: `npm test`
  Expected: the new tests FAIL (`mergedItems` is `undefined` in responses; `shareCategoryForId`/`itemMergeSiblings`/`setBit` aren't wired into `room.js` yet). All previously-existing tests still PASS (no regressions from this step alone, since only test files changed so far).

- [ ] **Step 3: Update `worker/src/room.js`.**

  Change the import line and add a constant:
  ```js
  import { orMergeBytes, countSetBits, setBit } from "./bits.js";
  import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidEpoch, isValidShareFlags, validateEventBody } from "./validation.js";
  import { shareCategoryForId, itemMergeSiblings } from "./shareCategories.js";

  const CHECKS_SEEN_LENGTH = 96;
  const ITEMS_LENGTH = 96;
  const MAX_EVENTS = 200;
  const EXPIRY_MS = 24 * 60 * 60 * 1000;
  const DUPLICATE_EVENT_WINDOW_MS = 15000;
  ```

  In `handleInit`, add one line after the `checksSeen` init:
  ```js
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
  ```

  In `handleReset`, add the same line in the same relative position:
  ```js
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
  ```

  In `handleSync`, add `mergedItems` to what's read and returned:
  ```js
  async handleSync(request) {
      const mode = await this.state.storage.get("mode");
      if (!mode) {
        return jsonResponse({ error: "room not initialized" }, 409);
      }
      const body = await request.json().catch(() => null);
      if (!body || !isValidChecksSeenArray(body.checksSeen) || !isValidEpoch(body.epoch) || !isValidShareFlags(body.shareFlags)) {
        return jsonResponse({ error: "invalid checksSeen, epoch, or shareFlags" }, 400);
      }
      const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
      const stored = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);

      let merged = stored;
      if (body.epoch >= currentEpoch) {
        merged = orMergeBytes(stored, body.checksSeen);
        await this.state.storage.put("checksSeen", merged);
      }
      if (body.shareFlags !== undefined) {
        await this.state.storage.put("shareFlags", body.shareFlags);
      }
      const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
      const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
      await this.scheduleExpiry();
      return jsonResponse({ mode, checksSeen: merged, epoch: currentEpoch, shareFlags, mergedItems });
    }
  ```

  In `handleEvent`, insert the merge step between the existing `if (newItems.length === 0) { ... }` early return and the event-log append:
  ```js
      if (newItems.length === 0) {
        // Every item in this request was a recent duplicate -- nothing new to log.
        return jsonResponse({ ok: true });
      }

      // Real cross-player item merging (checksSeen+item mode only): for each
      // newly-accepted item whose category is enabled in this seed's
      // shareFlags, OR its bit into all 3 titles' sibling ids so every
      // player's next /sync grants it in their own game too.
      if (mode === "checksSeen+item") {
        const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
        const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
        let mergedChanged = false;
        for (const itemId of newItems) {
          const category = shareCategoryForId(itemId);
          if (!category || !shareFlags[category]) continue;
          for (const siblingId of itemMergeSiblings(itemId)) {
            const byteIndex = Math.floor(siblingId / 8);
            const mask = 1 << (siblingId % 8);
            if ((mergedItems[byteIndex] & mask) === 0) {
              setBit(mergedItems, siblingId);
              mergedChanged = true;
            }
          }
        }
        if (mergedChanged) {
          await this.state.storage.put("mergedItems", mergedItems);
        }
      }

      const events = (await this.state.storage.get("events")) ?? [];
  ```

  Note this file's `handleEvent` already unconditionally rejects any mode other than `"checksSeen+item"` earlier in the function (from Task 1's rename of the existing `if (mode !== "checksSeen+item")` gate), so the `if (mode === "checksSeen+item")` check just added is technically always true by the time it's reached — kept explicit anyway for readability and to guard against that earlier gate ever being loosened in a future mode (e.g. a hypothetical mode that accepts events but shouldn't merge).

- [ ] **Step 4: Run the tests to verify they pass.**

  Run from `worker/`: `npm test`
  Expected: all tests pass, including every new one from Step 1.

- [ ] **Step 5: Commit.**
  ```bash
  git add worker/src/room.js worker/test/room-sync.test.js worker/test/room-event.test.js
  git commit -m "Add mergedItems room state and cross-player item-merge logic"
  ```

---

### Task 5: `lua/share_info.lua` — apply merged items to WRAM

**Files:**
- Modify: `lua/share_info.lua`

**Interfaces:**
- Consumes: `msg.sync.mergedItems` (a 96-byte array) from `/sync` responses, per Task 4.

- [ ] **Step 1: Add `writeMergedItems`, directly after the existing `writeChecksSeen` function.**

  Current `writeChecksSeen` (for context — unchanged):
  ```lua
  local function writeChecksSeen(merged, forceOverwrite)
      for i = 0, 95 do
          if forceOverwrite then
              sessionSave.checksSeen[i] = merged[i + 1]
          else
              sessionSave.checksSeen[i] = (sessionSave.checksSeen[i] or 0) | merged[i + 1]
          end
      end
      local title = currentTitle()
      local baseOffset = (title - 1) * cChecksPerTitle
      for i = 0, cChecksPerTitle - 1 do
          if forceOverwrite then
              cpu[addrChecksSeen + i] = merged[baseOffset + i + 1]
          else
              cpu[addrChecksSeen + i] = cpu[addrChecksSeen + i] | merged[baseOffset + i + 1]
          end
      end
  end
  ```

  Add immediately after it:
  ```lua

  -- Unlike writeChecksSeen, no currentTitle()/baseOffset slicing is needed:
  -- addrItems is already a flat, all-3-titles-simultaneously region (per
  -- boot.lua's own "全タイトル分" comment), so this is a straight 96-byte
  -- OR-loop. Written into both sessionSave.items (so a later, unrelated
  -- title switch doesn't lose it when boot.lua restores addrItems from its
  -- own sessionSave.items) and live RAM (immediate effect, confirmed
  -- sufficient by direct BizHawk testing: manually OR-ing a title's own item
  -- bit into WRAM after switching to it, with no reboot involved, was enough
  -- for the game to recognize the item as owned).
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

- [ ] **Step 2: Wire it into `tryConsumeInbox()`.**

  Current:
  ```lua
  local function tryConsumeInbox()
      local msg = Relay.readInbox()
      if not ShareLogic.isResponseFor(msg, session, outstandingSeq) then
          return
      end
      if msg.ok and msg.sync then
          shareMode = msg.sync.mode
          local forceOverwrite = ShareLogic.shouldForceOverwrite(msg.sync.epoch, knownEpoch)
          knownEpoch = msg.sync.epoch
          writeChecksSeen(msg.sync.checksSeen, forceOverwrite)
          pendingEvents = {}
          statusLine("synced (epoch " .. knownEpoch .. ")")
      else
          statusLine(tostring(msg.error or "relay error"))
      end
      outstandingSeq = nil
      staleCycles = 0
  end
  ```

  Change to:
  ```lua
  local function tryConsumeInbox()
      local msg = Relay.readInbox()
      if not ShareLogic.isResponseFor(msg, session, outstandingSeq) then
          return
      end
      if msg.ok and msg.sync then
          shareMode = msg.sync.mode
          local forceOverwrite = ShareLogic.shouldForceOverwrite(msg.sync.epoch, knownEpoch)
          knownEpoch = msg.sync.epoch
          writeChecksSeen(msg.sync.checksSeen, forceOverwrite)
          if msg.sync.mergedItems then
              writeMergedItems(msg.sync.mergedItems, forceOverwrite)
          end
          pendingEvents = {}
          statusLine("synced (epoch " .. knownEpoch .. ")")
      else
          statusLine(tostring(msg.error or "relay error"))
      end
      outstandingSeq = nil
      staleCycles = 0
  end
  ```

  The `if msg.sync.mergedItems then` guard keeps this safe against talking to an older-deployed Worker that doesn't return the field yet.

- [ ] **Step 3: Syntax-check.**

  Run: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" -e "local f,err=loadfile('lua/share_info.lua'); print(f and 'SYNTAX_OK' or ('SYNTAX_ERROR: '..err))"` from the repo root.
  Expected: `SYNTAX_OK`.

- [ ] **Step 4: Run the existing Lua test suites (unaffected, but confirm no regressions).**

  Run from `lua/`: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" share_logic_test.lua` and `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" file_relay_test.lua`
  Expected: `ALL PASS` for both (this task doesn't touch `share_logic.lua`/`file_relay.lua`, so this is a regression check, not new coverage).

- [ ] **Step 5: Commit.**
  ```bash
  git add lua/share_info.lua
  git commit -m "Apply mergedItems from /sync into WRAM in share_info.lua"
  ```

---

## Verification (end-to-end, after all 5 tasks)

- Full Worker suite green: `cd worker && npm test`.
- Full Lua syntax + unit-test check: Task 5's Step 3 and Step 4 commands.
- Manual, live verification (the real gate — this feature changes actual gameplay state over a network, which no automated test can cover): two BizHawk instances joined to the same room, mode `checksSeen+item`, a seed with at least one category (e.g. Sub Tank) marked shared in its own settings. Player A picks up a shared item; within one `/sync` cycle (the existing fast item-check timer or the ~10s idle heartbeat), confirm Player B's game grants it — check in-game usability (pause menu, etc.), not just the event feed — and confirm it survives Player B switching titles away and back (exercises the `sessionSave.items` durability path, not just the immediate WRAM write already proven manually).
