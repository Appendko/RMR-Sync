# "Seen + All Items + Progress" Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth room mode, `checksSeen+items+checks`, that syncs real check completion (`sessionSave.checks`/`addrChecks` — actual game progress, distinct from `checksSeen`'s scouted/hinted visibility) across players using the exact same same-title, cross-player OR-merge mechanism `checksSeen` already uses. Includes a minimal (unlocalized) event-feed entry for check completions, a display-only mode-name rename ("Seen" / "Seen + Common Items" / "Seen + All Items" / "Seen + All Items + Progress"), and check-name authoring tooling (an audit page + name-table scaffolding) so the project owner and collaborators can grow a fully localized display later.

**Architecture:** `checks` is structurally identical to `checksSeen` (96-byte array, 32 bytes/title, reused WRAM window per title) — NOT to `items` (flat, all-3-titles-resident). `sessionSave.checks` already exists and is already maintained by `boot.lua`'s own `updateSaveValue` loop; this plan only adds the multiplayer sync layer on top, mirroring `readChecksSeen`/`writeChecksSeen` almost verbatim. `checks` merges unconditionally (no category filter — checks aren't item-categorized) only in the new mode. Item-merging in the new mode is a verbatim continuation of `checksSeen+items`'s existing behavior, not new logic.

**Tech Stack:** Cloudflare Workers (Durable Objects, Vitest), Lua (BizHawk), vanilla browser JS/HTML (tracker/admin pages, no build step).

## Global Constraints

- New mode string: `checksSeen+items+checks` (added to `VALID_MODES`). Stacks only on top of `checksSeen+items` — there is no `checksSeen+shared+checks` variant.
- `checks` is a 96-byte array, same bit-packing as `checksSeen`/`items` (byte `Math.floor(id/8)`, bit `id % 8`). Required on every `/sync` call regardless of mode (same reasoning as `items`: one validation path, no mode-conditional wire shape) — but only folded into the room's stored `checks` state when mode is `checksSeen+items+checks`.
- `checks` merges unconditionally (no `shareFlags`/category gate) — checks aren't item-categorized. Same epoch-gated stale-discard protection as `checksSeen`/`items` (the identical `body.epoch >= currentEpoch` block in `handleSync`).
- **Item-merging in the new mode must behave exactly like `checksSeen+items`.** `mergeIncomingItems`'s `mode === "checksSeen+items"` branch must be extended to also match `checksSeen+items+checks` — this is a verbatim continuation of existing behavior, not new logic, and is easy to silently miss.
- `/event`'s body gains an optional `checks: number[]` field alongside the existing `items` — same shape/bounds (1-20 entries, ids 0-767). `validateEventBody` is relaxed to require at least one of `items`/`checks` (not `items` specifically).
- **Duplicate-event-window keys must be namespaced by kind** (`` `${player}::item::${id}` `` / `` `${player}::check::${id}` ``) since item ids and check ids share the same 0-767 numeric space and would otherwise collide.
- `/event`'s mode gate extends to also allow `checksSeen+items+checks` through (a superset tier — it still wants item-pickup display too).
- Check-completion display is deliberately minimal: the raw ported short code (e.g. `"1ChAASubtank"`), no icon. The three per-language name-table files (`check_names_en.js`/`_ja.js`/`_zhtw.js`) **all start empty** in this plan — a confident best-effort English pass isn't achievable without further verification against actual gameplay (several of the ported short codes' boss-abbreviation initials don't cleanly match known Mega Man X boss names, e.g. `BN`/`IP` in the X1 set), so embedding guessed names risks actively misleading the authoring process the audit page exists to support. The audit page's fallback display (showing the raw code when no name is authored yet) is the intended starting point for authoring, exactly mirroring `icon_audit.js`'s own "mechanical fallback" pattern.
- Display-only mode-name translation (wire strings unchanged): `checksSeen` → "Seen", `checksSeen+shared` → "Seen + Common Items", `checksSeen+items` → "Seen + All Items", `checksSeen+items+checks` → "Seen + All Items + Progress". Used at `tracker/event_feed.js`'s status line and `admin/host_admin.html`'s dropdown option labels/status display.
- `handleStatus` gains a `checksBitsSet` field (`countSetBits` of the stored `checks` array), mirroring the existing `checksSeenBitsSet`/`mergedItemsBitsSet` fields — a natural, minimal, consistent addition even though not explicitly called out in the spec, matching the project's own established pattern.
- Files explicitly **not** touched: `worker/src/bits.js`, `worker/src/shareCategories.js` (checks aren't item-categorized, no changes needed there), `worker/src/index.js`, `worker/src/cors.js`, `lua/share_logic.lua` (no new pure logic needed — `ShareLogic.shouldReportAcquired` is reused as-is), `lua/file_relay.lua`, `lua/config.lua`, `tracker/icon_map.js`, `tracker/item_id_map.js`, `tracker/item_names_*.js`, `tracker/icon_audit.js`/`.html` (referenced as a pattern to mirror, not modified), `handleWebSocket`/`/ws`'s init message (unchanged — `checks` is `/sync`-only state, same precedent as `mergedItems`).

---

### Task 1: `worker/src/validation.js` — new mode, `isValidChecksArray`, relaxed `validateEventBody`

**Files:**
- Modify: `worker/src/validation.js`
- Modify: `worker/test/validation.test.js`

**Interfaces:**
- Produces: `isValidChecksArray(arr): boolean` (96-byte validator, consumed by Task 2). `validateEventBody` now accepts a body with `items` and/or `checks` (consumed by Task 3).

- [ ] **Step 1: Update `worker/src/validation.js`.**

  Current full file:
  ```js
  const VALID_MODES = ["checksSeen", "checksSeen+shared", "checksSeen+items"];
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
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
      return "items must be a non-empty array of up to 20 entries";
    }
    if (!body.items.every((item) => Number.isInteger(item) && item >= 0 && item <= 767)) {
      return "each item must be an integer item ID between 0 and 767";
    }
    return null;
  }

  export function isValidAdminSecret(secret) {
    return typeof secret === "string" && secret.length > 0 && secret.length <= 100;
  }

  export function isValidEpoch(value) {
    return Number.isInteger(value) && value >= 0;
  }

  export function isValidShareFlags(value) {
    if (value === undefined) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return Object.keys(value).every((key) => SHARE_FLAG_KEYS.includes(key) && typeof value[key] === "boolean");
  }
  ```

  Replace the whole file with:
  ```js
  const VALID_MODES = ["checksSeen", "checksSeen+shared", "checksSeen+items", "checksSeen+items+checks"];
  const CHECKS_SEEN_LENGTH = 96;
  const ITEMS_LENGTH = 96;
  const CHECKS_LENGTH = 96;
  const SHARE_FLAG_KEYS = ["lifeUp", "energyUp", "armor", "subTank", "finalWeapon", "sigmaKey", "upgradeItem"];

  export function isValidMode(mode) {
    return VALID_MODES.includes(mode);
  }

  // checksSeen, items, and checks are all 96-byte arrays, one bit per id (byte
  // Math.floor(id/8), bit id % 8) -- shared validator, exposed under three
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

  // The client's full 96-byte real check-completion snapshot
  // (lua/share_info.lua's readChecks(), reading sessionSave.checks -- same
  // shape as checksSeen, but real progress rather than scouted/hinted
  // visibility), sent on every /sync alongside checksSeen/items so
  // room.js's handleSync can OR-merge it across players into a room-level
  // `checks` state, in checksSeen+items+checks mode only.
  export function isValidChecksArray(arr) {
    return isValidByteArray(arr, CHECKS_LENGTH);
  }

  function isValidIdArray(arr) {
    return Array.isArray(arr) && arr.length > 0 && arr.length <= 20 && arr.every((id) => Number.isInteger(id) && id >= 0 && id <= 767);
  }

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
    if (!hasItems && !hasChecks) {
      return "body must include at least one of items or checks";
    }
    if (hasItems && !isValidIdArray(body.items)) {
      return "items must be a non-empty array of up to 20 integer ids between 0 and 767";
    }
    if (hasChecks && !isValidIdArray(body.checks)) {
      return "checks must be a non-empty array of up to 20 integer ids between 0 and 767";
    }
    return null;
  }

  export function isValidAdminSecret(secret) {
    return typeof secret === "string" && secret.length > 0 && secret.length <= 100;
  }

  export function isValidEpoch(value) {
    return Number.isInteger(value) && value >= 0;
  }

  export function isValidShareFlags(value) {
    if (value === undefined) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return Object.keys(value).every((key) => SHARE_FLAG_KEYS.includes(key) && typeof value[key] === "boolean");
  }
  ```

- [ ] **Step 2: Update `worker/test/validation.test.js`.**

  Update the import line:
  ```js
  import { isValidMode, isValidChecksSeenArray, isValidItemsArray, isValidChecksArray, validateEventBody, isValidAdminSecret, isValidEpoch, isValidShareFlags } from "../src/validation.js";
  ```

  Update `isValidMode`'s tests:
  ```js
  describe("isValidMode", () => {
    it("accepts the four known modes", () => {
      expect(isValidMode("checksSeen")).toBe(true);
      expect(isValidMode("checksSeen+shared")).toBe(true);
      expect(isValidMode("checksSeen+items")).toBe(true);
      expect(isValidMode("checksSeen+items+checks")).toBe(true);
    });

    it("rejects anything else", () => {
      expect(isValidMode("items")).toBe(false);
      expect(isValidMode(undefined)).toBe(false);
      expect(isValidMode(123)).toBe(false);
      expect(isValidMode("checksSeen+item")).toBe(false);
    });
  });
  ```

  Add a new `describe` block after `describe("isValidItemsArray", ...)`:
  ```js
  describe("isValidChecksArray", () => {
    it("accepts a 96-length array of byte values", () => {
      expect(isValidChecksArray(new Array(96).fill(0))).toBe(true);
    });

    it("rejects wrong length", () => {
      expect(isValidChecksArray(new Array(95).fill(0))).toBe(false);
    });

    it("rejects out-of-range or non-integer values", () => {
      const bad1 = new Array(96).fill(0);
      bad1[0] = 256;
      expect(isValidChecksArray(bad1)).toBe(false);

      const bad2 = new Array(96).fill(0);
      bad2[0] = 1.5;
      expect(isValidChecksArray(bad2)).toBe(false);
    });

    it("rejects non-arrays", () => {
      expect(isValidChecksArray("not an array")).toBe(false);
      expect(isValidChecksArray(null)).toBe(false);
    });
  });
  ```

  Replace the `describe("validateEventBody", ...)` block with:
  ```js
  describe("validateEventBody", () => {
    const valid = { player: "ds83171", game: 2, items: [0] };

    it("accepts a well-formed body with only items", () => {
      expect(validateEventBody(valid)).toBeNull();
    });

    it("accepts a well-formed body with only checks", () => {
      expect(validateEventBody({ player: "ds83171", game: 2, checks: [0] })).toBeNull();
    });

    it("accepts a well-formed body with both items and checks", () => {
      expect(validateEventBody({ player: "ds83171", game: 2, items: [0], checks: [1] })).toBeNull();
    });

    it("rejects a body with neither items nor checks", () => {
      expect(validateEventBody({ player: "ds83171", game: 2 })).toMatch(/items or checks/);
    });

    it("rejects a missing or empty player name", () => {
      expect(validateEventBody({ ...valid, player: "" })).toMatch(/player/);
      expect(validateEventBody({ ...valid, player: undefined })).toMatch(/player/);
    });

    it("rejects a player name over 32 characters", () => {
      expect(validateEventBody({ ...valid, player: "x".repeat(33) })).toMatch(/player/);
    });

    it("rejects an out-of-range game number", () => {
      expect(validateEventBody({ ...valid, game: 0 })).toMatch(/game/);
      expect(validateEventBody({ ...valid, game: 4 })).toMatch(/game/);
      expect(validateEventBody({ ...valid, game: 1.5 })).toMatch(/game/);
    });

    it("rejects an empty or oversized items array", () => {
      expect(validateEventBody({ ...valid, items: [] })).toMatch(/items/);
      expect(validateEventBody({ ...valid, items: new Array(21).fill(0) })).toMatch(/items/);
    });

    it("rejects non-integer or out-of-range item entries", () => {
      expect(validateEventBody({ ...valid, items: ["not-a-number"] })).toMatch(/items/);
      expect(validateEventBody({ ...valid, items: [-1] })).toMatch(/items/);
      expect(validateEventBody({ ...valid, items: [768] })).toMatch(/items/);
      expect(validateEventBody({ ...valid, items: [1.5] })).toMatch(/items/);
    });

    it("rejects an empty or oversized checks array", () => {
      expect(validateEventBody({ player: "a", game: 1, checks: [] })).toMatch(/checks/);
      expect(validateEventBody({ player: "a", game: 1, checks: new Array(21).fill(0) })).toMatch(/checks/);
    });

    it("rejects non-integer or out-of-range check entries", () => {
      expect(validateEventBody({ player: "a", game: 1, checks: [-1] })).toMatch(/checks/);
      expect(validateEventBody({ player: "a", game: 1, checks: [768] })).toMatch(/checks/);
    });

    it("rejects a non-object body", () => {
      expect(validateEventBody(null)).toMatch(/object/);
      expect(validateEventBody("nope")).toMatch(/object/);
    });
  });
  ```

- [ ] **Step 3: Run the test suite.** From `worker/`: `npm test`. Expected: all pass.

- [ ] **Step 4: Commit.**
  ```bash
  git add worker/src/validation.js worker/test/validation.test.js
  git commit -m "Add checksSeen+items+checks mode, isValidChecksArray, relax validateEventBody for checks"
  ```

---

### Task 2: `worker/src/room.js` — `checks` room state (init/reset/status/sync)

**Files:**
- Modify: `worker/src/room.js`
- Modify: `worker/test/room-sync.test.js`
- Modify: `worker/test/room-admin.test.js`

**Interfaces:**
- Consumes: `isValidChecksArray` (Task 1).
- Produces: `checks` room state, threaded through `handleInit`/`handleReset`/`handleStatus`/`handleSync`. `handleEvent` (Task 3) will read this task's constants (`CHECKS_LENGTH`).

- [ ] **Step 1: Update `worker/test/room-sync.test.js` first (TDD).**

  Update the `sync()` helper to accept an optional 6th `checks` argument, defaulting to an all-zero array so no existing call site needs editing:
  ```js
  function sync(stub, checksSeen, epoch, shareFlags, items = new Array(96).fill(0), checks = new Array(96).fill(0)) {
    return stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen, epoch, shareFlags, items, checks }),
    });
  }
  ```

  Append these new tests inside `describe("RoomDO /sync", ...)`, after the existing `"reflects merged item bits in admin/status's mergedItemsBitsSet after a /sync merge"` test:
  ```js
  it("defaults to an empty checks array before any progress is shared", async () => {
    const stub = getStub("test-room-sync-22");
    await initRoom(stub, "checksSeen+items+checks");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect((await res.json()).checks).toEqual(new Array(96).fill(0));
  });

  it("OR-merges checks unconditionally across players in checksSeen+items+checks mode", async () => {
    const stub = getStub("test-room-sync-23");
    await initRoom(stub, "checksSeen+items+checks");

    const playerAChecks = new Array(96).fill(0);
    playerAChecks[0] = 0b0001; // check id 0
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), playerAChecks);

    const playerBChecks = new Array(96).fill(0);
    playerBChecks[30] = 0b1000; // check id 243, 1ChAAClear -- unrelated to any item category
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), playerBChecks);

    const { checks } = await res.json();
    expect(checks[0]).toBe(0b0001);
    expect(checks[30]).toBe(0b1000);
  });

  it("does not merge checks in checksSeen+items mode (checks required but not folded in)", async () => {
    const stub = getStub("test-room-sync-24");
    await initRoom(stub, "checksSeen+items");
    const incomingChecks = new Array(96).fill(0);
    incomingChecks[0] = 0xff;
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), incomingChecks);
    const { checks } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(checks.every((b) => b === 0)).toBe(true);
  });

  it("does not merge checks in plain checksSeen mode", async () => {
    const stub = getStub("test-room-sync-25");
    await initRoom(stub, "checksSeen");
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), new Array(96).fill(0xff));
    const { checks } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(checks.every((b) => b === 0)).toBe(true);
  });

  it("still merges items unconditionally in checksSeen+items+checks mode (verbatim continuation of checksSeen+items)", async () => {
    const stub = getStub("test-room-sync-26");
    await initRoom(stub, "checksSeen+items+checks");
    const incomingItems = new Array(96).fill(0);
    incomingItems[5] = 0x01; // id 40, no category -- must still merge, same as checksSeen+items
    await sync(stub, new Array(96).fill(0), 0, undefined, incomingItems);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems[5]).toBe(0x01);
  });

  it("discards a stale client's checks contribution the same way it discards checksSeen/items", async () => {
    const stub = getStub("test-room-sync-27");
    await initRoom(stub, "checksSeen+items+checks");

    const freshChecks = new Array(96).fill(0);
    freshChecks[0] = 0b0001;
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), freshChecks);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });

    const staleChecks = new Array(96).fill(0);
    staleChecks[1] = 0b0010;
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), staleChecks); // still reporting epoch 0

    const data = await res.json();
    expect(data.epoch).toBe(1);
    expect(data.checks.every((b) => b === 0)).toBe(true);
  });

  it("zeroes checks on reset", async () => {
    const stub = getStub("test-room-sync-28");
    await initRoom(stub, "checksSeen+items+checks");
    const incomingChecks = new Array(96).fill(0);
    incomingChecks[0] = 0b0001;
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), incomingChecks);
    const before = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(before.checks[0]).toBe(0b0001);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });
    const after = await (await sync(stub, new Array(96).fill(0), 1)).json();
    expect(after.checks).toEqual(new Array(96).fill(0));
  });

  it("rejects a sync missing the checks field, or with the wrong length", async () => {
    const stub = getStub("test-room-sync-29");
    await initRoom(stub, "checksSeen");
    const res1 = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch: 0 }), // no checks at all
    });
    expect(res1.status).toBe(400);

    const res2 = await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), [0, 1, 2]);
    expect(res2.status).toBe(400);
  });

  it("reflects merged check bits in admin/status's checksBitsSet after a /sync merge", async () => {
    const stub = getStub("test-room-sync-30");
    await initRoom(stub, "checksSeen+items+checks");
    const incomingChecks = new Array(96).fill(0);
    incomingChecks[0] = 0b0011; // 2 bits set
    await sync(stub, new Array(96).fill(0), 0, undefined, new Array(96).fill(0), incomingChecks);
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.checksBitsSet).toBe(2);
  });
  ```

- [ ] **Step 2: Update `worker/test/room-admin.test.js`'s exact-shape assertions.**

  `handleStatus` now returns an additional `checksBitsSet` field, so every `toEqual({...})` assertion against a full status object needs it added. Update these five occurrences (all currently expect `checksBitsSet` to be absent — add `checksBitsSet: 0` to each, in the same position as the other zero-valued fields):
  ```js
  // Line ~47 ("reports status for an uninitialized room"):
  expect(await res.json()).toEqual({ mode: null, checksSeenBitsSet: 0, mergedItemsBitsSet: 0, checksBitsSet: 0, eventCount: 0, connected: 0 });

  // Line ~69 ("resets checksSeen and events but keeps mode..."):
  expect(status).toEqual({ mode: "checksSeen+shared", checksSeenBitsSet: 0, mergedItemsBitsSet: 0, checksBitsSet: 0, eventCount: 0, connected: 0 });

  // Line ~105 ("rejects reset with an invalid mode..."):
  expect(status).toEqual({ mode: "checksSeen", checksSeenBitsSet: 0, mergedItemsBitsSet: 0, checksBitsSet: 0, eventCount: 0, connected: 0 });

  // Line ~125 ("fully wipes a room on delete..."):
  expect(status).toEqual({ mode: null, checksSeenBitsSet: 0, mergedItemsBitsSet: 0, checksBitsSet: 0, eventCount: 0, connected: 0 });

  // Line ~165 ("schedules an alarm on room creation, and wipes storage when it fires"):
  expect(await after.json()).toEqual({ mode: null, checksSeenBitsSet: 0, mergedItemsBitsSet: 0, checksBitsSet: 0, eventCount: 0, connected: 0 });
  ```

- [ ] **Step 3: Run the tests to confirm they fail** (implementation not yet updated). From `worker/`: `npm test`. Expected: new/updated tests FAIL; all previously-existing tests still pass.

- [ ] **Step 4: Update `worker/src/room.js`.**

  Add the constant (next to the other length constants):
  ```js
  const CHECKS_LENGTH = 96;
  ```

  Update the `validation.js` import to include `isValidChecksArray`:
  ```js
  import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidItemsArray, isValidChecksArray, isValidEpoch, isValidShareFlags, validateEventBody } from "./validation.js";
  ```

  Extend `mergeIncomingItems`'s unconditional-merge branch to also match the new mode (verbatim continuation of `checksSeen+items`'s behavior):
  ```js
  function mergeIncomingItems(stored, incoming, mode, shareFlags) {
    if (mode === "checksSeen+items" || mode === "checksSeen+items+checks") {
      // No category filter at all -- the entire array OR-merges unconditionally.
      return orMergeBytes(stored, incoming);
    }
    if (mode !== "checksSeen+shared") {
      // Plain "checksSeen" mode: items sharing isn't enabled for this room --
      // the field is still validated above (so a malformed client is still
      // caught), it's just never folded into mergedItems.
      return stored;
    }
    // ...unchanged bit-granular category-filter loop below...
  ```

  Update `handleInit` — add one line initializing `checks`:
  ```js
  async handleInit(request) {
    const body = await request.json().catch(() => null);
    if (!body || !isValidMode(body.mode) || !isValidAdminSecret(body.adminSecret)) {
      return jsonResponse({ error: "invalid mode or adminSecret" }, 400);
    }
    const existingMode = await this.state.storage.get("mode");
    if (existingMode) {
      return jsonResponse({ mode: existingMode, created: false });
    }
    await this.state.storage.put("mode", body.mode);
    await this.state.storage.put("adminSecret", body.adminSecret);
    await this.state.storage.put("resetEpoch", 0);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("checks", new Array(CHECKS_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
    await this.scheduleExpiry();
    return jsonResponse({ mode: body.mode, created: true });
  }
  ```

  Update `handleStatus`:
  ```js
  async handleStatus() {
    const mode = (await this.state.storage.get("mode")) ?? null;
    const checksSeen = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    const checks = (await this.state.storage.get("checks")) ?? new Array(CHECKS_LENGTH).fill(0);
    const events = (await this.state.storage.get("events")) ?? [];
    return jsonResponse({
      mode,
      checksSeenBitsSet: countSetBits(checksSeen),
      mergedItemsBitsSet: countSetBits(mergedItems),
      checksBitsSet: countSetBits(checks),
      eventCount: events.length,
      connected: this.sockets.size,
    });
  }
  ```

  Update `handleReset` — add one line, same pattern as `handleInit`:
  ```js
  async handleReset(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    const storedSecret = await this.state.storage.get("adminSecret");
    if (!body || body.adminSecret !== storedSecret) {
      return jsonResponse({ error: "invalid admin secret" }, 403);
    }
    if (body.mode !== undefined && !isValidMode(body.mode)) {
      return jsonResponse({ error: "invalid mode" }, 400);
    }
    const newMode = body.mode !== undefined ? body.mode : mode;
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    await this.state.storage.put("resetEpoch", currentEpoch + 1);
    await this.state.storage.put("mode", newMode);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("checks", new Array(CHECKS_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
    await this.scheduleExpiry();
    this.recentlyPosted.clear();
    return jsonResponse({ ok: true, mode: newMode });
  }
  ```
  (Note: `this.recentlyPosted` — renamed from `this.recentlyPostedItems` in Task 3. If Task 3 hasn't run yet when you reach this step, use `this.recentlyPostedItems.clear()` instead and let Task 3's rename update this line too.)

  Replace `handleSync`:
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
      !isValidChecksArray(body.checks) ||
      !isValidEpoch(body.epoch) ||
      !isValidShareFlags(body.shareFlags)
    ) {
      return jsonResponse({ error: "invalid checksSeen, items, checks, epoch, or shareFlags" }, 400);
    }
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    const storedChecksSeen = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const storedMergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    const storedChecks = (await this.state.storage.get("checks")) ?? new Array(CHECKS_LENGTH).fill(0);

    // Static per-seed data (read once from ROM by lua/share_info.lua, not derived
    // from player progress) -- just store whatever's sent, no merge logic needed.
    if (body.shareFlags !== undefined) {
      await this.state.storage.put("shareFlags", body.shareFlags);
    }
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};

    let checksSeen = storedChecksSeen;
    let mergedItems = storedMergedItems;
    let checks = storedChecks;
    // A client reporting a stale (pre-reset) epoch has its contribution to
    // ALL THREE arrays discarded -- same protection checksSeen/items already had.
    if (body.epoch >= currentEpoch) {
      checksSeen = orMergeBytes(storedChecksSeen, body.checksSeen);
      await this.state.storage.put("checksSeen", checksSeen);
      mergedItems = mergeIncomingItems(storedMergedItems, body.items, mode, shareFlags);
      await this.state.storage.put("mergedItems", mergedItems);
      // checks (real progress) merges unconditionally, same as items does in
      // checksSeen+items -- checks aren't item-categorized at all, so there's
      // no equivalent of a shareFlags gate for them.
      if (mode === "checksSeen+items+checks") {
        checks = orMergeBytes(storedChecks, body.checks);
        await this.state.storage.put("checks", checks);
      }
    }

    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, mergedItems, checks });
  }
  ```

  `handleDelete` and `handleWebSocket` are **unchanged** — `handleDelete` already wipes all storage unconditionally (`deleteAll()`), and `/ws`'s init message has never included `mergedItems` either (same precedent).

- [ ] **Step 5: Run the full Worker test suite.** From `worker/`: `npm test`. Expected: all pass. (If Task 3 hasn't run yet, `handleEvent` still references the old `recentlyPostedItems` map name, which is fine — Task 3 handles that rename together with its own changes.)

- [ ] **Step 6: Commit.**
  ```bash
  git add worker/src/room.js worker/test/room-sync.test.js worker/test/room-admin.test.js
  git commit -m "Add checks room state (init/reset/status/sync), mirroring checksSeen"
  ```

---

### Task 3: `worker/src/room.js` — `handleEvent` extension for checks

**Files:**
- Modify: `worker/src/room.js`
- Modify: `worker/test/room-event.test.js`

**Interfaces:**
- Consumes: the relaxed `validateEventBody` (Task 1), `checks` state conventions (Task 2).
- Produces: `/event` accepts an optional `checks` field, namespaces its duplicate-window keys by kind, and gates on the new mode too.

- [ ] **Step 1: Update `worker/test/room-event.test.js` first (TDD).**

  Add these tests inside `describe("RoomDO /event", ...)`, after `"accepts and stores events when mode is checksSeen+items"`:
  ```js
  it("accepts and stores events when mode is checksSeen+items+checks", async () => {
    const stub = getStub("test-room-event-3c");
    await initRoom(stub, "checksSeen+items+checks");
    const res = await postEvent(stub, { player: "a", game: 1, checks: [0] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("accepts an event with both items and checks", async () => {
    const stub = getStub("test-room-event-3d");
    await initRoom(stub, "checksSeen+items+checks");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0], checks: [0] });
    expect(res.status).toBe(200);

    const backlog = await getBacklog(stub);
    expect(backlog[0].items).toEqual([0]);
    expect(backlog[0].checks).toEqual([0]);
  });
  ```

  Add a new describe block at the end of the file, after `describe("RoomDO /event -- no longer merges items (moved to /sync)", ...)`:
  ```js
  describe("RoomDO /event -- duplicate-window keys namespaced by kind", () => {
    it("does not treat an item id and a check id with the same number as duplicates of each other", async () => {
      const stub = getStub("test-room-event-namespace-1");
      await initRoom(stub, "checksSeen+items+checks");
      await postEvent(stub, { player: "a", game: 1, items: [5] });
      const res = await postEvent(stub, { player: "a", game: 1, checks: [5] });
      expect(res.status).toBe(200);

      const status = await (await stub.fetch("https://do/admin/status")).json();
      expect(status.eventCount).toBe(2); // both logged -- not deduped against each other
    });

    it("still dedupes an immediate exact-duplicate check the same way items already are", async () => {
      const stub = getStub("test-room-event-namespace-2");
      await initRoom(stub, "checksSeen+items+checks");
      await postEvent(stub, { player: "a", game: 1, checks: [9] });
      const res = await postEvent(stub, { player: "a", game: 1, checks: [9] });
      expect(res.status).toBe(200);

      const status = await (await stub.fetch("https://do/admin/status")).json();
      expect(status.eventCount).toBe(1);
    });
  });
  ```

- [ ] **Step 2: Run the tests to confirm they fail.** From `worker/`: `npm test`. Expected: new tests FAIL (`checks`-only events currently 400 since `handleEvent` doesn't handle them yet); all previously-existing tests still pass.

- [ ] **Step 3: Update `worker/src/room.js`.**

  Rename `this.recentlyPostedItems` to `this.recentlyPosted` in the constructor:
  ```js
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
    this.recentlyPosted = new Map(); // "player::kind::id" -> last-posted timestamp (ms)
  }
  ```
  Update `alarm()`'s reference too: `this.recentlyPosted.clear();` (was `this.recentlyPostedItems.clear();`). Also update the two other call sites already using this map: `handleReset` (`this.recentlyPosted.clear();`) and `handleDelete` (`this.recentlyPosted.clear();`) — both already exist in the file from prior tasks, just rename the property reference.

  Replace `handleEvent`:
  ```js
  async handleEvent(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    if (mode !== "checksSeen+shared" && mode !== "checksSeen+items" && mode !== "checksSeen+items+checks") {
      return jsonResponse({ error: "items sharing not enabled for this room" }, 403);
    }
    const body = await request.json().catch(() => null);
    const validationError = validateEventBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    const now = Date.now();
    // Prune stale entries so this map doesn't grow unbounded over a long session.
    for (const [key, postedAt] of this.recentlyPosted) {
      if (now - postedAt > DUPLICATE_EVENT_WINDOW_MS) {
        this.recentlyPosted.delete(key);
      }
    }

    // Namespaced by kind ("item"/"check") since item ids and check ids share
    // the same 0-767 numeric space -- without this, an item id and an
    // unrelated check id with the same number would collide and incorrectly
    // dedupe against each other.
    const dedupeNew = (ids, kind) =>
      (ids ?? []).filter((id) => {
        const key = `${body.player}::${kind}::${id}`;
        const lastPosted = this.recentlyPosted.get(key);
        if (lastPosted !== undefined && now - lastPosted <= DUPLICATE_EVENT_WINDOW_MS) {
          return false; // recent duplicate, skip it
        }
        this.recentlyPosted.set(key, now);
        return true;
      });

    const newItems = dedupeNew(body.items, "item");
    const newChecks = dedupeNew(body.checks, "check");

    if (newItems.length === 0 && newChecks.length === 0) {
      // Everything in this request was a recent duplicate -- nothing new to log.
      return jsonResponse({ ok: true });
    }

    const events = (await this.state.storage.get("events")) ?? [];
    const event = { player: body.player, game: body.game, ts: now };
    if (newItems.length > 0) {
      event.items = newItems;
    }
    if (newChecks.length > 0) {
      event.checks = newChecks;
    }
    events.push(event);
    const trimmed = events.slice(-MAX_EVENTS);
    await this.state.storage.put("events", trimmed);
    await this.scheduleExpiry();
    this.broadcast({ type: "event", event });
    return jsonResponse({ ok: true });
  }
  ```

- [ ] **Step 4: Run the full Worker test suite.** From `worker/`: `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**
  ```bash
  git add worker/src/room.js worker/test/room-event.test.js
  git commit -m "Extend /event to accept checks, namespace duplicate-window keys by kind"
  ```

---

### Task 4: `lua/share_info.lua` — real check-completion sync

**Files:**
- Modify: `lua/share_info.lua`

**Interfaces:**
- Produces: `checks = readChecks()` on the outgoing `/sync` payload; applies incoming `msg.sync.checks` via `writeChecks`; reports newly-completed checks to the event feed via `checkForNewChecks()`.

- [ ] **Step 1: Add the `addrChecks` constant**, next to the other address constants:
  ```lua
  local cChecksPerTitle = 0x20
  local addrChecksSeen = 0x7FFF80
  local addrChecks = 0x7FFF60
  local addrItems = 0x7FFF00
  ```

- [ ] **Step 2: Add `readChecks()`/`writeChecks()`**, directly after `writeChecksSeen` (verbatim copies, `checksSeen`→`checks`, `addrChecksSeen`→`addrChecks`):
  ```lua
  local function readChecks()
      local arr = {}
      for i = 0, 95 do
          arr[i + 1] = sessionSave.checks[i] or 0
      end
      return arr
  end

  -- Verbatim copy of writeChecksSeen's OR/overwrite + currentTitle()/baseOffset
  -- slicing pattern, applied to real check-completion progress instead of
  -- scouted/hinted visibility. addrChecks (0x7FFF60) is a reused 32-byte WRAM
  -- window per title, same as addrChecksSeen -- unlike addrItems, this needs
  -- the slicing.
  local function writeChecks(merged, forceOverwrite)
      for i = 0, 95 do
          if forceOverwrite then
              sessionSave.checks[i] = merged[i + 1]
          else
              sessionSave.checks[i] = (sessionSave.checks[i] or 0) | merged[i + 1]
          end
      end
      local title = currentTitle()
      local baseOffset = (title - 1) * cChecksPerTitle
      for i = 0, cChecksPerTitle - 1 do
          if forceOverwrite then
              cpu[addrChecks + i] = merged[baseOffset + i + 1]
          else
              cpu[addrChecks + i] = cpu[addrChecks + i] | merged[baseOffset + i + 1]
          end
      end
  end
  ```

- [ ] **Step 3: Add a `previousChecks` local and its own independent progress-frame tracker**, next to `previousItems`/`previousProgressFrame`:
  ```lua
  local previousItems = nil
  local previousChecks = nil
  local previousProgressFrame = nil
  local previousProgressFrameForChecks = nil
  ```
  (`previousProgressFrameForChecks` is deliberately **separate** from
  `previousProgressFrame`, not shared with `checkForNewItems()` -- see the
  note after Step 6 for why sharing one variable between the two functions
  would silently break checks detection.)

- [ ] **Step 4: Update `tryConsumeInbox()`** to apply `writeChecks` and resync `previousChecks`, mirroring the items merge-echo fix:
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
              -- Resync the diffing baseline to the real post-merge state, so
              -- checkForNewItems() doesn't mistake a merge that just landed for
              -- a genuine local pickup and report it as "this player got X" --
              -- only real gameplay after this point should ever be reported.
              previousItems = readItems()
          end
          if msg.sync.checks then
              writeChecks(msg.sync.checks, forceOverwrite)
              -- Same merge-echo fix as items, applied to checks.
              previousChecks = readChecks()
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

- [ ] **Step 5: Update `issueRequest()`** to send `checks`:
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
          sync = { checksSeen = readChecksSeen(), items = readItems(), checks = readChecks(), epoch = knownEpoch, shareFlags = shareFlags },
          events = pendingEvents,
      })
  end
  ```

- [ ] **Step 6: Fix `checkForNewItems()`'s existing mode gate, then add `checkForNewChecks()` directly after it.**

  **Critical fix first, easy to miss:** `checkForNewItems()`'s current gate is
  `if shareMode ~= "checksSeen+shared" and shareMode ~= "checksSeen+items" then return end`
  — in the new `checksSeen+items+checks` mode, this condition is true (the
  mode matches neither string), so the function would return immediately and
  **item pickups would silently stop being detected/reported at all** in the
  new tier. This is the exact class of bug the spec warns about for
  `room.js`'s `mergeIncomingItems` (already fixed in Task 2) — item-side
  behavior in the new mode must be a verbatim continuation of
  `checksSeen+items`'s behavior, and this gate needs the same extension.
  Change it to:
  ```lua
  local function checkForNewItems()
      if shareMode ~= "checksSeen+shared" and shareMode ~= "checksSeen+items" and shareMode ~= "checksSeen+items+checks" then
          return
      end
      -- ...rest of the function body is unchanged...
  ```

  Now add `checkForNewChecks()`, directly after `checkForNewItems()` (structural copy, gated to the new mode only):
  ```lua
  -- Structural copy of checkForNewItems, tracking real check completion
  -- instead of item pickups. Gated to checksSeen+items+checks only -- the
  -- other 3 modes never share checks. Reuses the same
  -- ShareLogic.shouldReportAcquired burst-suppression threshold as items
  -- (cInitBurstThreshold) unless live testing shows checks need their own.
  --
  -- Uses its OWN previousProgressFrameForChecks tracker, deliberately NOT
  -- shared with checkForNewItems()'s previousProgressFrame: both functions
  -- run back-to-back in the same main-loop cycle (see Step 7), and
  -- checkForNewItems() advances its own tracker to the current frame value
  -- before this function runs. If this function compared against that SAME
  -- now-updated variable, it would always see "no change" and never detect a
  -- new check -- sharing one variable between two independently-gated
  -- functions silently breaks whichever one runs second.
  local function checkForNewChecks()
      if shareMode ~= "checksSeen+items+checks" then
          return
      end
      local progressFrame = cpu2[addrLastProgressFrame]
      if previousProgressFrameForChecks == progressFrame then
          return
      end
      previousProgressFrameForChecks = progressFrame

      local checksNow = readChecks()
      if previousChecks then
          local acquired = ShareLogic.diffNewBits(previousChecks, checksNow)
          if ShareLogic.shouldReportAcquired(#acquired, cInitBurstThreshold) then
              table.insert(pendingEvents, { game = currentTitle(), checks = acquired })
              issueRequest()
          end
      end
      previousChecks = checksNow
  end
  ```

- [ ] **Step 7: Call `checkForNewChecks()` in the main loop**, right after `checkForNewItems()`:
  ```lua
  while true do
      itemCheckFrames = itemCheckFrames - 1
      if itemCheckFrames <= 0 then
          itemCheckFrames = cItemCheckFrames
          tryConsumeInbox()
          checkForNewItems()
          checkForNewChecks()
          if outstandingSeq ~= nil then
              staleCycles = staleCycles + 1
              if staleCycles >= cStaleThreshold then
                  statusLine("waiting for relay page (open tracker/sync_relay.html)")
              end
          end
      end

      waitFrames = waitFrames - 1
      if waitFrames <= 0 then
          waitFrames = cWaitFrames
          if outstandingSeq == nil then
              issueRequest()
          end
      end
      ew.frameadvance()
  end
  ```

- [ ] **Step 8: Syntax-check.**

  Run: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" -e "local f,err=loadfile('lua/share_info.lua'); print(f and 'SYNTAX_OK' or ('SYNTAX_ERROR: '..err))"` from the repo root.
  Expected: `SYNTAX_OK`.

- [ ] **Step 9: Run the existing Lua test suites (regression check).**

  From `lua/`: `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" share_logic_test.lua` and `"C:/Users/Appen/AppData/Local/Programs/Lua/bin/lua.exe" file_relay_test.lua`.
  Expected: `ALL PASS` for both. (No new pure logic was introduced here -- `checkForNewChecks` reuses `ShareLogic.diffNewBits`/`shouldReportAcquired`, already covered.)

- [ ] **Step 10: Commit.**
  ```bash
  git add lua/share_info.lua
  git commit -m "Sync real check completion (readChecks/writeChecks/checkForNewChecks), mirroring checksSeen/items"
  ```

---

### Task 5: Check-name authoring tooling

**Files:**
- Create: `tracker/check_id_map.js`
- Create: `tracker/check_names_en.js`
- Create: `tracker/check_names_ja.js`
- Create: `tracker/check_names_zhtw.js`
- Create: `tracker/check_lookup.js`
- Create: `tracker/check_audit.html`
- Create: `tracker/check_audit.js`

**Interfaces:**
- Produces: `CHECK_ID_MAP` (global id → raw short code), `CHECK_NAMES_EN`/`_JA`/`_ZHTW` (empty scaffolding), `getCheckNameForId(id, lang)` (consumed by Task 6's event feed).

- [ ] **Step 1: Create `tracker/check_id_map.js`** — mechanical port of the `checkId` object from `ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/RMR_progress_tracker_id_maps.js` (lines 387-668 of that file), same global 0-766 index convention `ITEM_ID_MAP` already uses:
  ```js
  // Ported from ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/
  // RMR_progress_tracker_id_maps.js's own `checkId` table (global bit index 0-766,
  // same indexing convention ITEM_ID_MAP already uses). These are the original
  // AutoTracker-derived short codes -- not player-facing names. See
  // docs/superpowers/specs/2026-07-11-progress-mode-design.md for the authoring
  // plan (check_audit.html + check_names_en/ja/zhtw.js).
  const CHECK_ID_MAP = {
    0: "1ChOPLifeL", 1: "1ChOPLifeS",
    16: "1ChLOLifeL", 17: "1ChLOLifeUp",
    32: "1ChSCBodyPart", 33: "1ChSCLifeUp", 34: "1ChSC1UP", 35: "1ChSCLifeL",
    48: "1ChAASubtank", 49: "1ChAALifeL_CL", 50: "1ChAALifeL_CR", 51: "1ChAALifeUp", 52: "1ChAALifeL_End", 53: "1ChAAHadouken",
    64: "1ChBNLifeL_P", 65: "1ChBNArmPart", 66: "1ChBNSubtank", 67: "1ChBN1UP", 68: "1ChBNLifeL_G", 69: "1ChBNLifeUp",
    80: "1ChSELifeUp", 81: "1ChSELifeL_1", 82: "1ChSELifeL_2", 83: "1ChSELifeL_3", 84: "1ChSE1UP_S", 85: "1ChSESubtank",
    86: "1ChSE1UP_E", 87: "1ChSEHeadPart", 88: "1ChSE1UP_R", 89: "1ChSELifeL_D", 90: "1ChSEWeaponL",
    96: "1ChSMSubtank", 97: "1ChSMLifeUp",
    112: "1ChBKLifeUp",
    128: "1ChIPFootPart", 129: "1ChIPLifeUp", 130: "1ChIPWeaponL",
    144: "1ChS1ArmPart",
    176: "1ChS3LifeL_2", 177: "1ChS3WeaponL_3", 178: "1ChS3LifeL_3", 179: "1ChS3LifeL_4", 180: "1ChS3WeaponL_4",
    181: "1ChS3LifeL_5", 182: "1ChS3WeaponL_5", 183: "1ChS31UP",
    240: "1ChOPClear", 241: "1ChLOClear", 242: "1ChSCClear", 243: "1ChAAClear", 244: "1ChBNClear", 245: "1ChSEClear",
    246: "1ChSMClear", 247: "1ChBKClear", 248: "1ChIPClear", 249: "1ChS1Clear", 250: "1ChS2Clear", 251: "1ChS3Clear",
    254: "ChUnused", 255: "ChDefault",
    256: "2ChOPLifeL_P", 257: "2ChOPLifeL_B",
    272: "2ChMM1UP_R", 273: "2ChMMLifeUp", 274: "2ChMMBodyPart", 275: "2ChMM1UP", 276: "2ChMMLifeL_P",
    277: "2ChMMLifeL_HL", 278: "2ChMMLifeL_HR", 279: "2ChMMLifeL_SL", 280: "2ChMMLifeL_SR",
    288: "2ChWHLifeUp", 289: "2ChWH1UP", 290: "2ChWHSubtank", 291: "2ChWHLifeL_CH", 292: "2ChWHLifeL_P",
    304: "2ChBC1UP", 305: "2ChBCLifeS_P", 306: "2ChBCLifeUp", 307: "2ChBCLifeL_Ceiling", 308: "2ChBCLifeL_Scrap",
    309: "2ChBCWeaponL_C", 310: "2ChBCLifeL_SeaBottom", 311: "2ChBCLifeS_Shed", 312: "2ChBCWeaponL_S",
    313: "2ChBCSubtank", 314: "2ChBCLifeL_Cave", 315: "2ChBCLifeL_Boss",
    320: "2ChFSLifeS_F1", 321: "2ChFSWeaponS_F2", 322: "2ChFSLifeS_F3", 323: "2ChFSWeaponS_F4", 324: "2ChFSLifeS_F5",
    325: "2ChFSSubtank", 326: "2ChFS1UP_L", 327: "2ChFS1UP_V", 328: "2ChFSLifeL_V", 329: "2ChFSLifeS_V",
    330: "2ChFSWeaponS_V", 331: "2ChFSLifeUp", 332: "2ChFSLifeL_Crater", 333: "2ChFSWeaponL_Cave", 334: "2ChFSLifeL_Cave",
    335: "2ChFSLifeL_CH",
    336: "2ChMHLifeUp", 337: "2ChMHSubtank", 338: "2ChMHLifeL_P", 339: "2ChMHLifeL_CH",
    350: "2ChFSLifeL_G", 351: "2ChFS1UP_Cave",
    352: "2ChCMLifeUp", 353: "2ChCMWeaponL_P", 354: "2ChCMLifeL_P", 355: "2ChCMLifeL_CH", 356: "2ChCMLifeS_P",
    357: "2ChCM1UP_P", 358: "2ChCMLifeL_N", 359: "2ChCMHeadPart", 360: "2ChCM1UP_C", 361: "2ChCMWeaponL_Scrap",
    368: "2ChSOLifeL_CH", 369: "2ChSOLifeL_Scrap", 370: "2ChSO1UP", 371: "2ChSOWeaponS_S", 372: "2ChSOLifeS_S",
    373: "2ChSOWeaponL_S", 374: "2ChSOLifeL_S", 375: "2ChSOLifeUp", 376: "2ChSOFootPart",
    384: "2ChWAArmPart", 385: "2ChWALifeL_P1", 386: "2ChWALifeL_P2", 387: "2ChWALifeUp", 388: "2ChWA1UP",
    389: "2ChWAWeaponL", 390: "2ChWALifeL_CH", 391: "2ChWALifeL_S1", 392: "2ChWALifeL_S2", 393: "2ChWALifeL_S3", 394: "2ChWALifeL_B",
    400: "2ChS11UP_N", 401: "2ChS1LifeL", 402: "2ChS11UP_B",
    416: "2ChS2LifeS", 417: "2ChS21UP",
    432: "2ChS3LifeL_W", 433: "2ChS31UP_W", 434: "2ChS3LifeL_S11", 435: "2ChS3LifeL_S12", 436: "2ChS3LifeL_S13",
    437: "2ChS3LifeL_S21", 438: "2ChS3LifeL_S22", 439: "2ChS31UP_U1", 440: "2ChS3LifeL_U1", 441: "2ChS3LifeL_U2",
    442: "2ChS31UP_U2", 443: "2ChS3Shoryuken", 444: "2ChS31UP_M",
    448: "2ChS4LifeS_1", 449: "2ChS4LifeS_2", 450: "2ChS4LifeS_3", 451: "2ChS4LifeS_4",
    493: "2ChViolen", 494: "2ChSerges", 495: "2ChAgile",
    496: "2ChOPClear", 497: "2ChMMClear", 498: "2ChWHClear", 499: "2ChBCClear", 500: "2ChFSClear", 501: "2ChMHClear",
    502: "2ChCMClear", 503: "2ChSOClear", 504: "2ChWAClear", 505: "2ChS1Clear", 506: "2ChS2Clear", 507: "2ChS3Clear", 508: "2ChS4Clear",
    512: "3ChOPLifeL_P", 513: "3ChOPLifeL_Shaft",
    528: "3ChEHHeadChip", 529: "3ChEHLifeL_C", 530: "3ChEHLifeL_W", 531: "3ChEHRideArmor", 532: "3ChEHLifeUp",
    544: "3ChFBLifeUp", 545: "3ChFBLifeL_R", 546: "3ChFBLifeL_BEn", 547: "3ChFBLifeL_BS", 548: "3ChFBLifeL_BEx",
    549: "3ChFBSubtank", 550: "3ChFBLifeL_S", 551: "3ChFBFootPart",
    560: "3ChGBLifeUp", 561: "3ChGBLifeL_S", 562: "3ChGBFrog", 563: "3ChGBLifeL_D", 564: "3ChGBWeaponL_6",
    565: "3ChGBLifeL_6", 566: "3ChGB1UP_7", 567: "3ChGBLifeL_7", 568: "3ChGBLifeL_8", 569: "3ChGBWeaponL_8",
    570: "3ChGBLifeL_M", 571: "3ChGBArmChip",
    576: "3ChASLifeL_S", 577: "3ChASLifeL_F", 578: "3ChASLifeUp", 579: "3ChASKangaroo", 580: "3ChASFootChip", 581: "3ChASLifeL_L",
    592: "3ChENLifeL_L1", 593: "3ChENLifeL_L2", 594: "3ChENLifeUp", 595: "3ChENBodyPart", 596: "3ChENLifeL_RST",
    597: "3ChENWeaponL_RST", 598: "3ChENSubtank", 599: "3ChENWeaponL_LST", 600: "3ChENLifeL_LST", 601: "3ChENWeaponL_NB", 602: "3ChENLifeL_NB",
    608: "3ChSSLifeL_C", 609: "3ChSSLifeL_NC", 610: "3ChSSHawk", 611: "3ChSSLifeUp", 612: "3ChSSBodyChip",
    613: "3ChSSLifeL_NT", 614: "3ChSSLifeL_ND", 615: "3ChSSWeaponL", 616: "3ChSSLifeL_SL", 617: "3ChSSLifeL_SR",
    618: "3ChSS1UP_SL", 619: "3ChSS1UP_SR",
    624: "3ChSMLifeUp", 625: "3ChSMSubtank", 626: "3ChSMWeaponL", 627: "3ChSMLifeL", 628: "3ChSMHeadPart",
    640: "3ChSTLifeL_R", 641: "3ChSTSubtank", 642: "3ChSTLifeL_L", 643: "3ChSTArmPart", 644: "3ChSTLifeL_NMB", 645: "3ChSTLifeUp",
    656: "3ChVALifeL_EV1", 657: "3ChVALifeL_EV2", 658: "3ChVALifeL_EV3", 659: "3ChVALifeL_EV4", 660: "3ChVAEnergyL",
    661: "3ChVALifeL_E1", 662: "3ChVALifeL_E2", 663: "3ChVALifeL_E3", 664: "3ChVA1UP", 665: "3ChVALifeL_E4", 666: "3ChVALifeL_E5",
    672: "3ChS1LifeL_P", 673: "3ChS1EnergyL", 674: "3ChS1LifeL_LR", 675: "3ChS1HyperChip",
    688: "3ChS2Saber",
    704: "3ChS31UP", 705: "3ChS3LifeL",
    750: "3ChVajurilaFF", 751: "3ChMandarelaBB",
    752: "3ChOPClear", 753: "3ChEHClear", 754: "3ChFBClear", 755: "3ChGBClear", 756: "3ChASClear", 757: "3ChENClear",
    758: "3ChSSClear", 759: "3ChSMClear", 760: "3ChSTClear", 761: "3ChVAClear",
    762: "3ChS1Clear1", 763: "3ChS2Clear1", 764: "3ChS3Clear", 765: "3ChS1Clear2", 766: "3ChS2Clear2",
  };
  ```
  (This is the complete, verbatim data — 230 entries copied from the ref file. Double-check the copy against the source file if in doubt; do not guess or abbreviate further.)

- [ ] **Step 2: Create the three (all empty) name-table scaffolding files.**

  `tracker/check_names_en.js`:
  ```js
  // English check-completion names, keyed by the same global id CHECK_ID_MAP
  // uses. Empty for now -- see tracker/check_audit.html to author these
  // against the raw ported short codes in CHECK_ID_MAP. A confident
  // best-effort pass wasn't done here: several short codes' boss-abbreviation
  // initials don't cleanly match known Mega Man X boss names without further
  // verification (e.g. the X1 set's "BN"/"IP" codes), so guessing risked
  // embedding wrong names into the very file meant to fix that.
  const CHECK_NAMES_EN = {};
  ```

  `tracker/check_names_ja.js`:
  ```js
  // Japanese check-completion names, keyed by the same global id CHECK_ID_MAP
  // uses. Empty -- to be authored by the project owner's Japanese-speaking
  // collaborators, using tracker/check_audit.html as the reference.
  const CHECK_NAMES_JA = {};
  ```

  `tracker/check_names_zhtw.js`:
  ```js
  // Traditional Chinese check-completion names, keyed by the same global id
  // CHECK_ID_MAP uses. Empty -- to be authored later, using
  // tracker/check_audit.html as the reference.
  const CHECK_NAMES_ZHTW = {};
  ```

- [ ] **Step 3: Create `tracker/check_lookup.js`** — shared name-resolution logic, consumed by both `check_audit.js` (Task 5) and `event_feed.js` (Task 6):
  ```js
  // Shared check-name resolution, used by both check_audit.html (authoring)
  // and event_feed.html (live display). Mirrors icon_map.js's role for items,
  // but far simpler: no game-tag prefix, no icon lookup, no M-prefix
  // cross-reference -- checks have none of those concepts.
  const CHECK_NAME_TABLES = { en: CHECK_NAMES_EN, ja: CHECK_NAMES_JA, "zh-TW": CHECK_NAMES_ZHTW };

  // Returns { name, isFallback }. isFallback is true when no localized name has
  // been authored yet for this id/language, so callers can flag it visually
  // (matching icon_map.js's own fallback-flagging convention for items).
  function getCheckNameInfo(checkId, lang) {
    const table = CHECK_NAME_TABLES[lang];
    if (table && table[checkId] !== undefined) {
      return { name: table[checkId], isFallback: false };
    }
    // No localized name authored yet -- fall back to the raw ported short
    // code (e.g. "1ChAASubtank") so something readable shows regardless.
    return { name: CHECK_ID_MAP[checkId] ?? `check ${checkId}`, isFallback: true };
  }

  function getCheckNameForId(checkId, lang) {
    return getCheckNameInfo(checkId, lang).name;
  }
  ```

- [ ] **Step 4: Create `tracker/check_audit.js`** — mirrors `tracker/icon_audit.js`'s table-of-every-entry pattern, without the icon columns (checks have no sprite-sheet equivalent):
  ```js
  // RMR Sync -- Check Name Audit (diagnostic tool, not part of the shipped
  // player-facing UI). Renders one row per CHECK_ID_MAP entry: id, the raw
  // ported short code, and each language's current name (or a highlighted
  // "fallback" state -- the raw code again -- when no name has been authored
  // yet). Mirrors tracker/icon_audit.js's pattern; no icon columns, since
  // checks have no sprite-sheet equivalent.

  const AUDIT_LANGS = ["en", "ja", "zh-TW"];

  function buildRow(id, code) {
    const tr = document.createElement("tr");
    tr.dataset.code = code;

    const idTd = document.createElement("td");
    idTd.className = "id-cell";
    idTd.textContent = String(id);
    tr.appendChild(idTd);

    const codeTd = document.createElement("td");
    codeTd.className = "code-cell";
    codeTd.textContent = code;
    tr.appendChild(codeTd);

    let hasNameFallback = false;
    for (const lang of AUDIT_LANGS) {
      const nameTd = document.createElement("td");
      nameTd.className = "name-cell";
      const info = getCheckNameInfo(id, lang);
      nameTd.textContent = info.name;
      if (info.isFallback) {
        hasNameFallback = true;
        nameTd.classList.add("name-fallback");
        nameTd.title = "no name authored yet -- showing the raw ported short code";
      }
      tr.appendChild(nameTd);
    }
    if (hasNameFallback) {
      tr.classList.add("has-name-fallback");
    }

    return tr;
  }

  function render() {
    const rowsEl = document.getElementById("rows");
    const statsEl = document.getElementById("stats");
    rowsEl.innerHTML = "";

    const entries = Object.keys(CHECK_ID_MAP)
      .map((idStr) => Number(idStr))
      .sort((a, b) => a - b)
      .map((id) => ({ id, code: CHECK_ID_MAP[id] }));

    const nameFallbackCounts = Object.fromEntries(AUDIT_LANGS.map((lang) => [lang, 0]));
    for (const entry of entries) {
      for (const lang of AUDIT_LANGS) {
        if (getCheckNameInfo(entry.id, lang).isFallback) {
          nameFallbackCounts[lang]++;
        }
      }
    }

    const fallbackSummary = AUDIT_LANGS.map((lang) => `${lang}: ${nameFallbackCounts[lang]}/${entries.length}`).join(", ");
    statsEl.textContent = `${entries.length} entries total. Names not yet authored -- ${fallbackSummary}.`;

    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      frag.appendChild(buildRow(entry.id, entry.code));
    }
    rowsEl.appendChild(frag);
  }

  function applyFilter() {
    const filterText = document.getElementById("filterInput").value.trim().toLowerCase();
    const rowsEl = document.getElementById("rows");
    for (const row of Array.from(rowsEl.children)) {
      const code = row.dataset.code.toLowerCase();
      row.classList.toggle("hidden", !(!filterText || code.includes(filterText)));
    }
  }

  function init() {
    render();
    document.getElementById("filterInput").addEventListener("input", applyFilter);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
  ```

- [ ] **Step 5: Create `tracker/check_audit.html`** — mirrors `tracker/icon_audit.html`'s structure, minus the icon columns/controls:
  ```html
  <!doctype html>
  <html lang="en">
  <head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RMR Sync — Check Name Audit (diagnostic, not player-facing)</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #111; color: #eee; }
    h1 { font-size: 1.2rem; }
    p.note { font-size: 0.85rem; color: #999; }
    #controls { margin-bottom: 1rem; }
    #controls input[type="text"] { padding: 0.3rem 0.5rem; font-size: 0.95rem; min-width: 220px; }
    #stats { font-size: 0.85rem; color: #999; margin-bottom: 0.8rem; }
    table { border-collapse: collapse; width: 100%; }
    thead th { text-align: left; position: sticky; top: 0; background: #111; border-bottom: 1px solid #444; padding: 0.4rem 0.6rem; font-size: 0.85rem; color: #ccc; }
    tbody tr { border-bottom: 1px solid #222; }
    tbody tr.hidden { display: none; }
    td { padding: 0.4rem 0.6rem; vertical-align: middle; font-size: 0.9rem; }
    td.id-cell { width: 3.5rem; color: #999; }
    td.code-cell { font-family: monospace; }
    td.name-cell { max-width: 220px; }
    td.name-cell.name-fallback { color: #f88; font-style: italic; }
  </style>
  </head>
  <body>
  <h1>RMR Sync — Check Name Audit</h1>
  <p class="note">
    Standalone diagnostic/authoring page. Not linked from the player-facing UI. Each row is one
    real check-completion id, alongside its raw ported short code (from the original AutoTracker
    project's own id map) and each language's current name. Cells in red italics have no name
    authored yet, showing the raw code as a fallback -- edit
    <code>tracker/check_names_en.js</code> / <code>_ja.js</code> / <code>_zhtw.js</code> to fill
    these in.
  </p>
  <div id="controls">
    <input type="text" id="filterInput" placeholder="Filter by short code substring…" autocomplete="off" />
  </div>
  <div id="stats"></div>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Short code</th>
        <th>EN name</th>
        <th>JA name</th>
        <th>zh-TW name</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script src="check_id_map.js"></script>
  <script src="check_names_en.js"></script>
  <script src="check_names_ja.js"></script>
  <script src="check_names_zhtw.js"></script>
  <script src="check_lookup.js"></script>
  <script src="check_audit.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 6: Verify.** Open `tracker/check_audit.html` directly in a browser (file:// URL, no server needed). Expected: a table of 230 rows, all three name columns showing the raw short code in red italics (100% fallback), filter box narrowing rows by code substring.

- [ ] **Step 7: Commit.**
  ```bash
  git add tracker/check_id_map.js tracker/check_names_en.js tracker/check_names_ja.js tracker/check_names_zhtw.js tracker/check_lookup.js tracker/check_audit.html tracker/check_audit.js
  git commit -m "Add check-name authoring tooling: ported id map, empty name scaffolding, audit page"
  ```

---

### Task 6: Event feed — check-completion display, kind-filter checkboxes, friendly mode names

**Files:**
- Modify: `tracker/event_feed.html`
- Modify: `tracker/event_feed.js`

**Interfaces:**
- Consumes: `CHECK_ID_MAP`, `getCheckNameForId` (Task 5).

- [ ] **Step 1: Update `tracker/event_feed.html`.**

  Add two new settings-panel checkboxes, after the existing "Show item names" checkbox:
  ```html
  <label class="checkbox-label">
    <input type="checkbox" id="settingsShowText" />
    Show item names
  </label>
  <label class="checkbox-label">
    <input type="checkbox" id="settingsShowItems" />
    Show item pickups
  </label>
  <label class="checkbox-label">
    <input type="checkbox" id="settingsShowChecks" />
    Show check completions
  </label>
  ```

  Add the four new script tags, after the existing `icon_map.js` tag and before `event_feed.js`:
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
  <script src="event_feed.js"></script>
  ```

- [ ] **Step 2: Update `tracker/event_feed.js`.**

  Add two new storage keys, next to the existing ones:
  ```js
  const SHOW_TEXT_STORAGE_KEY = "rmrSyncShowText";
  const SHOW_ITEMS_STORAGE_KEY = "rmrSyncShowItems";
  const SHOW_CHECKS_STORAGE_KEY = "rmrSyncShowChecks";
  ```

  Add a friendly mode-name lookup, near the top of the file:
  ```js
  // Display-only -- the wire mode strings themselves are unchanged (see
  // worker/src/validation.js's VALID_MODES). A regular player has never read
  // boot.lua and has no reason to know what "checksSeen+shared" means.
  const MODE_LABELS = {
    checksSeen: "Seen",
    "checksSeen+shared": "Seen + Common Items",
    "checksSeen+items": "Seen + All Items",
    "checksSeen+items+checks": "Seen + All Items + Progress",
  };
  function friendlyModeLabel(mode) {
    return mode ? (MODE_LABELS[mode] ?? mode) : "not created yet";
  }
  ```

  Add two new getter functions, next to `getShowTextDefault()`. Unlike `showText` (which defaults OFF), these default ON -- a brand-new visitor should see pickups/completions by default, not an empty feed:
  ```js
  // Optional ?showItems=0 / ?showChecks=0 query param (or settings-panel
  // equivalent) to filter event-feed lines by kind. Unlike getShowTextDefault,
  // these default to true (shown) when nothing has ever been set -- an
  // explicit "0"/"false" (from unchecking the settings-panel box) is the only
  // way to turn a kind off, so a first-time visitor sees everything.
  function getShowItemsDefault() {
    const raw = resolveStoredOrQuery(SHOW_ITEMS_STORAGE_KEY, "showItems");
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  }

  function getShowChecksDefault() {
    const raw = resolveStoredOrQuery(SHOW_CHECKS_STORAGE_KEY, "showChecks");
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  }
  ```

  Update `setupSettingsPanel()` to wire up the two new checkboxes (add alongside the existing `showTextInput` handling):
  ```js
  function setupSettingsPanel() {
    const roomInput = document.getElementById("settingsRoom");
    const workerUrlInput = document.getElementById("settingsWorkerUrl");
    const maxLinesInput = document.getElementById("settingsMaxLines");
    const showTextInput = document.getElementById("settingsShowText");
    const showItemsInput = document.getElementById("settingsShowItems");
    const showChecksInput = document.getElementById("settingsShowChecks");
    const langInput = document.getElementById("settingsLang");
    const scaleInput = document.getElementById("settingsScale");
    const applyButton = document.getElementById("settingsApply");

    roomInput.value = resolveStoredOrQuery(ROOM_STORAGE_KEY, "room") ?? "";
    workerUrlInput.value = resolveStoredOrQuery(WORKER_URL_STORAGE_KEY, "workerUrl") ?? "";
    maxLinesInput.value = resolveStoredOrQuery(MAX_LINES_STORAGE_KEY, "maxLines") ?? "";
    const storedShowText = resolveStoredOrQuery(SHOW_TEXT_STORAGE_KEY, "showText");
    showTextInput.checked = storedShowText === "1" || storedShowText === "true";
    showItemsInput.checked = getShowItemsDefault();
    showChecksInput.checked = getShowChecksDefault();
    langInput.value = resolveLanguage();
    scaleInput.value = getScalePercent();

    applyButton.addEventListener("click", () => {
      const setStored = (key, value) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // localStorage unavailable -- Apply can't persist anything this session
        }
      };
      setStored(ROOM_STORAGE_KEY, roomInput.value.trim());
      setStored(WORKER_URL_STORAGE_KEY, workerUrlInput.value.trim());
      setStored(MAX_LINES_STORAGE_KEY, maxLinesInput.value.trim());
      setStored(SHOW_TEXT_STORAGE_KEY, showTextInput.checked ? "1" : "0");
      setStored(SHOW_ITEMS_STORAGE_KEY, showItemsInput.checked ? "1" : "0");
      setStored(SHOW_CHECKS_STORAGE_KEY, showChecksInput.checked ? "1" : "0");
      setStored(LANG_STORAGE_KEY, langInput.value);
      setStored(SCALE_STORAGE_KEY, scaleInput.value.trim());
      window.location.reload();
    });
  }
  ```

  Replace `renderEntry` to also handle `event.checks`, gated by the two new show-flags:
  ```js
  function renderEntry(event, showText, lang, shareFlags, showItems, showChecks) {
    const realItems = showItems ? (event.items || []).filter((itemId) => ITEM_ID_MAP[itemId] !== undefined) : [];
    const realChecks = showChecks ? (event.checks || []).filter((checkId) => CHECK_ID_MAP[checkId] !== undefined) : [];
    if (realItems.length === 0 && realChecks.length === 0) {
      return null;
    }

    const entry = document.createElement("div");
    entry.className = "entry";

    const player = document.createElement("span");
    player.className = "player";
    player.textContent = `${event.player}:`;
    entry.appendChild(player);

    for (const itemId of realItems) {
      const spritePos = getSpritePositionForId(itemId);
      const name = getItemNameForId(itemId, lang, shareFlags);
      const item = document.createElement("span");
      item.className = "item";
      if (spritePos) {
        const icon = document.createElement("div");
        icon.className = "icon-sprite";
        icon.style.backgroundPosition = `-${spritePos.sx * 1.5}px -${spritePos.sy * 1.5}px`;
        icon.title = name;
        item.appendChild(icon);
      } else {
        const info = getIconInfoForId(itemId);
        const img = document.createElement("img");
        img.src = info.file;
        img.alt = name;
        img.title = name;
        item.appendChild(img);
      }
      if (showText) {
        const text = document.createElement("span");
        text.className = "item-label";
        text.textContent = name;
        item.appendChild(text);
      }
      entry.appendChild(item);
    }

    // Checks have no icon/sprite -- just the raw short code (or an authored
    // name, once tracker/check_names_en.js etc. have entries) as text.
    for (const checkId of realChecks) {
      const name = getCheckNameForId(checkId, lang);
      const item = document.createElement("span");
      item.className = "item check-item";
      const text = document.createElement("span");
      text.className = "item-label";
      text.textContent = `[Check] ${name}`;
      item.appendChild(text);
      entry.appendChild(item);
    }

    return entry;
  }
  ```

  Update `main()` to read the two new flags and thread them through every `renderEntry` call site:
  ```js
  function main() {
    const log = document.getElementById("log");
    log.style.zoom = getScalePercent() / 100;
    const showText = getShowTextDefault();
    const showItems = getShowItemsDefault();
    const showChecks = getShowChecksDefault();
    const lang = resolveLanguage();
    const maxLines = getMaxLines();
    let allEvents = [];
    let shareFlags = {};

    function appendToLog(el) {
      log.appendChild(el);
      if (maxLines) {
        while (log.children.length > maxLines) {
          log.firstElementChild.remove();
        }
      }
      log.scrollTop = log.scrollHeight;
    }

    function appendStatusLine(text) {
      const el = document.createElement("div");
      el.className = "entry status-line";
      el.textContent = text;
      appendToLog(el);
    }

    function renderAll() {
      log.innerHTML = "";
      const rendered = [];
      for (const event of allEvents) {
        const el = renderEntry(event, showText, lang, shareFlags, showItems, showChecks);
        if (el) {
          rendered.push(el);
        }
      }
      const toShow = maxLines ? rendered.slice(-maxLines) : rendered;
      for (const el of toShow) {
        log.appendChild(el);
      }
    }

    setupSettingsPanel();

    const room = resolveRoom();
    if (!room) {
      appendStatusLine("no room set -- use the settings panel (top-left corner) or add ?room=<key> to the URL");
      return;
    }

    const workerUrl = resolveWorkerUrl();
    if (!workerUrl) {
      appendStatusLine("no Worker URL set -- use the settings panel (top-left corner) or add ?workerUrl=<url> to the URL");
      return;
    }

    let reconnectDelayMs = 1000;
    const MAX_RECONNECT_DELAY_MS = 15000;

    function connect() {
      const ws = new WebSocket(toWebSocketUrl(workerUrl, room));

      ws.addEventListener("open", () => {
        reconnectDelayMs = 1000;
      });

      ws.addEventListener("close", () => {
        const retryInSeconds = Math.round(reconnectDelayMs / 1000);
        appendStatusLine(`disconnected -- reconnecting in ${retryInSeconds}s...`);
        setTimeout(connect, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
      });

      ws.addEventListener("message", (message) => {
        const data = JSON.parse(message.data);
        if (data.type === "init") {
          allEvents = data.backlog.slice();
          shareFlags = data.shareFlags || {};
          renderAll();
          appendStatusLine(`connected to room ${room} (mode: ${friendlyModeLabel(data.mode)})`);
        } else if (data.type === "event") {
          allEvents.push(data.event);
          const el = renderEntry(data.event, showText, lang, shareFlags, showItems, showChecks);
          if (el) {
            appendToLog(el);
          }
        }
      });
    }

    connect();
  }

  main();
  ```

  (`getQueryParam`, `ROOM_STORAGE_KEY` through `SCALE_STORAGE_KEY`, `resolveStoredOrQuery`, `resolveRoom`, `resolveWorkerUrl`, `getMaxLines`, `detectBrowserLang`, `resolveLanguage`, `getScalePercent`, and `toWebSocketUrl` are all **unchanged** — only the additions above.)

- [ ] **Step 3: Manual verification.** Open `tracker/event_feed.html` with `?room=<test-room>&workerUrl=<test-worker-url>` against the deployed test Worker. Confirm: the status line shows a friendly name ("Seen + All Items + Progress", not the raw string); a real check-completion event (once Tasks 2-4 are live) renders as a `[Check] <code>` line; unchecking "Show check completions" in the settings panel hides check lines but keeps item lines, and vice versa.

- [ ] **Step 4: Commit.**
  ```bash
  git add tracker/event_feed.html tracker/event_feed.js
  git commit -m "Event feed: render check completions, add kind-filter checkboxes, friendly mode names"
  ```

---

### Task 7: `admin/host_admin.html` — new mode option, "Seen"-based display rename

**Files:**
- Modify: `admin/host_admin.html`

- [ ] **Step 1: Update the mode `<select>`**, replacing all 4 options (renaming the display text of the existing 3, matching the display-only convention — wire `value`s for the first 3 are unchanged from the prior rename):
  ```html
  <label for="mode">Share mode (used when creating or resetting the room)</label>
  <select id="mode">
    <option value="checksSeen">Seen</option>
    <option value="checksSeen+shared">Seen + Common Items</option>
    <option value="checksSeen+items">Seen + All Items</option>
    <option value="checksSeen+items+checks">Seen + All Items + Progress</option>
  </select>
  ```

- [ ] **Step 2: Update `refreshStatus()`** to also show `checksBitsSet` (gated to the new mode) alongside the existing `mergedItemsBitsSet` line:
  ```js
  async function refreshStatus() {
    try {
      const res = await fetch(getRoomUrl("/admin/status"));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.mode) {
        document.getElementById("mode").value = data.mode;
      }
      const itemsLine = (data.mode === "checksSeen+shared" || data.mode === "checksSeen+items" || data.mode === "checksSeen+items+checks")
        ? `merged item bits set: ${data.mergedItemsBitsSet}\n`
        : "";
      const checksLine = (data.mode === "checksSeen+items+checks")
        ? `merged checks bits set: ${data.checksBitsSet}\n`
        : "";
      showStatus(
        `mode: ${data.mode ?? "(not created yet)"}\n` +
        `checksSeen bits set: ${data.checksSeenBitsSet}\n` +
        itemsLine +
        checksLine +
        `event count: ${data.eventCount}\n` +
        `connected trackers: ${data.connected}`,
        false
      );
    } catch (err) {
      showStatus(`Status check failed: ${err.message}`, true);
    }
  }
  ```

  (`createRoom`, `resetRoom`, `deleteRoom`, `getBaseUrl`, `getRoomUrl`, `showStatus` are all **unchanged**.)

- [ ] **Step 3: Manual verification.** Open `admin/host_admin.html`, confirm the dropdown shows the 4 "Seen"-based labels, create/reset a room with `checksSeen+items+checks`, confirm Refresh Status shows the new "merged checks bits set" line only for that mode.

- [ ] **Step 4: Commit.**
  ```bash
  git add admin/host_admin.html
  git commit -m "Rename admin dropdown to Seen-based labels, add Progress mode option and status line"
  ```

---

## Verification (end-to-end, after all 7 tasks)

- Full Worker suite green: `cd worker && npm test`.
- Full Lua syntax + unit-test check: Task 4's Steps 8-9.
- `tracker/check_audit.html` opens and renders 230 rows with correct fallback highlighting.
- `tracker/event_feed.html` and `admin/host_admin.html` open without console errors and show the new "Seen"-based labels.
- Manual BizHawk verification (the real gate for gameplay-state changes): two instances in the same room, mode `checksSeen+items+checks` ("Seen + All Items + Progress"). Player A defeats a boss; confirm Player B's game marks the corresponding check complete within one `/sync` cycle (not just a merged item), that the event feed shows a distinct `[Check] ...` line attributable to the right player (and not misattributed to Player B via the merge-echo path — same fix pattern already verified for items), and that unchecking "Show check completions" hides it without affecting item-pickup lines. Confirm survival across a title switch away and back.
