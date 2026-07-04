import { describe, it, expect } from "vitest";
import { env, runDurableObjectAlarm } from "cloudflare:test";

function getStub(roomName) {
  const id = env.ROOM.idFromName(roomName);
  return env.ROOM.get(id);
}

function postJson(stub, path, body) {
  return stub.fetch(`https://do${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("RoomDO admin lifecycle", () => {
  it("creates a room with the given mode", async () => {
    const stub = getStub("test-room-init-1");
    const res = await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "s3cr3t" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "checksSeen", created: true });
  });

  it("is idempotent on repeated init calls, ignoring the second caller's secret", async () => {
    const stub = getStub("test-room-init-2");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "first-secret" });
    const res = await postJson(stub, "/admin/init", { mode: "checksSeen+items", adminSecret: "second-secret" });
    expect(await res.json()).toEqual({ mode: "checksSeen", created: false });
  });

  it("rejects an invalid mode", async () => {
    const stub = getStub("test-room-init-3");
    const res = await postJson(stub, "/admin/init", { mode: "not-a-real-mode", adminSecret: "s3cr3t" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid or missing admin secret on creation", async () => {
    const stub = getStub("test-room-init-4");
    const res = await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "" });
    expect(res.status).toBe(400);
  });

  it("reports status for an uninitialized room", async () => {
    const stub = getStub("test-room-status-1");
    const res = await stub.fetch("https://do/admin/status");
    expect(await res.json()).toEqual({ mode: null, checksSeenBitsSet: 0, eventCount: 0, connected: 0 });
  });

  it("never exposes the admin secret via status", async () => {
    const stub = getStub("test-room-status-2");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "s3cr3t" });
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.adminSecret).toBeUndefined();
  });

  it("returns 404 for an unknown path", async () => {
    const stub = getStub("test-room-404-1");
    const res = await stub.fetch("https://do/nope");
    expect(res.status).toBe(404);
  });

  it("resets checksSeen and events but keeps mode, given the correct admin secret", async () => {
    const stub = getStub("test-room-reset-1");
    await postJson(stub, "/admin/init", { mode: "checksSeen+items", adminSecret: "s3cr3t" });
    const res = await postJson(stub, "/admin/reset", { adminSecret: "s3cr3t" });
    expect(await res.json()).toEqual({ ok: true });
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status).toEqual({ mode: "checksSeen+items", checksSeenBitsSet: 0, eventCount: 0, connected: 0 });
  });

  it("rejects reset with a missing or wrong admin secret", async () => {
    const stub = getStub("test-room-reset-2");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "correct-secret" });

    const wrongRes = await postJson(stub, "/admin/reset", { adminSecret: "wrong-secret" });
    expect(wrongRes.status).toBe(403);

    const missingRes = await stub.fetch("https://do/admin/reset", { method: "POST" });
    expect(missingRes.status).toBe(403);
  });

  it("rejects reset attempted before the room is initialized", async () => {
    const stub = getStub("test-room-reset-3");
    const res = await postJson(stub, "/admin/reset", { adminSecret: "anything" });
    expect(res.status).toBe(409);
  });
});

describe("RoomDO auto-expiry", () => {
  it("schedules an alarm on room creation, and wipes storage when it fires", async () => {
    const id = env.ROOM.idFromName("test-room-expiry-1");
    const stub = env.ROOM.get(id);
    await postJson(stub, "/admin/init", { mode: "checksSeen+items", adminSecret: "s3cr3t" });

    const before = await stub.fetch("https://do/admin/status");
    expect((await before.json()).mode).toBe("checksSeen+items");

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const after = await stub.fetch("https://do/admin/status");
    expect(await after.json()).toEqual({ mode: null, checksSeenBitsSet: 0, eventCount: 0, connected: 0 });
  });
});
