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
