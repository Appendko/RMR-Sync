import { orMergeBytes, countSetBits } from "./bits.js";
import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidEpoch } from "./validation.js";

const CHECKS_SEEN_LENGTH = 96;
const EXPIRY_MS = 24 * 60 * 60 * 1000;

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
      return this.handleReset(request);
    }
    if (path === "/sync" && request.method === "POST") {
      return this.handleSync(request);
    }
    return jsonResponse({ error: "not found" }, 404);
  }

  async scheduleExpiry() {
    await this.state.storage.setAlarm(Date.now() + EXPIRY_MS);
  }

  async alarm() {
    await this.state.storage.deleteAll();
    this.sockets.clear();
  }

  async handleInit(request) {
    const body = await request.json().catch(() => null);
    if (!body || !isValidMode(body.mode) || !isValidAdminSecret(body.adminSecret)) {
      return jsonResponse({ error: "invalid mode or adminSecret" }, 400);
    }
    const existingMode = await this.state.storage.get("mode");
    if (existingMode) {
      return jsonResponse({ mode: existingMode, created: false });
    }
    await this.state.storage.put("mode", body.mode);
    await this.state.storage.put("adminSecret", body.adminSecret);
    await this.state.storage.put("resetEpoch", 0);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.scheduleExpiry();
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

  async handleReset(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    const storedSecret = await this.state.storage.get("adminSecret");
    if (!body || body.adminSecret !== storedSecret) {
      return jsonResponse({ error: "invalid admin secret" }, 403);
    }
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    await this.state.storage.put("resetEpoch", currentEpoch + 1);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.scheduleExpiry();
    return jsonResponse({ ok: true });
  }

  async handleSync(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    if (!body || !isValidChecksSeenArray(body.checksSeen) || !isValidEpoch(body.epoch)) {
      return jsonResponse({ error: "invalid checksSeen or epoch" }, 400);
    }
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    const stored = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);

    let merged = stored;
    if (body.epoch >= currentEpoch) {
      merged = orMergeBytes(stored, body.checksSeen);
      await this.state.storage.put("checksSeen", merged);
    }
    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen: merged, epoch: currentEpoch });
  }
}
