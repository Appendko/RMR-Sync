# RMR Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a companion mod for RouteMatriX Randomizer that lets multiple players on the same seed share scouted-location intel (`checksSeen`) and a live item-pickup event feed, backed by a Cloudflare Worker + Durable Object.

**Architecture:** A Cloudflare Worker routes `/room/{param}/...` requests to a per-room Durable Object (one per seed, isolated via `idFromName`). Every player runs an identical BizHawk companion Lua script that polls the room over plain HTTP. A separate admin webpage creates/resets/inspects a room over `fetch()`. A separate tracker webpage renders the live event feed over WebSocket.

**Tech Stack:** Cloudflare Workers + Durable Objects (JavaScript, ES modules), Vitest + `@cloudflare/vitest-pool-workers` for backend tests, Node's built-in test runner for the icon-mapping module, plain HTML/CSS/JS for the two static pages (no build step), Lua for the BizHawk companion script (BizHawk's embedded Lua, which supports 5.3-style bitwise operators — confirmed by existing `ref/` scripts).

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-04-share-information-mod-design.md` — every task below implements a piece of it.
- Project root for all new files (except `worker/` setup already begun): `D:\Games\RouteMatriXRandomizer204_with_presets\RouteMatriXRandomizer204_Share\RMRShare`
- `ref/` is gitignored and must never be depended on at runtime — any asset or reference file needed from `ref/` must be copied into the real project tree.
- `checksSeen` is always exactly 96 bytes (32 bytes × 3 titles), matching `boot.lua`'s `addrChecksSeen` region.
- Event log is capped at the 200 most recent entries.
- Valid room `mode` values are exactly `"checksSeen"` and `"checksSeen+items"` — no other strings.
- CORS: every non-WebSocket Worker response gets `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`; `OPTIONS` requests get a 204 with those headers and no body.
- Node.js v24 and Wrangler (via `npx wrangler`) are already installed and authenticated in `worker/` (done earlier in this session — `npx wrangler whoami` should show a logged-in account). Do not re-run `wrangler login` unless it reports being logged out.
- `worker/wrangler.toml` currently still has the throwaway test config (`name = "rmr-share-test"`, binding `TEST_DO`/class `TestDO`) — Task 1 replaces it with the real one. The throwaway Worker was already deleted from Cloudflare (`wrangler delete`), so there's no conflicting deployment.
- On Windows, if `node`/`npm`/`npx` aren't recognized in a fresh shell, prefix the command with: `$env:Path += ";C:\Program Files\nodejs"` (PowerShell) — this was needed throughout this session because PATH wasn't refreshed after installing Node.

---

### Task 1: Worker project scaffolding

**Files:**
- Modify: `worker/package.json`
- Modify: `worker/wrangler.toml`
- Create: `worker/vitest.config.js`
- Create: `worker/test/smoke.test.js`
- Delete: `worker/src/index.js` (throwaway test content — task 7 recreates it for real)

**Interfaces:**
- Produces: a working `npm test` command in `worker/` for every later task to build on.

- [ ] **Step 1: Update `worker/package.json`**

Replace its contents with:

```json
{
  "name": "rmr-sync-worker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^4.107.0"
  }
}
```

- [ ] **Step 2: Replace `worker/wrangler.toml`**

```toml
name = "rmr-sync"
main = "src/index.js"
compatibility_date = "2026-07-04"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "RoomDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RoomDO"]
```

- [ ] **Step 3: Install test dependencies**

Run (in `worker/`): `npm install -D vitest @cloudflare/vitest-pool-workers`

- [ ] **Step 4: Create `worker/vitest.config.js`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 5: Delete the throwaway `worker/src/index.js`**

Remove the file entirely — it currently contains the `TestDO` smoke-test code from earlier verification. Task 7 will create the real `src/index.js`.

- [ ] **Step 6: Write a trivial smoke test**

Create `worker/test/smoke.test.js`:

```js
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the test suite**

Run: `npm test` (in `worker/`)
Expected: 1 passed (the smoke test). It's fine that there's no real Worker code yet — this just confirms the vitest-pool-workers setup itself works before building on it.

- [ ] **Step 8: Commit**

```bash
git add worker/package.json worker/wrangler.toml worker/vitest.config.js worker/test/smoke.test.js
git rm worker/src/index.js
git commit -m "Scaffold real Worker project with vitest-pool-workers test harness"
```

---

### Task 2: Shared utility modules (bits, validation, CORS)

**Files:**
- Create: `worker/src/bits.js`
- Create: `worker/test/bits.test.js`
- Create: `worker/src/validation.js`
- Create: `worker/test/validation.test.js`
- Create: `worker/src/cors.js`
- Create: `worker/test/cors.test.js`

**Interfaces:**
- Produces: `orMergeBytes(a: number[], b: number[]): number[]`, `countSetBits(bytes: number[]): number`
- Produces: `isValidMode(mode: any): boolean`, `isValidChecksSeenArray(arr: any): boolean`, `validateEventBody(body: any): string | null` (returns an error message, or `null` if valid)
- Produces: `withCors(response: Response): Response`, `handleOptions(): Response`

- [ ] **Step 1: Write failing tests for `bits.js`**

Create `worker/test/bits.test.js`:

```js
import { describe, it, expect } from "vitest";
import { orMergeBytes, countSetBits } from "../src/bits.js";

describe("orMergeBytes", () => {
  it("ORs each byte position", () => {
    expect(orMergeBytes([0b0001, 0b0100], [0b0010, 0b0000])).toEqual([0b0011, 0b0100]);
  });

  it("throws on length mismatch", () => {
    expect(() => orMergeBytes([1, 2], [1])).toThrow(/length mismatch/);
  });
});

describe("countSetBits", () => {
  it("counts bits across all bytes", () => {
    expect(countSetBits([0, 0xff, 0b101])).toBe(10);
  });

  it("returns 0 for all-zero input", () => {
    expect(countSetBits([0, 0, 0])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/bits.js'`

- [ ] **Step 3: Implement `worker/src/bits.js`**

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

- [ ] **Step 4: Run tests, confirm pass, commit**

Run: `npm test` — expect all `bits.test.js` cases to pass.

```bash
git add worker/src/bits.js worker/test/bits.test.js
git commit -m "Add orMergeBytes/countSetBits bit utilities"
```

- [ ] **Step 5: Write failing tests for `validation.js`**

Create `worker/test/validation.test.js`:

```js
import { describe, it, expect } from "vitest";
import { isValidMode, isValidChecksSeenArray, validateEventBody } from "../src/validation.js";

describe("isValidMode", () => {
  it("accepts the two known modes", () => {
    expect(isValidMode("checksSeen")).toBe(true);
    expect(isValidMode("checksSeen+items")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidMode("items")).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(123)).toBe(false);
  });
});

describe("isValidChecksSeenArray", () => {
  it("accepts a 96-length array of byte values", () => {
    expect(isValidChecksSeenArray(new Array(96).fill(0))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidChecksSeenArray(new Array(95).fill(0))).toBe(false);
  });

  it("rejects out-of-range or non-integer values", () => {
    const bad1 = new Array(96).fill(0);
    bad1[0] = 256;
    expect(isValidChecksSeenArray(bad1)).toBe(false);

    const bad2 = new Array(96).fill(0);
    bad2[0] = 1.5;
    expect(isValidChecksSeenArray(bad2)).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidChecksSeenArray("not an array")).toBe(false);
    expect(isValidChecksSeenArray(null)).toBe(false);
  });
});

describe("validateEventBody", () => {
  const valid = { player: "ds83171", game: 2, items: [0] };

  it("accepts a well-formed body", () => {
    expect(validateEventBody(valid)).toBeNull();
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
    expect(validateEventBody({ ...valid, items: ["not-a-number"] })).toMatch(/item/);
    expect(validateEventBody({ ...valid, items: [-1] })).toMatch(/item/);
    expect(validateEventBody({ ...valid, items: [768] })).toMatch(/item/);
    expect(validateEventBody({ ...valid, items: [1.5] })).toMatch(/item/);
  });

  it("rejects a non-object body", () => {
    expect(validateEventBody(null)).toMatch(/object/);
    expect(validateEventBody("nope")).toMatch(/object/);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/validation.js'`

- [ ] **Step 7: Implement `worker/src/validation.js`**

```js
const VALID_MODES = ["checksSeen", "checksSeen+items"];
const CHECKS_SEEN_LENGTH = 96;

export function isValidMode(mode) {
  return VALID_MODES.includes(mode);
}

export function isValidChecksSeenArray(arr) {
  if (!Array.isArray(arr) || arr.length !== CHECKS_SEEN_LENGTH) return false;
  return arr.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
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
```

Item IDs are raw numeric bit-offsets (0-767, covering the 96-byte/768-bit items array across X1/X2/X3 — see Task 15), not display strings. Resolving an ID to an icon and a human-readable label is entirely the tracker's job (Task 10/11), using the same `RMR_progress_tracker_id_maps.js` data the original progress tracker uses — the Worker never needs to know what an ID "means."

- [ ] **Step 8: Run tests, confirm pass, commit**

```bash
git add worker/src/validation.js worker/test/validation.test.js
git commit -m "Add input validation helpers for mode/checksSeen/event bodies"
```

- [ ] **Step 9: Write failing tests for `cors.js`**

Create `worker/test/cors.test.js`:

```js
import { describe, it, expect } from "vitest";
import { withCors, handleOptions } from "../src/cors.js";

describe("withCors", () => {
  it("adds CORS headers while preserving status and body", async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const wrapped = withCors(original);
    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(wrapped.headers.get("Content-Type")).toBe("application/json");
    expect(await wrapped.json()).toEqual({ ok: true });
  });
});

describe("handleOptions", () => {
  it("returns a 204 with CORS headers and no body", async () => {
    const res = handleOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(await res.text()).toBe("");
  });
});
```

- [ ] **Step 10: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cors.js'`

- [ ] **Step 11: Implement `worker/src/cors.js`**

```js
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
```

- [ ] **Step 12: Run tests, confirm pass, commit**

```bash
git add worker/src/cors.js worker/test/cors.test.js
git commit -m "Add CORS response helpers"
```

---

### Task 3: RoomDO — admin lifecycle (`/admin/init`, `/admin/status`, `/admin/reset`)

**Files:**
- Create: `worker/src/room.js`
- Create: `worker/test/room-admin.test.js`

**Interfaces:**
- Consumes: `countSetBits` from `worker/src/bits.js` (Task 2), `isValidMode` from `worker/src/validation.js` (Task 2)
- Produces: `export class RoomDO` with a `fetch(request: Request): Promise<Response>` method, routing `POST /admin/init`, `GET /admin/status`, `POST /admin/reset` (more routes added in later tasks). DO storage keys used: `"mode"` (string), `"checksSeen"` (96-length number array), `"events"` (array, empty until Task 5).

- [ ] **Step 1: Write failing tests**

Create `worker/test/room-admin.test.js`:

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

function getStub(roomName) {
  const id = env.ROOM.idFromName(roomName);
  return env.ROOM.get(id);
}

describe("RoomDO admin lifecycle", () => {
  it("creates a room with the given mode", async () => {
    const stub = getStub("test-room-init-1");
    const res = await stub.fetch("https://do/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "checksSeen", created: true });
  });

  it("is idempotent on repeated init calls", async () => {
    const stub = getStub("test-room-init-2");
    await stub.fetch("https://do/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen" }),
    });
    const res = await stub.fetch("https://do/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen+items" }),
    });
    expect(await res.json()).toEqual({ mode: "checksSeen", created: false });
  });

  it("rejects an invalid mode", async () => {
    const stub = getStub("test-room-init-3");
    const res = await stub.fetch("https://do/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "not-a-real-mode" }),
    });
    expect(res.status).toBe(400);
  });

  it("reports status for an uninitialized room", async () => {
    const stub = getStub("test-room-status-1");
    const res = await stub.fetch("https://do/admin/status");
    expect(await res.json()).toEqual({ mode: null, checksSeenBitsSet: 0, eventCount: 0, connected: 0 });
  });

  it("returns 404 for an unknown path", async () => {
    const stub = getStub("test-room-404-1");
    const res = await stub.fetch("https://do/nope");
    expect(res.status).toBe(404);
  });

  it("resets checksSeen and events but keeps mode", async () => {
    const stub = getStub("test-room-reset-1");
    await stub.fetch("https://do/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen+items" }),
    });
    const res = await stub.fetch("https://do/admin/reset", { method: "POST" });
    expect(await res.json()).toEqual({ ok: true });
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status).toEqual({ mode: "checksSeen+items", checksSeenBitsSet: 0, eventCount: 0, connected: 0 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/room.js'` (and/or the `ROOM` binding not resolving yet since `wrangler.toml` doesn't `main`-export `RoomDO` — that's expected, fixed by this task).

- [ ] **Step 3: Implement `worker/src/room.js`**

```js
import { countSetBits } from "./bits.js";
import { isValidMode } from "./validation.js";

const CHECKS_SEEN_LENGTH = 96;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class RoomDO {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/admin/init" && request.method === "POST") {
      return this.handleInit(request);
    }
    if (path === "/admin/status" && request.method === "GET") {
      return this.handleStatus();
    }
    if (path === "/admin/reset" && request.method === "POST") {
      return this.handleReset();
    }
    return jsonResponse({ error: "not found" }, 404);
  }

  async handleInit(request) {
    const body = await request.json().catch(() => null);
    if (!body || !isValidMode(body.mode)) {
      return jsonResponse({ error: "invalid mode" }, 400);
    }
    const existingMode = await this.state.storage.get("mode");
    if (existingMode) {
      return jsonResponse({ mode: existingMode, created: false });
    }
    await this.state.storage.put("mode", body.mode);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    return jsonResponse({ mode: body.mode, created: true });
  }

  async handleStatus() {
    const mode = (await this.state.storage.get("mode")) ?? null;
    const checksSeen = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const events = (await this.state.storage.get("events")) ?? [];
    return jsonResponse({
      mode,
      checksSeenBitsSet: countSetBits(checksSeen),
      eventCount: events.length,
      connected: this.sockets.size,
    });
  }

  async handleReset() {
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    return jsonResponse({ ok: true });
  }
}
```

- [ ] **Step 4: Run tests, confirm pass, commit**

Run: `npm test` — expect all `room-admin.test.js` cases to pass.

```bash
git add worker/src/room.js worker/test/room-admin.test.js
git commit -m "Add RoomDO with admin init/status/reset endpoints"
```

---

### Task 4: RoomDO — `/sync` (checksSeen OR-merge)

**Files:**
- Modify: `worker/src/room.js`
- Create: `worker/test/room-sync.test.js`

**Interfaces:**
- Consumes: `orMergeBytes` from `worker/src/bits.js` (Task 2), `isValidChecksSeenArray` from `worker/src/validation.js` (Task 2), `RoomDO` from Task 3
- Produces: `POST /sync` route on `RoomDO`, contract `{checksSeen: number[96]} -> {mode, checksSeen: number[96]}` (200), or `{error}` (409 if uninitialized, 400 if malformed).

- [ ] **Step 1: Write failing tests**

Create `worker/test/room-sync.test.js`:

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

function getStub(roomName) {
  const id = env.ROOM.idFromName(roomName);
  return env.ROOM.get(id);
}

async function initRoom(stub, mode) {
  await stub.fetch("https://do/admin/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

describe("RoomDO /sync", () => {
  it("rejects sync before the room is initialized", async () => {
    const stub = getStub("test-room-sync-1");
    const res = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0) }),
    });
    expect(res.status).toBe(409);
  });

  it("OR-merges checksSeen across multiple sync calls", async () => {
    const stub = getStub("test-room-sync-2");
    await initRoom(stub, "checksSeen");

    const playerA = new Array(96).fill(0);
    playerA[0] = 0b0001;
    const resA = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: playerA }),
    });
    expect((await resA.json()).checksSeen[0]).toBe(0b0001);

    const playerB = new Array(96).fill(0);
    playerB[0] = 0b0010;
    const resB = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: playerB }),
    });
    expect((await resB.json()).checksSeen[0]).toBe(0b0011);

    const resC = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0) }),
    });
    expect((await resC.json()).checksSeen[0]).toBe(0b0011);
  });

  it("rejects a checksSeen array of the wrong length", async () => {
    const stub = getStub("test-room-sync-3");
    await initRoom(stub, "checksSeen");
    const res = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: [0, 1, 2] }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `/sync` returns 404 (route not implemented yet).

- [ ] **Step 3: Add `/sync` to `worker/src/room.js`**

Update the imports at the top of `worker/src/room.js`:

```js
import { orMergeBytes, countSetBits } from "./bits.js";
import { isValidMode, isValidChecksSeenArray } from "./validation.js";
```

Add a branch in `fetch()`, right after the `/admin/reset` branch:

```js
    if (path === "/sync" && request.method === "POST") {
      return this.handleSync(request);
    }
```

Add the handler method to the class:

```js
  async handleSync(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    if (!body || !isValidChecksSeenArray(body.checksSeen)) {
      return jsonResponse({ error: "invalid checksSeen" }, 400);
    }
    const stored = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const merged = orMergeBytes(stored, body.checksSeen);
    await this.state.storage.put("checksSeen", merged);
    return jsonResponse({ mode, checksSeen: merged });
  }
```

- [ ] **Step 4: Run tests, confirm pass, commit**

Run: `npm test` — expect all `room-sync.test.js` cases (and all earlier suites) to pass.

```bash
git add worker/src/room.js worker/test/room-sync.test.js
git commit -m "Add RoomDO /sync endpoint with checksSeen OR-merge"
```

---

### Task 5: RoomDO — `/event` (item pickup log, mode-gated)

**Files:**
- Modify: `worker/src/room.js`
- Create: `worker/test/room-event.test.js`

**Interfaces:**
- Consumes: `validateEventBody` from `worker/src/validation.js` (Task 2)
- Produces: `POST /event` route, contract `{player: string, game: 1|2|3, items: string[]} -> {ok: true}` (200), `{error}` (409 uninitialized, 403 mode is checksSeen-only, 400 malformed). Stored events capped at 200 (oldest dropped first). `broadcast(message)` method added for later use by Task 6 (no subscribers yet, so it's a no-op today).

- [ ] **Step 1: Write failing tests**

Create `worker/test/room-event.test.js`:

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

function getStub(roomName) {
  const id = env.ROOM.idFromName(roomName);
  return env.ROOM.get(id);
}

async function initRoom(stub, mode) {
  await stub.fetch("https://do/admin/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

function postEvent(stub, body) {
  return stub.fetch("https://do/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("RoomDO /event", () => {
  it("rejects events before the room is initialized", async () => {
    const stub = getStub("test-room-event-1");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(409);
  });

  it("rejects events when the room's mode is checksSeen only", async () => {
    const stub = getStub("test-room-event-2");
    await initRoom(stub, "checksSeen");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(403);
  });

  it("accepts and stores events when mode includes items", async () => {
    const stub = getStub("test-room-event-3");
    await initRoom(stub, "checksSeen+items");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("rejects an invalid event body", async () => {
    const stub = getStub("test-room-event-4");
    await initRoom(stub, "checksSeen+items");
    const res = await postEvent(stub, { player: "", game: 1, items: [0] });
    expect(res.status).toBe(400);
  });

  it("trims the event log to the most recent 200 entries", async () => {
    const stub = getStub("test-room-event-5");
    await initRoom(stub, "checksSeen+items");
    for (let i = 0; i < 205; i++) {
      await postEvent(stub, { player: "a", game: 1, items: [i] });
    }
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(200);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `/event` returns 404 (route not implemented yet).

- [ ] **Step 3: Add `/event` and `broadcast` to `worker/src/room.js`**

Update the import line to add `validateEventBody`:

```js
import { isValidMode, isValidChecksSeenArray, validateEventBody } from "./validation.js";
```

Add a constant near the top (below `CHECKS_SEEN_LENGTH`):

```js
const MAX_EVENTS = 200;
```

Add a branch in `fetch()`, after the `/sync` branch:

```js
    if (path === "/event" && request.method === "POST") {
      return this.handleEvent(request);
    }
```

Add these methods to the class:

```js
  async handleEvent(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    if (mode !== "checksSeen+items") {
      return jsonResponse({ error: "items sharing not enabled for this room" }, 403);
    }
    const body = await request.json().catch(() => null);
    const validationError = validateEventBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    const events = (await this.state.storage.get("events")) ?? [];
    const event = { player: body.player, game: body.game, items: body.items, ts: Date.now() };
    events.push(event);
    const trimmed = events.slice(-MAX_EVENTS);
    await this.state.storage.put("events", trimmed);
    this.broadcast({ type: "event", event });
    return jsonResponse({ ok: true });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      try {
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
```

- [ ] **Step 4: Run tests, confirm pass, commit**

Run: `npm test` — expect all `room-event.test.js` cases (and all earlier suites) to pass.

```bash
git add worker/src/room.js worker/test/room-event.test.js
git commit -m "Add RoomDO /event endpoint with mode gating and 200-entry cap"
```

---

### Task 6: RoomDO — `/ws` (WebSocket upgrade + live broadcast)

**Files:**
- Modify: `worker/src/room.js`
- Create: `worker/test/room-ws.test.js`

**Interfaces:**
- Produces: `GET /ws` route (requires `Upgrade: websocket` header) returning a `101` response with a live `webSocket`. On connect, immediately sends `{type: "init", mode, backlog: events}`. On `/event`, all connected sockets receive `{type: "event", event}` via the `broadcast` method from Task 5.

- [ ] **Step 1: Write failing tests**

Create `worker/test/room-ws.test.js`:

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

function getStub(roomName) {
  const id = env.ROOM.idFromName(roomName);
  return env.ROOM.get(id);
}

async function initRoom(stub, mode) {
  await stub.fetch("https://do/admin/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
  });
}

describe("RoomDO /ws", () => {
  it("rejects a non-upgrade request", async () => {
    const stub = getStub("test-room-ws-1");
    const res = await stub.fetch("https://do/ws");
    expect(res.status).toBe(426);
  });

  it("sends mode and backlog on connect", async () => {
    const stub = getStub("test-room-ws-2");
    await initRoom(stub, "checksSeen+items");
    await stub.fetch("https://do/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "a", game: 1, items: [0] }),
    });

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.type).toBe("init");
    expect(initMsg.mode).toBe("checksSeen+items");
    expect(initMsg.backlog).toHaveLength(1);
    expect(initMsg.backlog[0].items).toEqual([0]);
    ws.close();
  });

  it("broadcasts new events to connected sockets", async () => {
    const stub = getStub("test-room-ws-3");
    await initRoom(stub, "checksSeen+items");

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    await nextMessage(ws); // discard the initial "init" message

    const pending = nextMessage(ws);
    await stub.fetch("https://do/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "b", game: 2, items: [16] }),
    });
    const eventMsg = await pending;
    expect(eventMsg.type).toBe("event");
    expect(eventMsg.event.player).toBe("b");
    expect(eventMsg.event.items).toEqual([16]);
    ws.close();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `/ws` returns 404 (route not implemented yet).

- [ ] **Step 3: Add `/ws` to `worker/src/room.js`**

Add a branch in `fetch()`, after the `/event` branch:

```js
    if (path === "/ws") {
      return this.handleWebSocket(request);
    }
```

Add this method to the class:

```js
  async handleWebSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return jsonResponse({ error: "expected websocket upgrade" }, 426);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    const mode = (await this.state.storage.get("mode")) ?? null;
    const backlog = (await this.state.storage.get("events")) ?? [];
    server.send(JSON.stringify({ type: "init", mode, backlog }));

    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }
```

- [ ] **Step 4: Run tests, confirm pass, commit**

Run: `npm test` — expect all `room-ws.test.js` cases (and all earlier suites) to pass.

```bash
git add worker/src/room.js worker/test/room-ws.test.js
git commit -m "Add RoomDO WebSocket endpoint with init backlog and live broadcast"
```

---

### Task 7: Worker entry point — routing + CORS wiring

**Files:**
- Create: `worker/src/index.js`
- Create: `worker/test/routing.test.js`

**Interfaces:**
- Consumes: `RoomDO` from `worker/src/room.js` (Tasks 3-6), `withCors`/`handleOptions` from `worker/src/cors.js` (Task 2)
- Produces: `export default { fetch(request, env) }` (the Worker's entry point, matching `main` in `wrangler.toml`) and re-exports `RoomDO` (required by the `durable_objects` binding). Routes `/room/{param}/*` to the corresponding `RoomDO` instance; everything else 404s. `OPTIONS` always short-circuits to `handleOptions()`. Non-`/ws` responses get `withCors()` applied.

- [ ] **Step 1: Write failing tests**

Create `worker/test/routing.test.js`:

```js
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker routing", () => {
  it("returns 404 with CORS headers for a path with no room segment", async () => {
    const res = await SELF.fetch("https://example.com/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("responds to an OPTIONS preflight with CORS headers", async () => {
    const res = await SELF.fetch("https://example.com/room/test-route-1/admin/status", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("routes admin/sync/event calls through to the correct room", async () => {
    const initRes = await SELF.fetch("https://example.com/room/test-route-2/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen+items" }),
    });
    expect(initRes.status).toBe(200);
    expect(initRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const syncRes = await SELF.fetch("https://example.com/room/test-route-2/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0) }),
    });
    expect(syncRes.status).toBe(200);

    const eventRes = await SELF.fetch("https://example.com/room/test-route-2/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "tester", game: 1, items: [0] }),
    });
    expect(eventRes.status).toBe(200);
  });

  it("keeps two different room keys isolated", async () => {
    await SELF.fetch("https://example.com/room/test-route-3a/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen" }),
    });
    const statusB = await SELF.fetch("https://example.com/room/test-route-3b/admin/status");
    const dataB = await statusB.json();
    expect(dataB.mode).toBeNull();
  });

  it("passes the WebSocket upgrade through without CORS wrapping breaking it", async () => {
    await SELF.fetch("https://example.com/room/test-route-4/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen" }),
    });
    const res = await SELF.fetch("https://example.com/room/test-route-4/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    res.webSocket.accept();
    res.webSocket.close();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `worker/src/index.js` doesn't exist, so `RoomDO` isn't exported from the configured `main` and the whole suite errors out.

- [ ] **Step 3: Implement `worker/src/index.js`**

```js
import { RoomDO } from "./room.js";
import { withCors, handleOptions } from "./cors.js";

export { RoomDO };

const ROOM_PATH_PATTERN = /^\/room\/([^/]+)(\/.*)$/;

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    const url = new URL(request.url);
    const match = url.pathname.match(ROOM_PATH_PATTERN);
    if (!match) {
      return withCors(jsonResponse({ error: "not found" }, 404));
    }

    const [, roomKey, subPath] = match;
    const id = env.ROOM.idFromName(roomKey);
    const stub = env.ROOM.get(id);

    const forwardedUrl = new URL(subPath, "https://do").toString();
    const isBodyless = request.method === "GET" || request.method === "HEAD";
    const response = await stub.fetch(forwardedUrl, {
      method: request.method,
      headers: request.headers,
      body: isBodyless ? undefined : request.body,
    });

    if (subPath === "/ws") {
      return response;
    }
    return withCors(response);
  },
};
```

- [ ] **Step 4: Run tests, confirm pass, commit**

Run: `npm test` — expect the full suite (all tasks so far) to pass.

```bash
git add worker/src/index.js worker/test/routing.test.js
git commit -m "Add Worker entry point routing /room/{param}/* to Durable Objects"
```

---

### Task 8: Worker deploy guide + real deploy

**Files:**
- Create: `worker/README.md`

**Interfaces:**
- None (deployment/documentation task, no code consumed or produced).

- [ ] **Step 1: Create `worker/README.md`**

```markdown
# RMR Sync — Worker backend

Self-hosting guide for the Cloudflare Worker + Durable Object backend. A free
Cloudflare account is sufficient (see the design spec's "Open items" section
for what was confirmed about the free tier).

## One-time setup

1. Install dependencies: `npm install`
2. Log in: `npx wrangler login` (opens a browser to authorize)
3. If you've never deployed a Worker on this Cloudflare account before,
   claim a `*.workers.dev` subdomain at
   `https://dash.cloudflare.com/<your-account-id>/workers/subdomain`
   (find your account ID on the Workers & Pages overview page).

## Local development

`npm run dev` — runs the Worker locally (via `wrangler dev`), printing a
`http://127.0.0.1:8787`-style URL you can test against directly.

## Automated tests

`npm test` — runs the Vitest suite against the Worker and Durable Object
code in a simulated Workers runtime. Run this before every deploy.

## Deploy

`npm run deploy` — publishes to `https://rmr-sync.<your-subdomain>.workers.dev`
(the `rmr-sync` part comes from `name` in `wrangler.toml`; change it if you
want a different name).

## Point the mod at this backend

Once deployed, put the printed URL into `worker_url` in
`config/share_config.txt` (for players) and into the admin page's
Worker URL field.

## Note on new subdomains

Right after claiming or changing your `*.workers.dev` subdomain, HTTPS to it
can briefly fail with `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` while Cloudflare
provisions the certificate. This resolves on its own within a few minutes.
```

- [ ] **Step 2: Run the full automated test suite one more time**

Run: `npm test` (in `worker/`)
Expected: all suites pass (this is the last chance to catch a regression before deploying real infrastructure).

- [ ] **Step 3: Start the local dev server and manually smoke-test it**

Run: `npm run dev` (leave it running in one terminal)

In another terminal, run these (adjust the port if `wrangler dev` printed a different one):

```bash
curl -X POST http://127.0.0.1:8787/room/manual-test/admin/init -H "Content-Type: application/json" -d "{\"mode\":\"checksSeen+items\"}"
curl http://127.0.0.1:8787/room/manual-test/admin/status
curl -X POST http://127.0.0.1:8787/room/manual-test/sync -H "Content-Type: application/json" -d "{\"checksSeen\":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}"
```

Expected: first call returns `{"mode":"checksSeen+items","created":true}`; second returns `checksSeenBitsSet: 0, eventCount: 0`; third returns the merged array with a `1` in the first position.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 4: Deploy for real**

Run: `npm run deploy` (in `worker/`)
Expected: output ending with a line like `https://rmr-sync.append-rmr.workers.dev` — note this URL, it's needed for the admin page and player config later.

- [ ] **Step 5: Confirm the real deployment works**

Run (substituting your actual URL):

```bash
curl -X POST https://rmr-sync.append-rmr.workers.dev/room/manual-test-2/admin/init -H "Content-Type: application/json" -d "{\"mode\":\"checksSeen\"}"
```

Expected: `{"mode":"checksSeen","created":true}`. If this fails with an SSL error, wait a few minutes (see the "Note on new subdomains" above) and retry — the same issue observed with the earlier throwaway test Worker doesn't recur for new deploys under an already-provisioned subdomain, but retry once if it does.

- [ ] **Step 6: Commit**

```bash
git add worker/README.md
git commit -m "Add Worker self-hosting guide; real backend now deployed"
```

---

### Task 9: Admin webpage

**Files:**
- Create: `admin/host_admin.html`

**Interfaces:**
- Consumes: the deployed Worker's `/room/{param}/admin/init`, `/admin/reset`, `/admin/status` endpoints (Tasks 3, 7, 8) via `fetch()`.
- Produces: a standalone static page with no dependencies on any other file in this repo.

- [ ] **Step 1: Create `admin/host_admin.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>RMR Sync — Room Admin</title>
<style>
  body { font-family: sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
  label { display: block; margin-top: 1rem; font-weight: bold; }
  input, select { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; }
  button { margin-top: 1rem; margin-right: 0.5rem; padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
  #status { margin-top: 1.5rem; white-space: pre-wrap; background: #f0f0f0; padding: 1rem; border-radius: 4px; }
  .error { color: #b00020; }
</style>
</head>
<body>
<h1>RMR Sync — Room Admin</h1>

<label for="workerUrl">Worker URL</label>
<input id="workerUrl" placeholder="https://rmr-sync.yourname.workers.dev" />

<label for="roomKey">Room key (Option string from spoiler.txt)</label>
<input id="roomKey" placeholder="V204#X7#SV8d5m27k+p99XcvrXsSiYA#..." />

<label for="mode">Share mode (used only when creating the room)</label>
<select id="mode">
  <option value="checksSeen">checksSeen only</option>
  <option value="checksSeen+items">checksSeen + items</option>
</select>

<button id="createBtn">Create Room</button>
<button id="resetBtn">Reset Room</button>
<button id="refreshBtn">Refresh Status</button>

<div id="status">No status yet.</div>

<script>
function getBaseUrl() {
  return document.getElementById("workerUrl").value.trim().replace(/\/$/, "");
}

function getRoomUrl(path) {
  const base = getBaseUrl();
  const room = encodeURIComponent(document.getElementById("roomKey").value.trim());
  return `${base}/room/${room}${path}`;
}

function showStatus(text, isError) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = isError ? "error" : "";
}

async function createRoom() {
  try {
    const res = await fetch(getRoomUrl("/admin/init"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: document.getElementById("mode").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showStatus(`Room mode: ${data.mode}${data.created ? " (just created)" : " (already existed)"}`, false);
  } catch (err) {
    showStatus(`Create failed: ${err.message}`, true);
  }
}

async function resetRoom() {
  try {
    const res = await fetch(getRoomUrl("/admin/reset"), { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showStatus("Room reset.", false);
  } catch (err) {
    showStatus(`Reset failed: ${err.message}`, true);
  }
}

async function refreshStatus() {
  try {
    const res = await fetch(getRoomUrl("/admin/status"));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showStatus(
      `mode: ${data.mode ?? "(not created yet)"}\n` +
      `checksSeen bits set: ${data.checksSeenBitsSet}\n` +
      `event count: ${data.eventCount}\n` +
      `connected trackers: ${data.connected}`,
      false
    );
  } catch (err) {
    showStatus(`Status check failed: ${err.message}`, true);
  }
}

document.getElementById("createBtn").addEventListener("click", createRoom);
document.getElementById("resetBtn").addEventListener("click", resetRoom);
document.getElementById("refreshBtn").addEventListener("click", refreshStatus);
</script>
</body>
</html>
```

- [ ] **Step 2: Manually verify against the real deployed Worker**

Open `admin/host_admin.html` directly in a browser (double-click it, or `file://` path).

1. Fill "Worker URL" with the URL from Task 8 (e.g. `https://rmr-sync.append-rmr.workers.dev`).
2. Fill "Room key" with a test string, e.g. `manual-admin-test-1`.
3. Leave mode as "checksSeen only" and click **Create Room**.
   Expected: status box shows `Room mode: checksSeen (just created)`.
4. Click **Create Room** again.
   Expected: status box shows `Room mode: checksSeen (already existed)`.
5. Click **Refresh Status**.
   Expected: status box shows `mode: checksSeen`, `checksSeen bits set: 0`, `event count: 0`, `connected trackers: 0`.
6. Click **Reset Room**.
   Expected: status box shows `Room reset.`
7. Change "Room key" to something nonexistent, e.g. `manual-admin-test-does-not-exist`, and click **Refresh Status**.
   Expected: status box shows `mode: (not created yet)`.

- [ ] **Step 3: Commit**

```bash
git add admin/host_admin.html
git commit -m "Add standalone room admin webpage"
```

---

### Task 10: Tracker icon assets + id-to-icon mapping

**Files:**
- Create: `tracker/assets/` (copied PNG/GIF/ICO files — see exact list below)
- Create: `tracker/item_id_map.mjs`
- Create: `tracker/icon_map.mjs`
- Create: `tracker/icon_map.test.mjs`

**Interfaces:**
- Produces: `ITEM_ID_MAP: Record<number, string>` — a direct port of `RMR_progress_tracker_id_maps.js`'s `itemId` table, mapping the same raw numeric bit-offset item IDs `share_info.lua` (Task 15) computes (0-767) to id-map-style strings (e.g. `0 -> "1ItLifeUp1"`).
- Produces: `getIconInfo(idString: string): { file: string, label: string }` — takes an id-map-style string directly (always returns a result, falling back to a generic icon rather than throwing).
- Produces: `getIconInfoForId(numericId: number): { file: string, label: string }` — takes a raw numeric item ID, looks it up in `ITEM_ID_MAP`, then delegates to `getIconInfo`; falls back to the generic icon (with the numeric ID as the label) if the ID isn't in the map at all.

**Design note — numeric IDs, not display strings.** `share_info.lua` sends raw numeric item IDs over the wire, *not* text. It's tempting to reuse `ref/multiworld/lua/itemName.lua` (which `boot.lua` already loads) to build a human-readable string in Lua and send that instead — but `itemName.lua` produces text formatted for BizHawk's on-screen overlay (e.g. `"[1]Life Up\n   ライフアップ"`), a completely different shape from the id-map keys (`"1ItLifeUp1"`) this tracker's icon matching expects. Sending `itemName.lua`'s output to the tracker would silently fail to match any icon rule, falling back to the generic icon for every single item. `itemName.lua` is for `boot.lua`'s in-game display only and is not used anywhere in this mod — all label/icon resolution for the event feed happens here, in the tracker, using the actual `RMR_progress_tracker_id_maps.js` data.

**Important — verified boss-code mapping.** The id-map's 2-letter weapon/key suffix codes (e.g. `"BN"`, `"IP"`) are derived from the *Japanese* boss names' romanized initials, not the English names, so they do **not** always match the asset filenames' 2-letter codes (which follow the standard English abbreviations, e.g. `fm` for Flame Mammoth, `cp` for Chill Penguin). This was cross-checked against `ref/multiworld/lua/itemName.lua`'s English boss names for all 24 bosses (8 per game × 3 games) — do not "simplify" this to a direct lowercase string match, that would silently show the wrong boss's icon for several entries per game.

- [ ] **Step 1: Copy the icon assets**

Copy these files from `ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_assets/` into a new `tracker/assets/` folder (same filenames, no renaming):

```
heart.png, energy.png, etank.png, buster.png, x.png
x1_x_hadouken.png, x2_x_shoryuken.png, x3_x_saber.png
x1_x_head.png, x1_x_arm.png, x1_x_body.png, x1_x_foot.png
x2_x_head.png, x2_x_arm.png, x2_x_body.png, x2_x_foot.png
x3_x_head.png, x3_x_arm.png, x3_x_body.png, x3_x_foot.png
x3_ridearmor_n.png, x3_ridearmor_k.png, x3_ridearmor_h.png, x3_ridearmor_f.png
x1_weapon_aa.png, x1_weapon_bk.png, x1_weapon_cp.png, x1_weapon_fm.png, x1_weapon_lo.png, x1_weapon_sc.png, x1_weapon_se.png, x1_weapon_sm.png
x2_weapon_bc.png, x2_weapon_cs.png, x2_weapon_fs.png, x2_weapon_mc.png, x2_weapon_mm.png, x2_weapon_oo.png, x2_weapon_wg.png, x2_weapon_ws.png
x3_weapon_bb.png, x3_weapon_bh.png, x3_weapon_cc.png, x3_weapon_gb.png, x3_weapon_nt.png, x3_weapon_tr.png, x3_weapon_ts.png, x3_weapon_vc.png
```

(35 files total.) On Windows PowerShell, from the repo root, this can be done in one pass:

```powershell
$src = "ref\RMR_progress_tracker_displayer_ver_js_20260126\progress_tracker_assets"
New-Item -ItemType Directory -Force tracker\assets | Out-Null
$files = @(
  "heart.png","energy.png","etank.png","buster.png","x.png",
  "x1_x_hadouken.png","x2_x_shoryuken.png","x3_x_saber.png",
  "x1_x_head.png","x1_x_arm.png","x1_x_body.png","x1_x_foot.png",
  "x2_x_head.png","x2_x_arm.png","x2_x_body.png","x2_x_foot.png",
  "x3_x_head.png","x3_x_arm.png","x3_x_body.png","x3_x_foot.png",
  "x3_ridearmor_n.png","x3_ridearmor_k.png","x3_ridearmor_h.png","x3_ridearmor_f.png",
  "x1_weapon_aa.png","x1_weapon_bk.png","x1_weapon_cp.png","x1_weapon_fm.png","x1_weapon_lo.png","x1_weapon_sc.png","x1_weapon_se.png","x1_weapon_sm.png",
  "x2_weapon_bc.png","x2_weapon_cs.png","x2_weapon_fs.png","x2_weapon_mc.png","x2_weapon_mm.png","x2_weapon_oo.png","x2_weapon_wg.png","x2_weapon_ws.png",
  "x3_weapon_bb.png","x3_weapon_bh.png","x3_weapon_cc.png","x3_weapon_gb.png","x3_weapon_nt.png","x3_weapon_tr.png","x3_weapon_ts.png","x3_weapon_vc.png"
)
foreach ($f in $files) { Copy-Item "$src\$f" "tracker\assets\$f" }
```

- [ ] **Step 2: Port the id-map data**

Create `tracker/item_id_map.mjs` — a direct, faithful port of the `itemId` object from `ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/RMR_progress_tracker_id_maps.js` (only `itemId`; `checkId` isn't needed since this mod never reports checks, only item pickups):

```js
export const ITEM_ID_MAP = {
  0: "1ItLifeUp1", 1: "1ItLifeUp2", 2: "1ItLifeUp3", 3: "1ItLifeUp4",
  4: "1ItLifeUp5", 5: "1ItLifeUp6", 6: "1ItLifeUp7", 7: "1ItLifeUp8",
  8: "1ItLifeUpD1", 9: "1ItLifeUpD2", 10: "1ItLifeUpD3", 11: "1ItLifeUpD4",
  12: "1ItLifeUpD5", 13: "1ItLifeUpD6",
  16: "1ItEnergyUp1", 17: "1ItEnergyUp2", 18: "1ItEnergyUp3", 19: "1ItEnergyUp4",
  20: "1ItEnergyUp5", 21: "1ItEnergyUp6", 22: "1ItEnergyUp7", 23: "1ItEnergyUp8",
  24: "1ItEnergyUp9", 25: "1ItEnergyUp10", 26: "1ItEnergyUp11", 27: "1ItEnergyUp12",
  28: "1ItEnergyUp13", 29: "1ItEnergyUp14",
  36: "1ItSubtank1", 37: "1ItSubtank2", 38: "1ItSubtank3", 39: "1ItSubtank4",
  40: "1ItWeaponLO", 41: "1ItWeaponSC", 42: "1ItWeaponAA", 43: "1ItWeaponBN",
  44: "1ItWeaponSE", 45: "1ItWeaponSM", 46: "1ItWeaponBK", 47: "1ItWeaponIP",
  48: "1ItKeyLO", 49: "1ItKeySC", 50: "1ItKeyAA", 51: "1ItKeyBN",
  52: "1ItKeySE", 53: "1ItKeySM", 54: "1ItKeyBK", 55: "1ItKeyIP",
  57: "1ItStageVariedSC", 59: "1ItStageVariedBN", 61: "1ItStageVariedSM",
  64: "1ItKeyS1", 65: "1ItKeyS2", 66: "1ItKeyS3", 67: "1ItKeyS4",
  68: "1ItKeyS5", 69: "1ItKeyS6", 70: "1ItKeyS7", 71: "1ItKeyS8",
  72: "1ItKeyS9", 73: "1ItKeyS10", 74: "1ItKeyS11", 75: "1ItKeyS12", 76: "1ItKeyS13",
  80: "1ItHadouken",
  88: "1ItHeadPart", 89: "1ItHeadChip", 90: "1ItArmPart", 91: "1ItArmChip",
  92: "1ItBodyPart", 93: "1ItBodyChip", 94: "1ItFootPart", 95: "1ItFootChip",
  96: "1ItBusterAmmo1", 97: "1ItBusterAmmo2", 98: "1ItBusterAmmo3", 99: "1ItBusterAmmo4",
  100: "1ItBusterAmmo5", 101: "1ItBusterAttack100", 102: "1ItBusterAttack150",
  104: "1ItBusterFireRate3", 105: "1ItBusterFireRate4", 106: "1ItBusterFireRate5",
  107: "1ItBusterFireRate6", 108: "1ItBusterFireRate30", 109: "1ItBusterFireRate60",
  110: "1ItBusterDashShot1", 111: "1ItBusterDashShotUnlimited",
  112: "1ItCharge75", 113: "1ItCharge100", 114: "1ItCharge125", 115: "1ItCharge150",
  120: "ItLifeS", 121: "ItLifeL", 122: "ItWeaponS", 123: "ItWeaponL",
  124: "ItFullRecover", 255: "ItEmpty",

  256: "2ItLifeUp1", 257: "2ItLifeUp2", 258: "2ItLifeUp3", 259: "2ItLifeUp4",
  260: "2ItLifeUp5", 261: "2ItLifeUp6", 262: "2ItLifeUp7", 263: "2ItLifeUp8",
  264: "2ItLifeUpD1", 265: "2ItLifeUpD2", 266: "2ItLifeUpD3", 267: "2ItLifeUpD4",
  268: "2ItLifeUpD5", 269: "2ItLifeUpD6",
  272: "2ItEnergyUp1", 273: "2ItEnergyUp2", 274: "2ItEnergyUp3", 275: "2ItEnergyUp4",
  276: "2ItEnergyUp5", 277: "2ItEnergyUp6", 278: "2ItEnergyUp7", 279: "2ItEnergyUp8",
  280: "2ItEnergyUp9", 281: "2ItEnergyUp10", 282: "2ItEnergyUp11", 283: "2ItEnergyUp12",
  284: "2ItEnergyUp13", 285: "2ItEnergyUp14",
  292: "2ItSubtank1", 293: "2ItSubtank2", 294: "2ItSubtank3", 295: "2ItSubtank4",
  296: "2ItWeaponMM", 297: "2ItWeaponWH", 298: "2ItWeaponBC", 299: "2ItWeaponFS",
  300: "2ItWeaponMH", 301: "2ItWeaponCM", 302: "2ItWeaponSO", 303: "2ItWeaponWA",
  304: "2ItKeyMM", 305: "2ItKeyWH", 306: "2ItKeyBC", 307: "2ItKeyFS",
  308: "2ItKeyMH", 309: "2ItKeyCM", 310: "2ItKeySO", 311: "2ItKeyWA",
  312: "2ItZeroFoot", 313: "2ItZeroFHead", 314: "2ItZeroBody",
  320: "2ItKeyS1", 321: "2ItKeyS2", 322: "2ItKeyS3", 323: "2ItKeyS4",
  324: "2ItKeyS5", 325: "2ItKeyS6", 326: "2ItKeyS7", 327: "2ItKeyS8",
  328: "2ItKeyS9", 329: "2ItKeyS10", 330: "2ItKeyS11", 331: "2ItKeyS12", 332: "2ItKeyS13",
  336: "2ItShoryuken",
  344: "2ItHeadPart", 345: "2ItHeadChip", 346: "2ItArmPart", 347: "2ItArmChip",
  348: "2ItBodyPart", 349: "2ItBodyChip", 350: "2ItFootPart", 351: "2ItFootChip",
  352: "2ItBusterAmmo1", 353: "2ItBusterAmmo2", 354: "2ItBusterAmmo3", 355: "2ItBusterAmmo4",
  356: "2ItBusterAmmo5", 357: "2ItBusterAttack100", 358: "2ItBusterAttack150",
  360: "2ItBusterFireRate3", 361: "2ItBusterFireRate4", 362: "2ItBusterFireRate5",
  363: "2ItBusterFireRate6", 364: "2ItBusterFireRate30", 365: "2ItBusterFireRate60",
  366: "2ItBusterDashShot1", 367: "2ItBusterDashShotUnlimited",
  368: "2ItCharge75", 369: "2ItCharge100", 370: "2ItCharge125", 371: "2ItCharge150",

  512: "3ItLifeUp1", 513: "3ItLifeUp2", 514: "3ItLifeUp3", 515: "3ItLifeUp4",
  516: "3ItLifeUp5", 517: "3ItLifeUp6", 518: "3ItLifeUp7", 519: "3ItLifeUp8",
  520: "3ItLifeUpD1", 521: "3ItLifeUpD2", 522: "3ItLifeUpD3", 523: "3ItLifeUpD4",
  524: "3ItLifeUpD5", 525: "3ItLifeUpD6",
  528: "3ItEnergyUp1", 529: "3ItEnergyUp2", 530: "3ItEnergyUp3", 531: "3ItEnergyUp4",
  532: "3ItEnergyUp5", 533: "3ItEnergyUp6", 534: "3ItEnergyUp7", 535: "3ItEnergyUp8",
  536: "3ItEnergyUp9", 537: "3ItEnergyUp10", 538: "3ItEnergyUp11", 539: "3ItEnergyUp12",
  540: "3ItEnergyUp13", 541: "3ItEnergyUp14",
  548: "3ItSubtank1", 549: "3ItSubtank2", 550: "3ItSubtank3", 551: "3ItSubtank4",
  552: "3ItWeaponEH", 553: "3ItWeaponFB", 554: "3ItWeaponGB", 555: "3ItWeaponAS",
  556: "3ItWeaponEN", 557: "3ItWeaponSS", 558: "3ItWeaponSM", 559: "3ItWeaponST",
  560: "3ItKeyEH", 561: "3ItKeyFB", 562: "3ItKeyGB", 563: "3ItKeyAS",
  564: "3ItKeyEN", 565: "3ItKeySS", 566: "3ItKeySM", 567: "3ItKeyST",
  568: "3ItStageVariedEH", 569: "3ItStageVariedFB", 570: "3ItStageVariedGB",
  572: "3ItKeyVavaStage", 573: "3ItKeyVajurila", 574: "3ItKeyMandarela", 575: "3ItKeyVava",
  576: "3ItKeyS1", 577: "3ItKeyS2", 578: "3ItKeyS3", 579: "3ItKeyS4",
  580: "3ItKeyS5", 581: "3ItKeyS6", 582: "3ItKeyS7", 583: "3ItKeyS8",
  584: "3ItKeyS9", 585: "3ItKeyS10", 586: "3ItKeyS11", 587: "3ItKeyS12",
  588: "3ItKeyS13", 589: "3ItKeyS14",
  592: "3ItSaber",
  596: "3ItRideArmorN", 597: "3ItRideArmorK", 598: "3ItRideArmorH", 599: "3ItRideArmorF",
  600: "3ItHeadPart", 601: "3ItHeadChip", 602: "3ItArmPart", 603: "3ItArmChip",
  604: "3ItBodyPart", 605: "3ItBodyChip", 606: "3ItFootPart", 607: "3ItFootChip",
  608: "3ItBusterAmmo1", 609: "3ItBusterAmmo2", 610: "3ItBusterAmmo3", 611: "3ItBusterAmmo4",
  612: "3ItBusterAmmo5", 613: "3ItBusterAttack100", 614: "3ItBusterAttack150",
  616: "3ItBusterFireRate3", 617: "3ItBusterFireRate4", 618: "3ItBusterFireRate5",
  619: "3ItBusterFireRate6", 620: "3ItBusterFireRate30", 621: "3ItBusterFireRate60",
  622: "3ItBusterDashShot1", 623: "3ItBusterDashShotUnlimited",
  624: "3ItCharge75", 625: "3ItCharge100", 626: "3ItCharge125", 627: "3ItCharge150",

  768: "MItLifeUp1", 769: "MItLifeUp2", 770: "MItLifeUp3", 771: "MItLifeUp4",
  772: "MItLifeUp5", 773: "MItLifeUp6", 774: "MItLifeUp7", 775: "MItLifeUp8",
  776: "MItLifeUpD1", 777: "MItLifeUpD2", 778: "MItLifeUpD3", 779: "MItLifeUpD4",
  780: "MItLifeUpD5", 781: "MItLifeUpD6",
  784: "MItEnergyUp1", 785: "MItEnergyUp2", 786: "MItEnergyUp3", 787: "MItEnergyUp4",
  788: "MItEnergyUp5", 789: "MItEnergyUp6", 790: "MItEnergyUp7", 791: "MItEnergyUp8",
  792: "MItEnergyUp9", 793: "MItEnergyUp10", 794: "MItEnergyUp11", 795: "MItEnergyUp12",
  796: "MItEnergyUp13", 797: "MItEnergyUp14",
  804: "MItSubtank1", 805: "MItSubtank2", 806: "MItSubtank3", 807: "MItSubtank4",
  808: "MItWeaponLO", 809: "MItWeaponSC", 810: "MItWeaponAA", 811: "MItWeaponBN",
  812: "MItWeaponSE", 813: "MItWeaponSM", 814: "MItWeaponBK", 815: "MItWeaponIP",
  816: "MItKeyLO", 817: "MItKeySC", 818: "MItKeyAA", 819: "MItKeyBN",
  820: "MItKeySE", 821: "MItKeySM", 822: "MItKeyBK", 823: "MItKeyIP",
  825: "MItStageVariedSC", 827: "MItStageVariedBN", 829: "MItStageVariedSM",
  832: "MItKeyS1", 833: "MItKeyS2", 834: "MItKeyS3", 835: "MItKeyS4",
  836: "MItKeyS5", 837: "MItKeyS6", 838: "MItKeyS7", 839: "MItKeyS8",
  840: "MItKeyS9", 841: "MItKeyS10", 842: "MItKeyS11", 843: "MItKeyS12", 844: "MItKeyS13",
  848: "MItHadouken",
  856: "MItHeadPart", 857: "MItHeadChip", 858: "MItArmPart", 859: "MItArmChip",
  860: "MItBodyPart", 861: "MItBodyChip", 862: "MItFootPart", 863: "MItFootChip",
  864: "MItBusterAmmo1", 865: "MItBusterAmmo2", 866: "MItBusterAmmo3", 867: "MItBusterAmmo4",
  868: "MItBusterAmmo5", 869: "MItBusterAttack100", 870: "MItBusterAttack150",
  872: "MItBusterFireRate3", 873: "MItBusterFireRate4", 874: "MItBusterFireRate5",
  875: "MItBusterFireRate6", 876: "MItBusterFireRate30", 877: "MItBusterFireRate60",
  878: "MItBusterDashShot1", 879: "MItBusterDashShotUnlimited",
  880: "MItCharge75", 881: "MItCharge100", 882: "MItCharge125", 883: "MItCharge150",
};
```

Note: IDs above 767 (the `M...` merged-item entries, 768-883) can't actually be produced by `share_info.lua`'s bit-diffing (which only ever scans the real 0-767 range read from RAM — see Task 15), since the "merged item" concept only exists transiently inside `boot.lua`'s own display logic, never as a distinct persisted bit. They're included here anyway for a complete, faithful port of the source data, and `getIconInfoForId` (Step 5 below) still handles them correctly if ever needed.

- [ ] **Step 3: Write failing tests**

Create `tracker/icon_map.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getIconInfo, getIconInfoForId } from "./icon_map.mjs";

test("maps generic categories regardless of game", () => {
  assert.equal(getIconInfo("1ItLifeUp1").file, "assets/heart.png");
  assert.equal(getIconInfo("2ItEnergyUp3").file, "assets/energy.png");
  assert.equal(getIconInfo("3ItSubtank2").file, "assets/etank.png");
  assert.equal(getIconInfo("MItLifeUp1").file, "assets/heart.png");
});

test("maps armor parts per game", () => {
  assert.equal(getIconInfo("1ItHeadPart").file, "assets/x1_x_head.png");
  assert.equal(getIconInfo("2ItArmChip").file, "assets/x2_x_arm.png");
  assert.equal(getIconInfo("3ItFootPart").file, "assets/x3_x_foot.png");
});

test("maps special abilities", () => {
  assert.equal(getIconInfo("1ItHadouken").file, "assets/x1_x_hadouken.png");
  assert.equal(getIconInfo("2ItShoryuken").file, "assets/x2_x_shoryuken.png");
  assert.equal(getIconInfo("3ItSaber").file, "assets/x3_x_saber.png");
});

test("maps X3 ride armor by letter", () => {
  assert.equal(getIconInfo("3ItRideArmorN").file, "assets/x3_ridearmor_n.png");
  assert.equal(getIconInfo("3ItRideArmorF").file, "assets/x3_ridearmor_f.png");
});

test("maps X1 weapon/key codes to the verified English-name asset codes", () => {
  // These two are the pair whose Japanese-derived id-map code diverges from
  // the English-name asset filename: BN -> Flame Mammoth (fm), IP -> Chill Penguin (cp).
  assert.equal(getIconInfo("1ItWeaponBN").file, "assets/x1_weapon_fm.png");
  assert.equal(getIconInfo("1ItKeyIP").file, "assets/x1_weapon_cp.png");
  assert.equal(getIconInfo("1ItWeaponLO").file, "assets/x1_weapon_lo.png");
});

test("maps X2 weapon codes to the verified asset codes", () => {
  assert.equal(getIconInfo("2ItWeaponWH").file, "assets/x2_weapon_ws.png");
  assert.equal(getIconInfo("2ItWeaponMH").file, "assets/x2_weapon_mc.png");
  assert.equal(getIconInfo("2ItWeaponCM").file, "assets/x2_weapon_cs.png");
  assert.equal(getIconInfo("2ItWeaponSO").file, "assets/x2_weapon_oo.png");
  assert.equal(getIconInfo("2ItWeaponWA").file, "assets/x2_weapon_wg.png");
});

test("maps X3 weapon codes to the verified asset codes", () => {
  assert.equal(getIconInfo("3ItWeaponEH").file, "assets/x3_weapon_bh.png");
  assert.equal(getIconInfo("3ItWeaponFB").file, "assets/x3_weapon_bb.png");
  assert.equal(getIconInfo("3ItWeaponAS").file, "assets/x3_weapon_ts.png");
  assert.equal(getIconInfo("3ItWeaponEN").file, "assets/x3_weapon_vc.png");
  assert.equal(getIconInfo("3ItWeaponSS").file, "assets/x3_weapon_cc.png");
  assert.equal(getIconInfo("3ItWeaponSM").file, "assets/x3_weapon_tr.png");
  assert.equal(getIconInfo("3ItWeaponST").file, "assets/x3_weapon_nt.png");
});

test("falls back to the generic icon for unmapped ids instead of throwing", () => {
  const result = getIconInfo("1ItStageVariedSC");
  assert.equal(result.file, "assets/x.png");
  assert.equal(typeof result.label, "string");
});

test("derives a readable label from the id string", () => {
  assert.equal(getIconInfo("1ItLifeUp1").label, "LifeUp1");
  assert.equal(getIconInfo("2ItWeaponMM").label, "WeaponMM");
});

test("getIconInfoForId resolves a raw numeric item ID via ITEM_ID_MAP", () => {
  assert.equal(getIconInfoForId(0).file, "assets/heart.png"); // 0 = "1ItLifeUp1"
  assert.equal(getIconInfoForId(40).file, "assets/x1_weapon_lo.png"); // 40 = "1ItWeaponLO"
  assert.equal(getIconInfoForId(592).file, "assets/x3_x_saber.png"); // 592 = "3ItSaber"
});

test("getIconInfoForId falls back to the generic icon for an ID outside the map", () => {
  const result = getIconInfoForId(999);
  assert.equal(result.file, "assets/x.png");
  assert.equal(result.label, "999");
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `node --test tracker/icon_map.test.mjs`
Expected: FAIL — `Cannot find module './icon_map.mjs'`

- [ ] **Step 5: Implement `tracker/icon_map.mjs`**

```js
import { ITEM_ID_MAP } from "./item_id_map.mjs";

const GENERIC_ICON = "assets/x.png";

// Verified against ref/multiworld/lua/itemName.lua's English boss names.
// The id-map's 2-letter codes come from the Japanese name romanizations,
// which is why some diverge from the English-name asset filename codes
// (X1: BN->fm, IP->cp; X2: WH->ws, MH->mc, CM->cs, SO->oo, WA->wg;
// X3: EH->bh, FB->bb, AS->ts, EN->vc, SS->cc, SM->tr, ST->nt).
const BOSS_CODE_MAP = {
  1: { LO: "lo", SC: "sc", AA: "aa", BN: "fm", SE: "se", SM: "sm", BK: "bk", IP: "cp" },
  2: { MM: "mm", WH: "ws", BC: "bc", FS: "fs", MH: "mc", CM: "cs", SO: "oo", WA: "wg" },
  3: { EH: "bh", FB: "bb", GB: "gb", AS: "ts", EN: "vc", SS: "cc", SM: "tr", ST: "nt" },
};

const PART_ASSET_NAMES = { Head: "head", Arm: "arm", Body: "body", Foot: "foot" };
const RIDE_ARMOR_ASSET_LETTERS = { N: "n", K: "k", H: "h", F: "f" };

const SIMPLE_RULES = [
  { pattern: /^[123M]?ItLifeUp/, file: "assets/heart.png" },
  { pattern: /^[123M]?ItEnergyUp/, file: "assets/energy.png" },
  { pattern: /^[123M]?ItSubtank/, file: "assets/etank.png" },
  { pattern: /^[123M]?ItBuster/, file: "assets/buster.png" },
  { pattern: /^[123M]?ItCharge/, file: "assets/buster.png" },
  { pattern: /^ItLife[SL]$/, file: "assets/heart.png" },
  { pattern: /^ItWeapon[SL]$/, file: "assets/energy.png" },
  { pattern: /^ItFullRecover$/, file: "assets/heart.png" },
  { pattern: /^1ItHadouken$/, file: "assets/x1_x_hadouken.png" },
  { pattern: /^2ItShoryuken$/, file: "assets/x2_x_shoryuken.png" },
  { pattern: /^3ItSaber$/, file: "assets/x3_x_saber.png" },
];

export function getIconInfo(idString) {
  const label = labelFor(idString);

  for (const rule of SIMPLE_RULES) {
    if (rule.pattern.test(idString)) {
      return { file: rule.file, label };
    }
  }

  const partMatch = idString.match(/^([123M])It(Head|Arm|Body|Foot)(?:Part|Chip)$/);
  if (partMatch) {
    const game = partMatch[1] === "M" ? "1" : partMatch[1];
    const part = PART_ASSET_NAMES[partMatch[2]];
    return { file: `assets/x${game}_x_${part}.png`, label };
  }

  const rideArmorMatch = idString.match(/^3ItRideArmor([NKHF])$/);
  if (rideArmorMatch) {
    const letter = RIDE_ARMOR_ASSET_LETTERS[rideArmorMatch[1]];
    return { file: `assets/x3_ridearmor_${letter}.png`, label };
  }

  const bossMatch = idString.match(/^([123])It(?:Weapon|Key)([A-Z]{2})$/);
  if (bossMatch) {
    const game = bossMatch[1];
    const assetCode = BOSS_CODE_MAP[game][bossMatch[2]];
    if (assetCode) {
      return { file: `assets/x${game}_weapon_${assetCode}.png`, label };
    }
  }

  return { file: GENERIC_ICON, label };
}

function labelFor(idString) {
  const match = idString.match(/^[123M]?It(.+)$/);
  return match ? match[1] : idString;
}

export function getIconInfoForId(numericId) {
  const idString = ITEM_ID_MAP[numericId];
  if (!idString) {
    return { file: GENERIC_ICON, label: String(numericId) };
  }
  return getIconInfo(idString);
}
```

- [ ] **Step 6: Run tests, confirm pass, commit**

Run: `node --test tracker/icon_map.test.mjs`
Expected: all tests pass.

```bash
git add tracker/assets tracker/item_id_map.mjs tracker/icon_map.mjs tracker/icon_map.test.mjs
git commit -m "Add tracker icon assets and verified id-to-icon mapping"
```

---

### Task 11: Event-feed tracker webpage

**Files:**
- Create: `tracker/event_feed.html`
- Create: `tracker/event_feed.js`

**Interfaces:**
- Consumes: `getIconInfoForId` from `tracker/icon_map.mjs` (Task 10); connects via WebSocket to the deployed Worker's `/room/{param}/ws` (Task 6/7/8). Each event's `items` array (from `/event`'s body, Task 5) contains raw numeric item IDs, not strings.

- [ ] **Step 1: Create `tracker/event_feed.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>RMR Sync — Event Feed</title>
<style>
  body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; background: #111; color: #eee; }
  h1 { font-size: 1.2rem; }
  #controls { margin-bottom: 1rem; display: flex; gap: 1rem; align-items: center; }
  #log { display: flex; flex-direction: column; gap: 0.4rem; }
  .entry { display: flex; align-items: center; gap: 0.4rem; background: #222; padding: 0.4rem 0.6rem; border-radius: 4px; }
  .entry .player { font-weight: bold; margin-right: 0.4rem; }
  .entry img { width: 24px; height: 24px; image-rendering: pixelated; }
  .entry .item-label { font-size: 0.85rem; color: #ccc; margin-left: 0.2rem; }
  #connectionState { font-size: 0.85rem; color: #999; }
</style>
</head>
<body>
<h1>RMR Sync — Event Feed</h1>
<div id="controls">
  <label><input type="checkbox" id="showText" /> Show item names</label>
  <span id="connectionState">not connected</span>
</div>
<div id="log"></div>
<script type="module" src="event_feed.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `tracker/event_feed.js`**

```js
import { getIconInfoForId } from "./icon_map.mjs";

function getRoomFromQuery() {
  return new URLSearchParams(window.location.search).get("room");
}

function toWebSocketUrl(workerUrl, room) {
  const httpUrl = new URL(`/room/${encodeURIComponent(room)}/ws`, workerUrl);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

function renderEntry(event, showText) {
  const entry = document.createElement("div");
  entry.className = "entry";

  const player = document.createElement("span");
  player.className = "player";
  player.textContent = `${event.player}:`;
  entry.appendChild(player);

  for (const itemId of event.items) {
    const info = getIconInfoForId(itemId);
    const img = document.createElement("img");
    img.src = info.file;
    img.alt = info.label;
    img.title = info.label;
    entry.appendChild(img);
    if (showText) {
      const text = document.createElement("span");
      text.className = "item-label";
      text.textContent = info.label;
      entry.appendChild(text);
    }
  }

  return entry;
}

function main() {
  const room = getRoomFromQuery();
  const connectionState = document.getElementById("connectionState");
  const log = document.getElementById("log");
  const showTextCheckbox = document.getElementById("showText");

  if (!room) {
    connectionState.textContent = "no ?room=<key> in URL";
    return;
  }

  // eslint-disable-next-line no-alert
  const workerUrl = window.prompt("Worker URL (e.g. https://rmr-sync.yourname.workers.dev)");
  if (!workerUrl) {
    connectionState.textContent = "no Worker URL provided";
    return;
  }

  const ws = new WebSocket(toWebSocketUrl(workerUrl, room));

  ws.addEventListener("open", () => {
    connectionState.textContent = `connected to room ${room}`;
  });

  ws.addEventListener("close", () => {
    connectionState.textContent = "disconnected";
  });

  ws.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "init") {
      connectionState.textContent = `connected to room ${room} (mode: ${data.mode ?? "not created yet"})`;
      for (const event of data.backlog) {
        log.appendChild(renderEntry(event, showTextCheckbox.checked));
      }
    } else if (data.type === "event") {
      log.appendChild(renderEntry(data.event, showTextCheckbox.checked));
      log.scrollTop = log.scrollHeight;
    }
  });
}

main();
```

- [ ] **Step 3: Manually verify against the real deployed Worker**

1. Ensure a room named e.g. `manual-tracker-test-1` exists with `checksSeen+items` mode — use `admin/host_admin.html` (Task 9) to create it if needed.
2. Open `tracker/event_feed.html?room=manual-tracker-test-1` directly in a browser.
3. When prompted, enter the deployed Worker URL from Task 8.
   Expected: "connected to room manual-tracker-test-1 (mode: checksSeen+items)" appears.
4. From a terminal, post a test event using raw numeric item IDs (`0` = `"1ItLifeUp1"`, `40` = `"1ItWeaponLO"`, per `tracker/item_id_map.mjs`):
   ```bash
   curl -X POST https://rmr-sync.append-rmr.workers.dev/room/manual-tracker-test-1/event -H "Content-Type: application/json" -d "{\"player\":\"tester\",\"game\":1,\"items\":[0,40]}"
   ```
5. Expected: a new line appears in the browser immediately, showing "tester:" followed by two icons (heart icon for the LifeUp, X1 Launch Octopus weapon icon).
6. Toggle "Show item names" — expected: text labels appear/disappear next to the icons.
7. Reload the page (still with `?room=manual-tracker-test-1`) — expected: the earlier event reappears from the backlog, confirming late-join backfill works.

- [ ] **Step 4: Commit**

```bash
git add tracker/event_feed.html tracker/event_feed.js
git commit -m "Add live event-feed tracker webpage"
```

---

### Task 12: Lua JSON codec

**Files:**
- Create: `lua/json.lua`

**Interfaces:**
- Produces (globals, matching the existing `ref/` scripts' convention of defining bare global tables like `lu`, `Text`): `json.encode(value): string`, `json.decode(str): value`. Handles nested objects/arrays, strings (with `"`, `\`, and control-character escaping), numbers, booleans, and `null`.

**Scope note:** this project's Lua code runs only inside BizHawk against real ROMs — there's no standalone automated Lua test runner in this toolchain (matching how `ref/`'s own scripts have no test suite). Verification here is manual, via BizHawk's Lua Console, following the exact style already used earlier to verify the room-key format.

- [ ] **Step 1: Implement `lua/json.lua`**

```lua
json = {}

local function encodeString(s)
    local out = { '"' }
    for i = 1, #s do
        local byte = s:byte(i)
        local c = s:sub(i, i)
        if c == '"' then
            out[#out + 1] = '\\"'
        elseif c == "\\" then
            out[#out + 1] = "\\\\"
        elseif c == "\n" then
            out[#out + 1] = "\\n"
        elseif c == "\r" then
            out[#out + 1] = "\\r"
        elseif c == "\t" then
            out[#out + 1] = "\\t"
        elseif byte < 0x20 then
            out[#out + 1] = string.format("\\u%04x", byte)
        else
            out[#out + 1] = c
        end
    end
    out[#out + 1] = '"'
    return table.concat(out)
end

local function encodeValue(v)
    local t = type(v)
    if t == "string" then
        return encodeString(v)
    elseif t == "number" then
        return tostring(v)
    elseif t == "boolean" then
        return v and "true" or "false"
    elseif t == "nil" then
        return "null"
    elseif t == "table" then
        local isArray = true
        local n = 0
        for k in pairs(v) do
            n = n + 1
            if type(k) ~= "number" then isArray = false end
        end
        if isArray and n == #v then
            local parts = {}
            for i = 1, #v do
                parts[i] = encodeValue(v[i])
            end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            local parts = {}
            for k, val in pairs(v) do
                parts[#parts + 1] = encodeString(tostring(k)) .. ":" .. encodeValue(val)
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    end
    error("json.encode: cannot encode type " .. t)
end

json.encode = function(v)
    return encodeValue(v)
end

local decodeValue

local function skipWhitespace(str, pos)
    local _, e = str:find("^%s*", pos)
    return e + 1
end

local function decodeString(str, pos)
    assert(str:sub(pos, pos) == '"', "expected string")
    local out = {}
    local i = pos + 1
    while true do
        local c = str:sub(i, i)
        if c == "" then error("unterminated string") end
        if c == '"' then
            return table.concat(out), i + 1
        elseif c == "\\" then
            local nextC = str:sub(i + 1, i + 1)
            local escapes = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
            out[#out + 1] = escapes[nextC] or nextC
            i = i + 2
        else
            out[#out + 1] = c
            i = i + 1
        end
    end
end

local function decodeNumber(str, pos)
    local s, e = str:find("^%-?%d+%.?%d*[eE]?[%+%-]?%d*", pos)
    return tonumber(str:sub(s, e)), e + 1
end

local function decodeArray(str, pos)
    local arr = {}
    local i = skipWhitespace(str, pos + 1)
    if str:sub(i, i) == "]" then return arr, i + 1 end
    while true do
        local value
        value, i = decodeValue(str, i)
        arr[#arr + 1] = value
        i = skipWhitespace(str, i)
        local c = str:sub(i, i)
        if c == "]" then return arr, i + 1 end
        assert(c == ",", "expected , or ] in array")
        i = skipWhitespace(str, i + 1)
    end
end

local function decodeObject(str, pos)
    local obj = {}
    local i = skipWhitespace(str, pos + 1)
    if str:sub(i, i) == "}" then return obj, i + 1 end
    while true do
        i = skipWhitespace(str, i)
        local key
        key, i = decodeString(str, i)
        i = skipWhitespace(str, i)
        assert(str:sub(i, i) == ":", "expected : in object")
        i = skipWhitespace(str, i + 1)
        local value
        value, i = decodeValue(str, i)
        obj[key] = value
        i = skipWhitespace(str, i)
        local c = str:sub(i, i)
        if c == "}" then return obj, i + 1 end
        assert(c == ",", "expected , or } in object")
        i = skipWhitespace(str, i + 1)
    end
end

decodeValue = function(str, pos)
    local i = skipWhitespace(str, pos)
    local c = str:sub(i, i)
    if c == '"' then
        return decodeString(str, i)
    elseif c == "{" then
        return decodeObject(str, i)
    elseif c == "[" then
        return decodeArray(str, i)
    elseif str:sub(i, i + 3) == "true" then
        return true, i + 4
    elseif str:sub(i, i + 4) == "false" then
        return false, i + 5
    elseif str:sub(i, i + 3) == "null" then
        return nil, i + 4
    else
        return decodeNumber(str, i)
    end
end

json.decode = function(str)
    return decodeValue(str, 1)
end
```

- [ ] **Step 2: Manually verify in BizHawk's Lua Console**

With any script running (or the console idle), load and exercise the module:

```lua
package.path = package.path..";lua\\?.lua"
require "json"

print(json.encode({mode="checksSeen", checksSeen={0,1,2}}))
```

Expected output (key order may vary since Lua tables are unordered, but both forms are valid): `{"mode":"checksSeen","checksSeen":[0,1,2]}`

```lua
local decoded = json.decode('{"mode":"checksSeen+items","checksSeen":[1,2,3]}')
print(decoded.mode, decoded.checksSeen[1], decoded.checksSeen[2], decoded.checksSeen[3])
```

Expected output: `checksSeen+items    1    2    3`

```lua
local roundTrip = json.decode(json.encode({player="ds83171", game=2, items={0,16}}))
print(roundTrip.player, roundTrip.game, roundTrip.items[1], roundTrip.items[2])
```

Expected output: `ds83171    2    0    16`

If any of these don't match, stop and fix `lua/json.lua` before proceeding to later tasks that depend on it.

- [ ] **Step 3: Commit**

```bash
git add lua/json.lua
git commit -m "Add minimal Lua JSON encode/decode module"
```

---

### Task 13: Verify BizHawk's HTTP capability (spike)

**Files:** none created — this is a manual verification task whose output is a go/no-go decision for Task 14.

**Interfaces:** none yet — this determines what Task 14 can safely assume about `comm.httpGet`/`comm.httpPost`.

This is the spec's flagged open item: BizHawk's Lua `comm` library is documented to include synchronous `comm.httpGet(url)` and `comm.httpPost(url, payload)` functions, but the `ref/` scripts have never exercised them, so this must be confirmed against the actual BizHawk build before `lua/http_client.lua` is written to depend on them.

- [ ] **Step 1: Start the real backend (or local dev server) and boot a game**

Either keep `npm run dev` running in `worker/` (Task 8), or use the already-deployed URL from Task 8. Load `boot.lua` in BizHawk against a real ROM and let it boot into gameplay (past the boss-select/boot sequence).

- [ ] **Step 2: Test `comm.httpGet` from the Lua Console**

With the game running, type into BizHawk's Lua Console (substituting your dev or deployed URL, and using a room that exists — create one via `admin/host_admin.html` first if needed, e.g. `manual-comm-test`):

```lua
print(type(comm), type(comm.httpGet), type(comm.httpPost))
```

Expected: `table    function    function`. If either is `nil`, **stop here** — `comm.httpGet`/`httpPost` aren't available on this BizHawk build, and Task 14 needs to be revised (e.g. checking for `comm.httpGetAsync`/`httpPostAsync` instead, or a different BizHawk version) before proceeding. Report back with what `type(comm.httpGet)` etc. actually returned.

- [ ] **Step 3: Test an actual GET call**

```lua
print(comm.httpGet("http://127.0.0.1:8787/room/manual-comm-test/admin/status"))
```

(Use the deployed `https://` URL instead if not running `wrangler dev` locally.)

Expected: prints a JSON string like `{"mode":null,"checksSeenBitsSet":0,"eventCount":0,"connected":0}` (or the room's actual state if already created). If this throws an error or hangs indefinitely, **stop here** and report the exact error — it may indicate BizHawk needs a setting enabled (e.g. `comm.httpSetTimeout`) or that outbound HTTP is blocked.

- [ ] **Step 4: Test an actual POST call**

```lua
print(comm.httpPost("http://127.0.0.1:8787/room/manual-comm-test/admin/init", "{\"mode\":\"checksSeen\"}"))
```

Expected: prints `{"mode":"checksSeen","created":true}` (or `created:false` if already created from Step 3's room). If this succeeds, Task 14 can proceed exactly as written. If it fails in any way, stop and report the exact behavior before writing `lua/http_client.lua` — do not guess at a fix.

---

### Task 14: Lua HTTP client wrapper

**Files:**
- Create: `lua/http_client.lua`

**Interfaces:**
- Consumes: `json` global from `lua/json.lua` (Task 12); `comm.httpPost`, confirmed available in Task 13.
- Produces: `Http.postJson(url, tbl): (table|nil, string|nil)` — returns `(decodedResponse, nil)` on success or `(nil, errorMessage)` on any failure (network error, non-JSON response, or `comm.httpPost` unavailable). Isolates all networking-API risk to this one file, per the spec's note that `comm.http*` needs double-checking. (Only `POST` is needed — `share_info.lua`, Task 15, only ever calls `/sync` and `/event`, both `POST`; there's no `GET` call anywhere in the design, so no `Http.getJson` is defined.)

**Precondition:** Task 13 confirmed `comm.httpPost` works as expected. If Task 13 found different behavior, adapt the implementation below accordingly before proceeding.

- [ ] **Step 1: Implement `lua/http_client.lua`**

```lua
package.path = package.path..";lua\\?.lua"
require "json"

Http = {}

function Http.postJson(url, tbl)
    if not comm or not comm.httpPost then
        return nil, "comm.httpPost is not available in this BizHawk build"
    end
    local payload = json.encode(tbl)
    local ok, body = pcall(comm.httpPost, url, payload)
    if not ok then
        return nil, "http error: " .. tostring(body)
    end
    local decodeOk, decoded = pcall(json.decode, body)
    if not decodeOk then
        return nil, "json decode error: " .. tostring(decoded)
    end
    return decoded, nil
end
```

- [ ] **Step 2: Manually verify in BizHawk's Lua Console**

Using the same room as Task 13:

```lua
package.path = package.path..";lua\\?.lua"
require "http_client"

local result, err = Http.postJson("http://127.0.0.1:8787/room/manual-comm-test/sync", { checksSeen = (function() local t={} for i=1,96 do t[i]=0 end return t end)() })
print(err)
print(result and result.mode)
```

Expected: `err` prints as `nil`, `result.mode` prints as `checksSeen` (the mode set in Task 13). Then test the error path with a nonexistent room:

```lua
local result2, err2 = Http.postJson("http://127.0.0.1:8787/room/does-not-exist-yet/sync", { checksSeen = (function() local t={} for i=1,96 do t[i]=0 end return t end)() })
print(err2)
print(result2 and result2.error)
```

Expected: `err2` prints as `nil` (the HTTP call itself succeeded), and `result2.error` prints as `room not initialized` (the Worker's own error body, correctly decoded).

- [ ] **Step 3: Commit**

```bash
git add lua/http_client.lua
git commit -m "Add Lua HTTP client wrapper over comm.httpGet/httpPost"
```

---

### Task 15: Config loader + main companion script

**Files:**
- Create: `config/share_config.example.txt`
- Create: `lua/config.lua`
- Create: `lua/share_info.lua`

**Interfaces:**
- Consumes: `Http.postJson` from `lua/http_client.lua` (Task 14); globals from `boot.lua` (already running): `cpu`, `cpu2`, `ew`, `Text`, `sessionSave.param`, `sessionSave.checksSeen`.
- Produces: `ShareConfig.load(filename): (table|nil, string|nil)`; the running `share_info.lua` script itself (no other file depends on it — it's the top-level entry point players load in BizHawk).

**Note:** `share_info.lua` does **not** use `itemName` (from `ref/multiworld/lua/itemName.lua`) at all — see Task 10's design note. It sends raw numeric item IDs to `/event`; the tracker (Task 10/11) is solely responsible for turning an ID into a label or icon.

- [ ] **Step 1: Create `config/share_config.example.txt`**

```
# Copy this file to share_config.txt (same folder as boot.lua) and fill in
# your values before loading share_info.lua.
player_name=YourNameHere
worker_url=https://rmr-sync.yourname.workers.dev
```

- [ ] **Step 2: Implement `lua/config.lua`**

```lua
ShareConfig = {}

function ShareConfig.load(filename)
    local fh = io.open(filename, "r")
    if not fh then
        return nil, "config file not found: " .. filename
    end
    local cfg = {}
    for line in fh:lines() do
        local trimmed = line:match("^%s*(.-)%s*$")
        if trimmed ~= "" and not trimmed:match("^#") then
            local key, value = trimmed:match("^([%w_]+)%s*=%s*(.-)%s*$")
            if key then
                cfg[key] = value
            end
        end
    end
    fh:close()
    if not cfg.player_name or cfg.player_name == "" then
        return nil, "share_config.txt is missing player_name"
    end
    if not cfg.worker_url or cfg.worker_url == "" then
        return nil, "share_config.txt is missing worker_url"
    end
    return cfg, nil
end
```

- [ ] **Step 3: Manually verify `lua/config.lua` in BizHawk's Lua Console**

Create a temporary test file `test_config.txt` in the BizHawk working directory:

```
# comment line, should be ignored
player_name=tester
worker_url=http://127.0.0.1:8787
```

Then in the console:

```lua
package.path = package.path..";lua\\?.lua"
require "config"
local cfg, err = ShareConfig.load("test_config.txt")
print(err)
print(cfg and cfg.player_name, cfg and cfg.worker_url)
```

Expected: `err` prints `nil`, second line prints `tester    http://127.0.0.1:8787`. Also verify the missing-file case:

```lua
local cfg2, err2 = ShareConfig.load("does_not_exist.txt")
print(err2)
```

Expected: `config file not found: does_not_exist.txt`. Delete `test_config.txt` once confirmed.

- [ ] **Step 4: Implement `lua/share_info.lua`**

```lua
-- Load this script after boot.lua has finished booting into gameplay
-- (not during the boot/boss-select screen).

package.path = package.path..";lua\\?.lua"
require "json"
require "http_client"
require "config"

local cChecksPerTitle = 0x20
local addrChecksSeen = 0x7FFF80
local addrItems = 0x7FFF00
local cItems = 0x60
local cWaitFrames = 300 -- poll roughly every 5 seconds at 60fps

local function urlEncode(str)
    return (str:gsub("[^%w_%-%.~]", function(c)
        return string.format("%%%02X", c:byte())
    end))
end

local function currentTitle()
    local tmp = cpu[0x80FFC9] - 0x30
    if tmp < 0 then tmp = 1 end
    return tmp
end

local function readChecksSeen()
    local arr = {}
    for i = 0, 95 do
        arr[i + 1] = sessionSave.checksSeen[i] or 0
    end
    return arr
end

local function writeChecksSeen(merged)
    for i = 0, 95 do
        sessionSave.checksSeen[i] = merged[i + 1]
    end
    local title = currentTitle()
    local baseOffset = (title - 1) * cChecksPerTitle
    for i = 0, cChecksPerTitle - 1 do
        cpu[addrChecksSeen + i] = cpu[addrChecksSeen + i] | merged[baseOffset + i + 1]
    end
end

local function readItems()
    local arr = {}
    for i = 0, cItems - 1 do
        arr[i + 1] = cpu[addrItems + i]
    end
    return arr
end

local cfg, cfgErr = ShareConfig.load("share_config.txt")
if not cfg then
    error("share_info.lua: " .. cfgErr)
end

local roomUrl = cfg.worker_url .. "/room/" .. urlEncode(sessionSave.param)
local shareMode = nil
local previousItems = nil
local waitFrames = 0

local function statusLine(text)
    Text.out(16, 32, "share_info: " .. text, ew.RGB(255, 255, 0), ew.RGBA(0, 0, 0, 192))
end

local function pollRoom()
    local result, err = Http.postJson(roomUrl .. "/sync", { checksSeen = readChecksSeen() })
    if not result then
        statusLine("connection failed (" .. tostring(err) .. ")")
        return
    end
    if result.error then
        statusLine(tostring(result.error))
        return
    end

    shareMode = result.mode
    writeChecksSeen(result.checksSeen)

    if shareMode == "checksSeen+items" then
        local items = readItems()
        if previousItems then
            local newlyAcquired = {}
            for i = 1, cItems do
                local before = previousItems[i]
                local after = items[i]
                if before ~= after then
                    for bit = 0, 7 do
                        local mask = 1 << bit
                        if (before & mask) == 0 and (after & mask) ~= 0 then
                            table.insert(newlyAcquired, (i - 1) * 8 + bit)
                        end
                    end
                end
            end
            if #newlyAcquired > 0 then
                Http.postJson(roomUrl .. "/event", {
                    player = cfg.player_name,
                    game = currentTitle(),
                    items = newlyAcquired,
                })
            end
        end
        previousItems = items
    end
end

while true do
    waitFrames = waitFrames - 1
    if waitFrames <= 0 then
        waitFrames = cWaitFrames
        pollRoom()
    end
    ew.frameadvance()
end
```

- [ ] **Step 5: Manually verify with two BizHawk instances**

1. Set up two separate BizHawk instances, each with its own copy of a generated seed pack (same seed — use `ref/aaa` twice, in two different folders, or two fresh copies of the same generated pack).
2. In each folder, copy `config/share_config.example.txt` to `share_config.txt` and fill in a distinct `player_name` for each (e.g. `player1`, `player2`) and the same `worker_url` (the deployed URL from Task 8, or a shared local dev server if both instances can reach the same machine).
3. Use `admin/host_admin.html` to create a room with the room key set to the seed's actual Option string (from that seed pack's `spoiler.txt`) and mode `checksSeen+items`.
4. In each BizHawk instance: load `boot.lua`, get past the boot sequence into gameplay, then load `lua/share_info.lua` as a second script.
5. In BizHawk 1, scout/reveal a location that increases `checksSeen` (or, if a real in-game scouting trigger isn't readily reachable, simulate it by directly poking a `checksSeen` bit via the Lua Console: `cpu[0x7FFF80] = cpu[0x7FFF80] | 1`) and wait ~5-10 seconds (one poll cycle).
6. In BizHawk 2, check the same address after its own next poll cycle: `print(cpu[0x7FFF80])` — expected: bit 0 is set there too, confirming cross-instance sync.
7. In BizHawk 1, pick up a real item. Expected: within one poll cycle, `admin/host_admin.html`'s "Refresh Status" shows `event count` incremented, and (if `tracker/event_feed.html` is open on the same room) the event appears live with `player1`'s name and the correct icon.
8. Stop BizHawk 2's `share_info.lua` (or don't load it yet) and confirm BizHawk 1 alone shows the "waiting"/error status line if the room doesn't exist yet — test this by pointing at a fresh, uncreated room key temporarily.

- [ ] **Step 6: Commit**

```bash
git add config/share_config.example.txt lua/config.lua lua/share_info.lua
git commit -m "Add companion Lua script tying config, HTTP sync, and item-pickup events together"
```

---

### Task 16: Top-level README and final end-to-end pass

**Files:**
- Create: `README.md`

**Interfaces:** none — this is documentation plus a final verification pass across everything built.

- [ ] **Step 1: Create the top-level `README.md`**

```markdown
# RMR Sync

A companion mod for RouteMatriX Randomizer (Mega Man X1–X3 combined
randomizer) that lets multiple players on the same seed share:

1. **checksSeen** — which locations have been scouted/hinted, OR-merged
   across the group (pure intel, no item advantage).
2. **A live item-pickup event feed** — a shared web page showing each
   player's pickups in real time, with icons.

See `docs/superpowers/specs/2026-07-04-share-information-mod-design.md`
for the full design.

## Components

- `worker/` — Cloudflare Worker + Durable Object backend. See
  `worker/README.md` to deploy your own (or use a shared instance someone
  else deployed).
- `admin/host_admin.html` — open this to create/reset/inspect a room. Not
  needed by regular players, only whoever is organizing the session.
- `lua/share_info.lua` — the BizHawk companion script every player loads
  after `boot.lua`. Copy `config/share_config.example.txt` to
  `share_config.txt` next to `boot.lua` and fill in your name and the
  Worker URL first.
- `tracker/event_feed.html` — open with `?room=<the seed's Option string>`
  to watch the live event feed.

## Quick start (for a group already using a deployed Worker)

1. Whoever's organizing: open `admin/host_admin.html`, enter the Worker
   URL, the room key (the seed's Option string, from that seed's
   `spoiler.txt`), pick a share mode, and click **Create Room**.
2. Every player: copy `config/share_config.example.txt` to
   `share_config.txt` next to your `boot.lua`, fill in your name and the
   same Worker URL, then load `boot.lua` as normal, get into gameplay,
   and load `lua/share_info.lua` as a second script.
3. Optional: anyone can open `tracker/event_feed.html?room=<option string>`
   to watch the live feed.

## Deploying your own backend

See `worker/README.md`. No changes to any other file are needed — just
point `worker_url` (in `share_config.txt` and the admin page) at your own
deployed Worker.
```

- [ ] **Step 2: Run the full backend automated test suite one final time**

Run: `npm test` (in `worker/`)
Expected: every suite from Tasks 1–7 passes.

Run: `node --test tracker/icon_map.test.mjs`
Expected: all tests pass.

- [ ] **Step 3: Full end-to-end pass**

Repeat Task 15 Step 5 in full (two BizHawk instances, same seed, real playthrough) for 15-20 minutes of actual play rather than a single spot-check, watching for: dropped events (compare each instance's real acquired items against what appears in `tracker/event_feed.html`), any RAM/gameplay corruption from the `writeChecksSeen` fold-back (compare in-game hint behavior against the single-player `ref/multiworld` behavior — hints should never regress or show corrupted text), and whether the ~5-second poll cadence causes any noticeable emulation hitching (since `comm.httpGet`/`httpPost` are synchronous/blocking calls per Task 13's findings).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Add top-level README tying all components together"
```
