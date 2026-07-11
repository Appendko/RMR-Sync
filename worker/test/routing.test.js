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
      body: JSON.stringify({ mode: "checksSeen+shared", adminSecret: "test-secret" }),
    });
    expect(initRes.status).toBe(200);
    expect(initRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const syncRes = await SELF.fetch("https://example.com/room/test-route-2/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksSeen: new Array(96).fill(0), items: new Array(96).fill(0), epoch: 0 }),
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
      body: JSON.stringify({ mode: "checksSeen", adminSecret: "test-secret" }),
    });
    const statusB = await SELF.fetch("https://example.com/room/test-route-3b/admin/status");
    const dataB = await statusB.json();
    expect(dataB.mode).toBeNull();
  });

  it("passes the WebSocket upgrade through without CORS wrapping breaking it", async () => {
    await SELF.fetch("https://example.com/room/test-route-4/admin/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "checksSeen", adminSecret: "test-secret" }),
    });
    const res = await SELF.fetch("https://example.com/room/test-route-4/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    res.webSocket.accept();
    res.webSocket.close();
  });
});
