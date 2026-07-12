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
    const res = await postJson(stub, "/admin/init", { mode: "checksSeen+shared", adminSecret: "second-secret" });
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
    expect(await res.json()).toEqual({ mode: null, checksSeenBitsSet: 0, mergedItemsBitsSet: 0, eventCount: 0, connected: 0 });
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
    await postJson(stub, "/admin/init", { mode: "checksSeen+shared", adminSecret: "s3cr3t" });
    const res = await postJson(stub, "/admin/reset", { adminSecret: "s3cr3t" });
    expect(await res.json()).toEqual({ ok: true, mode: "checksSeen+shared" });
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status).toEqual({ mode: "checksSeen+shared", checksSeenBitsSet: 0, mergedItemsBitsSet: 0, eventCount: 0, connected: 0 });
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

  it("changes the stored mode when reset is given a valid new mode", async () => {
    const stub = getStub("test-room-reset-mode-1");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "s3cr3t" });
    const res = await postJson(stub, "/admin/reset", { adminSecret: "s3cr3t", mode: "checksSeen+shared" });
    expect(await res.json()).toEqual({ ok: true, mode: "checksSeen+shared" });
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.mode).toBe("checksSeen+shared");
  });

  it("rejects reset with an invalid mode and leaves state untouched", async () => {
    const stub = getStub("test-room-reset-mode-2");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "s3cr3t" });
    const res = await postJson(stub, "/admin/reset", { adminSecret: "s3cr3t", mode: "not-a-real-mode" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid mode" });
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status).toEqual({ mode: "checksSeen", checksSeenBitsSet: 0, mergedItemsBitsSet: 0, eventCount: 0, connected: 0 });
  });

  it("rejects reset with the wrong admin secret even if a valid mode is provided", async () => {
    const stub = getStub("test-room-reset-mode-3");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "correct-secret" });
    const res = await postJson(stub, "/admin/reset", { adminSecret: "wrong-secret", mode: "checksSeen+shared" });
    expect(res.status).toBe(403);
    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.mode).toBe("checksSeen");
  });

  it("fully wipes a room on delete, given the correct admin secret", async () => {
    const stub = getStub("test-room-delete-1");
    await postJson(stub, "/admin/init", { mode: "checksSeen+shared", adminSecret: "s3cr3t" });
    const res = await postJson(stub, "/admin/delete", { adminSecret: "s3cr3t" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status).toEqual({ mode: null, checksSeenBitsSet: 0, mergedItemsBitsSet: 0, eventCount: 0, connected: 0 });

    const initRes = await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "new-secret" });
    expect(await initRes.json()).toEqual({ mode: "checksSeen", created: true });
  });

  it("rejects delete with a missing or wrong admin secret and does not wipe storage", async () => {
    const stub = getStub("test-room-delete-2");
    await postJson(stub, "/admin/init", { mode: "checksSeen", adminSecret: "correct-secret" });

    const wrongRes = await postJson(stub, "/admin/delete", { adminSecret: "wrong-secret" });
    expect(wrongRes.status).toBe(403);

    const missingRes = await stub.fetch("https://do/admin/delete", { method: "POST" });
    expect(missingRes.status).toBe(403);

    const status = await (await stub.fetch("https://do/admin/status")).json();
    expect(status.mode).toBe("checksSeen");
  });

  it("rejects delete attempted before the room is initialized", async () => {
    const stub = getStub("test-room-delete-3");
    const res = await postJson(stub, "/admin/delete", { adminSecret: "anything" });
    expect(res.status).toBe(409);
  });
});

describe("RoomDO auto-expiry", () => {
  it("schedules an alarm on room creation, and wipes storage when it fires", async () => {
    const id = env.ROOM.idFromName("test-room-expiry-1");
    const stub = env.ROOM.get(id);
    await postJson(stub, "/admin/init", { mode: "checksSeen+shared", adminSecret: "s3cr3t" });

    const before = await stub.fetch("https://do/admin/status");
    expect((await before.json()).mode).toBe("checksSeen+shared");

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const after = await stub.fetch("https://do/admin/status");
    expect(await after.json()).toEqual({ mode: null, checksSeenBitsSet: 0, mergedItemsBitsSet: 0, eventCount: 0, connected: 0 });
  });
});
