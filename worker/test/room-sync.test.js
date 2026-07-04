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

function sync(stub, checksSeen, epoch) {
  return stub.fetch("https://do/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksSeen, epoch }),
  });
}

describe("RoomDO /sync", () => {
  it("rejects sync before the room is initialized", async () => {
    const stub = getStub("test-room-sync-1");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect(res.status).toBe(409);
  });

  it("OR-merges checksSeen across multiple sync calls at the current epoch", async () => {
    const stub = getStub("test-room-sync-2");
    await initRoom(stub, "checksSeen");

    const playerA = new Array(96).fill(0);
    playerA[0] = 0b0001;
    const resA = await sync(stub, playerA, 0);
    expect((await resA.json()).checksSeen[0]).toBe(0b0001);

    const playerB = new Array(96).fill(0);
    playerB[0] = 0b0010;
    const resB = await sync(stub, playerB, 0);
    expect((await resB.json()).checksSeen[0]).toBe(0b0011);

    const resC = await sync(stub, new Array(96).fill(0), 0);
    expect((await resC.json()).checksSeen[0]).toBe(0b0011);
  });

  it("returns the current epoch alongside the merged state", async () => {
    const stub = getStub("test-room-sync-4");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect((await res.json()).epoch).toBe(0);
  });

  it("discards a stale client's contribution instead of merging it, but returns current state", async () => {
    const stub = getStub("test-room-sync-5");
    await initRoom(stub, "checksSeen");

    const fresh = new Array(96).fill(0);
    fresh[0] = 0b0001;
    await sync(stub, fresh, 0);

    await stub.fetch("https://do/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: "test-secret" }),
    });

    const staleContribution = new Array(96).fill(0);
    staleContribution[0] = 0b0001; // this player's own already-known bit, from before the reset
    const res = await sync(stub, staleContribution, 0); // still reporting epoch 0, the pre-reset epoch

    const data = await res.json();
    expect(data.epoch).toBe(1); // room moved on to epoch 1
    expect(data.checksSeen[0]).toBe(0); // the stale contribution was NOT merged in

    // A second sync at the now-current epoch behaves normally again.
    const res2 = await sync(stub, new Array(96).fill(0), 1);
    expect((await res2.json()).checksSeen[0]).toBe(0);
  });

  it("rejects a checksSeen array of the wrong length", async () => {
    const stub = getStub("test-room-sync-3");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, [0, 1, 2], 0);
    expect(res.status).toBe(400);
  });

  it("rejects a missing or invalid epoch", async () => {
    const stub = getStub("test-room-sync-6");
    await initRoom(stub, "checksSeen");
    const res = await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0) }),
    });
    expect(res.status).toBe(400);
  });
});
