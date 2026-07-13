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

function sync(stub, checksSeen, epoch, shareFlags, items = new Array(96).fill(0)) {
  return stub.fetch("https://do/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksSeen, epoch, shareFlags, items }),
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

  it("defaults to an empty shareFlags object when no client has ever sent one", async () => {
    const stub = getStub("test-room-sync-7");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect((await res.json()).shareFlags).toEqual({});
  });

  it("stores and echoes back a client-provided shareFlags object", async () => {
    const stub = getStub("test-room-sync-8");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0, { sigmaKey: true, lifeUp: false });
    expect((await res.json()).shareFlags).toEqual({ sigmaKey: true, lifeUp: false });
  });

  it("keeps the last-known shareFlags for a client that omits it", async () => {
    const stub = getStub("test-room-sync-9");
    await initRoom(stub, "checksSeen");
    await sync(stub, new Array(96).fill(0), 0, { sigmaKey: true });
    const res = await sync(stub, new Array(96).fill(0), 0); // no shareFlags this time
    expect((await res.json()).shareFlags).toEqual({ sigmaKey: true });
  });

  it("rejects an invalid shareFlags object", async () => {
    const stub = getStub("test-room-sync-10");
    await initRoom(stub, "checksSeen");
    const res = await sync(stub, new Array(96).fill(0), 0, { notARealFlag: true });
    expect(res.status).toBe(400);
  });

  it("defaults to an empty mergedItems array before any shared item is picked up", async () => {
    const stub = getStub("test-room-sync-11");
    await initRoom(stub, "checksSeen+shared");
    const res = await sync(stub, new Array(96).fill(0), 0);
    expect((await res.json()).mergedItems).toEqual(new Array(96).fill(0));
  });

  it("zeroes mergedItems on reset", async () => {
    const stub = getStub("test-room-sync-12");
    await initRoom(stub, "checksSeen+shared");
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

  it("OR-merges the full items array unconditionally across multiple players in checksSeen+items mode", async () => {
    const stub = getStub("test-room-sync-13");
    await initRoom(stub, "checksSeen+items");

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

  it("never merges id 572 (3ItKeyVavaStage) even in checksSeen+items mode -- owning it permanently hides the Vava-stage teleporter", async () => {
    const stub = getStub("test-room-sync-vava-key-1");
    await initRoom(stub, "checksSeen+items");

    const incoming = new Array(96).fill(0);
    incoming[71] = 0x10 | 0x20; // id 572 (3ItKeyVavaStage, must never merge) + id 573 (3ItKeyVajurila, must merge normally)
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, incoming);

    const { mergedItems } = await res.json();
    expect(mergedItems[71] & 0x10).toBe(0); // id 572 suppressed
    expect(mergedItems[71] & 0x20).toBe(0x20); // id 573 unaffected, merges normally
  });

  it("suppresses id 572 room-wide even after a different player's snapshot already set it (no way back in once excluded)", async () => {
    const stub = getStub("test-room-sync-vava-key-2");
    await initRoom(stub, "checksSeen+items");

    const first = new Array(96).fill(0);
    first[71] = 0x10; // id 572
    await sync(stub, new Array(96).fill(0), 0, undefined, first);

    const second = new Array(96).fill(0); // a later, unrelated sync from another player
    const res = await sync(stub, new Array(96).fill(0), 0, undefined, second);

    const { mergedItems } = await res.json();
    expect(mergedItems[71] & 0x10).toBe(0);
  });

  it("checksSeen+shared mode only merges whitelisted-category bits from the incoming items array", async () => {
    const stub = getStub("test-room-sync-14");
    await initRoom(stub, "checksSeen+shared");
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
    await initRoom(stub, "checksSeen+shared");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0xff; // ids 32-39: 32-35 are the unused gap (no category), 36-39 are subTank
    await sync(stub, new Array(96).fill(0), 0, { subTank: true }, incoming);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems[4]).toBe(0xf0); // only bits 4-7 (ids 36-39) merged; bits 0-3 (ids 32-35) must not be
  });

  it("does not merge a category that's explicitly false in shareFlags", async () => {
    const stub = getStub("test-room-sync-16");
    await initRoom(stub, "checksSeen+shared");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, { subTank: false }, incoming);
    const { mergedItems } = await (await sync(stub, new Array(96).fill(0), 0)).json();
    expect(mergedItems.every((b) => b === 0)).toBe(true);
  });

  it("does not merge a category with no shareFlags entry at all", async () => {
    const stub = getStub("test-room-sync-17");
    await initRoom(stub, "checksSeen+shared");
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

  it("discards a stale client's items contribution the same way it discards checksSeen (checksSeen+items mode)", async () => {
    const stub = getStub("test-room-sync-19");
    await initRoom(stub, "checksSeen+items");

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
    await initRoom(stub, "checksSeen+items");
    const incoming = new Array(96).fill(0);
    incoming[4] = 0x10; // id 36
    await sync(stub, new Array(96).fill(0), 0, undefined, incoming);
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.mergedItemsBitsSet).toBe(1);
  });
});
