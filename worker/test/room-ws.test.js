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
    await initRoom(stub, "checksSeen+shared");
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
    expect(initMsg.mode).toBe("checksSeen+shared");
    expect(initMsg.backlog).toHaveLength(1);
    expect(initMsg.backlog[0].items).toEqual([0]);
    expect(initMsg.shareFlags).toEqual({});
    ws.close();
  });

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

  it("includes shareFlags reported by an earlier /sync call in the init message", async () => {
    const stub = getStub("test-room-ws-4");
    await initRoom(stub, "checksSeen+shared");
    await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch: 0, shareFlags: { sigmaKey: true } }),
    });

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.shareFlags).toEqual({ sigmaKey: true });
    ws.close();
  });

  it("defaults randomizedGames to [true, true, true] in the init message when never set", async () => {
    const stub = getStub("test-room-ws-rg-default");
    await initRoom(stub, "checksSeen");
    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.randomizedGames).toEqual([true, true, true]);
    ws.close();
  });

  it("includes randomizedGames reported by an earlier /sync call in the init message", async () => {
    const stub = getStub("test-room-ws-rg");
    await initRoom(stub, "checksSeen+shared");
    await stub.fetch("https://do/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch: 0, randomizedGames: [true, false, true] }),
    });

    const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const initMsg = await nextMessage(ws);
    expect(initMsg.randomizedGames).toEqual([true, false, true]);
    ws.close();
  });

  it("broadcasts new events to connected sockets", async () => {
    const stub = getStub("test-room-ws-3");
    await initRoom(stub, "checksSeen+shared");

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
