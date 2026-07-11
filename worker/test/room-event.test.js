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
    body: JSON.stringify({ mode, adminSecret: "test-secret" }),
  });
}

function postEvent(stub, body) {
  return stub.fetch("https://do/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
  });
}

async function getBacklog(stub) {
  const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  ws.accept();
  const initMsg = await nextMessage(ws);
  ws.close();
  return initMsg.backlog;
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
    await initRoom(stub, "checksSeen+shared");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("accepts and stores events when mode is checksSeen+items", async () => {
    const stub = getStub("test-room-event-3b");
    await initRoom(stub, "checksSeen+items");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("rejects an invalid event body", async () => {
    const stub = getStub("test-room-event-4");
    await initRoom(stub, "checksSeen+shared");
    const res = await postEvent(stub, { player: "", game: 1, items: [0] });
    expect(res.status).toBe(400);
  });

  it("trims the event log to the most recent 200 entries", async () => {
    const stub = getStub("test-room-event-5");
    await initRoom(stub, "checksSeen+shared");
    for (let i = 0; i < 205; i++) {
      await postEvent(stub, { player: "a", game: 1, items: [i] });
    }
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(200);
  });

  it("silently filters an immediate exact duplicate event", async () => {
    const stub = getStub("test-room-event-6");
    await initRoom(stub, "checksSeen+shared");
    const first = await postEvent(stub, { player: "a", game: 1, items: [5] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    const second = await postEvent(stub, { player: "a", game: 1, items: [5] });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("filters only the duplicate items from a mixed request, keeping the new ones", async () => {
    const stub = getStub("test-room-event-7");
    await initRoom(stub, "checksSeen+shared");
    await postEvent(stub, { player: "a", game: 1, items: [10] });
    const res = await postEvent(stub, { player: "a", game: 1, items: [10, 11] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(2);

    const backlog = await getBacklog(stub);
    expect(backlog).toHaveLength(2);
    expect(backlog[0].items).toEqual([10]);
    expect(backlog[1].items).toEqual([11]);
  });

  it("does not dedupe the same item id across different players", async () => {
    const stub = getStub("test-room-event-8");
    await initRoom(stub, "checksSeen+shared");
    await postEvent(stub, { player: "a", game: 1, items: [7] });
    const res = await postEvent(stub, { player: "b", game: 1, items: [7] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(2);
  });

  it("accepts (200, ok:true) but does not log a fully-duplicate request", async () => {
    const stub = getStub("test-room-event-9");
    await initRoom(stub, "checksSeen+shared");
    await postEvent(stub, { player: "a", game: 1, items: [20] });
    const statusAfterFirst = await (await stub.fetch("https://do/admin/status")).json();
    expect(statusAfterFirst.eventCount).toBe(1);

    const res = await postEvent(stub, { player: "a", game: 1, items: [20] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const statusAfterSecond = await (await stub.fetch("https://do/admin/status")).json();
    expect(statusAfterSecond.eventCount).toBe(1);
  });

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
});

// mergedItems merging now happens exclusively via /sync's own `items` field
// (see room-sync.test.js) -- /event only logs to the event feed and
// broadcasts over WS. These tests guard against the old event-driven merge
// computation silently creeping back into handleEvent.
function sync(stub, epoch = 0) {
  return stub.fetch("https://do/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), checks: new Array(96).fill(0), epoch }),
  });
}

describe("RoomDO /event -- no longer merges items (moved to /sync)", () => {
  it("posting a whitelisted-category item via /event does not change mergedItems", async () => {
    const stub = getStub("test-room-event-merge-1");
    await initRoom(stub, "checksSeen+shared");
    await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), checks: new Array(96).fill(0), epoch: 0, shareFlags: { subTank: true } }),
    });
    await postEvent(stub, { player: "a", game: 1, items: [36] }); // 1ItSubtank1
    const { mergedItems } = await (await sync(stub)).json();
    expect(mergedItems.every((b) => b === 0)).toBe(true);
  });

  it("posting a non-whitelisted item via /event in checksSeen+items mode does not change mergedItems", async () => {
    const stub = getStub("test-room-event-merge-2");
    await initRoom(stub, "checksSeen+items");
    await postEvent(stub, { player: "a", game: 1, items: [40] }); // 1ItWeaponLO, no category
    const { mergedItems } = await (await sync(stub)).json();
    expect(mergedItems.every((b) => b === 0)).toBe(true);
  });
});

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
