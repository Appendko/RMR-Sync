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
    await initRoom(stub, "checksSeen+item");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("accepts and stores events when mode is checksSeen+item+all", async () => {
    const stub = getStub("test-room-event-3b");
    await initRoom(stub, "checksSeen+item+all");
    const res = await postEvent(stub, { player: "a", game: 1, items: [0] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(1);
  });

  it("rejects an invalid event body", async () => {
    const stub = getStub("test-room-event-4");
    await initRoom(stub, "checksSeen+item");
    const res = await postEvent(stub, { player: "", game: 1, items: [0] });
    expect(res.status).toBe(400);
  });

  it("trims the event log to the most recent 200 entries", async () => {
    const stub = getStub("test-room-event-5");
    await initRoom(stub, "checksSeen+item");
    for (let i = 0; i < 205; i++) {
      await postEvent(stub, { player: "a", game: 1, items: [i] });
    }
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(200);
  });

  it("silently filters an immediate exact duplicate event", async () => {
    const stub = getStub("test-room-event-6");
    await initRoom(stub, "checksSeen+item");
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
    await initRoom(stub, "checksSeen+item");
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
    await initRoom(stub, "checksSeen+item");
    await postEvent(stub, { player: "a", game: 1, items: [7] });
    const res = await postEvent(stub, { player: "b", game: 1, items: [7] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.eventCount).toBe(2);
  });

  it("accepts (200, ok:true) but does not log a fully-duplicate request", async () => {
    const stub = getStub("test-room-event-9");
    await initRoom(stub, "checksSeen+item");
    await postEvent(stub, { player: "a", game: 1, items: [20] });
    const statusAfterFirst = await (await stub.fetch("https://do/admin/status")).json();
    expect(statusAfterFirst.eventCount).toBe(1);

    const res = await postEvent(stub, { player: "a", game: 1, items: [20] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const statusAfterSecond = await (await stub.fetch("https://do/admin/status")).json();
    expect(statusAfterSecond.eventCount).toBe(1);
  });
});

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

describe("RoomDO /event -- item merging (checksSeen+item+all mode)", () => {
  it("merges an item with no share category, with no shareFlags stored at all", async () => {
    const stub = getStub("test-room-merge-all-1");
    await initRoom(stub, "checksSeen+item+all");
    await postEvent(stub, { player: "a", game: 1, items: [40] }); // 1ItWeaponLO, no category
    const { mergedItems } = await (await sync(stub)).json();
    expect(mergedItems[5] & 0x1).toBe(0x1); // id 40: byte 5, bit 0
    expect(mergedItems[37] & 0x1).toBe(0x1); // id 296: byte 37, bit 0
    expect(mergedItems[69] & 0x1).toBe(0x1); // id 552: byte 69, bit 0
  });

  it("still merges a shared-category pickup the same as checksSeen+item mode", async () => {
    const stub = getStub("test-room-merge-all-2");
    await initRoom(stub, "checksSeen+item+all");
    await postEvent(stub, { player: "a", game: 1, items: [36] }); // 1ItSubtank1
    const { mergedItems } = await (await sync(stub)).json();
    expect(mergedItems[4] & 0x10).toBe(0x10); // id 36: byte 4, bit 4
    expect(mergedItems[36] & 0x10).toBe(0x10); // id 292: byte 36, bit 4
    expect(mergedItems[68] & 0x10).toBe(0x10); // id 548: byte 68, bit 4
  });
});
