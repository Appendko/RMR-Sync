import { orMergeBytes, countSetBits, setBit } from "./bits.js";
import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidEpoch, isValidShareFlags, validateEventBody } from "./validation.js";
import { shareCategoryForId, itemMergeSiblings } from "./shareCategories.js";

const CHECKS_SEEN_LENGTH = 96;
const ITEMS_LENGTH = 96;
const MAX_EVENTS = 200;
const EXPIRY_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_EVENT_WINDOW_MS = 15000;

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
    this.recentlyPostedItems = new Map(); // "player::itemId" -> last-posted timestamp (ms)
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
    if (path === "/admin/delete" && request.method === "POST") {
      return this.handleDelete(request);
    }
    if (path === "/sync" && request.method === "POST") {
      return this.handleSync(request);
    }
    if (path === "/event" && request.method === "POST") {
      return this.handleEvent(request);
    }
    if (path === "/ws") {
      return this.handleWebSocket(request);
    }
    return jsonResponse({ error: "not found" }, 404);
  }

  async scheduleExpiry() {
    await this.state.storage.setAlarm(Date.now() + EXPIRY_MS);
  }

  async alarm() {
    await this.state.storage.deleteAll();
    this.sockets.clear();
    this.recentlyPostedItems.clear();
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
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
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
    if (body.mode !== undefined && !isValidMode(body.mode)) {
      return jsonResponse({ error: "invalid mode" }, 400);
    }
    const newMode = body.mode !== undefined ? body.mode : mode;
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    await this.state.storage.put("resetEpoch", currentEpoch + 1);
    await this.state.storage.put("mode", newMode);
    await this.state.storage.put("checksSeen", new Array(CHECKS_SEEN_LENGTH).fill(0));
    await this.state.storage.put("mergedItems", new Array(ITEMS_LENGTH).fill(0));
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
    await this.scheduleExpiry();
    this.recentlyPostedItems.clear();
    return jsonResponse({ ok: true, mode: newMode });
  }

  async handleDelete(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    const storedSecret = await this.state.storage.get("adminSecret");
    if (!body || body.adminSecret !== storedSecret) {
      return jsonResponse({ error: "invalid admin secret" }, 403);
    }
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    this.sockets.clear();
    this.recentlyPostedItems.clear();
    return jsonResponse({ deleted: true });
  }

  async handleSync(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    if (!body || !isValidChecksSeenArray(body.checksSeen) || !isValidEpoch(body.epoch) || !isValidShareFlags(body.shareFlags)) {
      return jsonResponse({ error: "invalid checksSeen, epoch, or shareFlags" }, 400);
    }
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    const stored = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);

    let merged = stored;
    if (body.epoch >= currentEpoch) {
      merged = orMergeBytes(stored, body.checksSeen);
      await this.state.storage.put("checksSeen", merged);
    }
    // Static per-seed data (read once from ROM by lua/share_info.lua, not derived
    // from player progress) -- just store whatever's sent, no merge logic needed.
    if (body.shareFlags !== undefined) {
      await this.state.storage.put("shareFlags", body.shareFlags);
    }
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
    const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen: merged, epoch: currentEpoch, shareFlags, mergedItems });
  }

  async handleEvent(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    if (mode !== "checksSeen+item") {
      return jsonResponse({ error: "items sharing not enabled for this room" }, 403);
    }
    const body = await request.json().catch(() => null);
    const validationError = validateEventBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    const now = Date.now();
    // Prune stale entries so this map doesn't grow unbounded over a long session.
    for (const [key, postedAt] of this.recentlyPostedItems) {
      if (now - postedAt > DUPLICATE_EVENT_WINDOW_MS) {
        this.recentlyPostedItems.delete(key);
      }
    }

    const newItems = body.items.filter((itemId) => {
      const key = `${body.player}::${itemId}`;
      const lastPosted = this.recentlyPostedItems.get(key);
      if (lastPosted !== undefined && now - lastPosted <= DUPLICATE_EVENT_WINDOW_MS) {
        return false; // recent duplicate, skip it
      }
      this.recentlyPostedItems.set(key, now);
      return true;
    });

    if (newItems.length === 0) {
      // Every item in this request was a recent duplicate -- nothing new to log.
      return jsonResponse({ ok: true });
    }

    // Real cross-player item merging (checksSeen+item mode only): for each
    // newly-accepted item whose category is enabled in this seed's
    // shareFlags, OR its bit into all 3 titles' sibling ids so every
    // player's next /sync grants it in their own game too.
    if (mode === "checksSeen+item") {
      const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
      const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
      let mergedChanged = false;
      for (const itemId of newItems) {
        const category = shareCategoryForId(itemId);
        if (!category || !shareFlags[category]) continue;
        for (const siblingId of itemMergeSiblings(itemId)) {
          const byteIndex = Math.floor(siblingId / 8);
          const mask = 1 << (siblingId % 8);
          if ((mergedItems[byteIndex] & mask) === 0) {
            setBit(mergedItems, siblingId);
            mergedChanged = true;
          }
        }
      }
      if (mergedChanged) {
        await this.state.storage.put("mergedItems", mergedItems);
      }
    }

    const events = (await this.state.storage.get("events")) ?? [];
    const event = { player: body.player, game: body.game, items: newItems, ts: now };
    events.push(event);
    const trimmed = events.slice(-MAX_EVENTS);
    await this.state.storage.put("events", trimmed);
    await this.scheduleExpiry();
    this.broadcast({ type: "event", event });
    return jsonResponse({ ok: true });
  }

  async handleWebSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return jsonResponse({ error: "expected websocket upgrade" }, 426);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    const mode = (await this.state.storage.get("mode")) ?? null;
    const backlog = (await this.state.storage.get("events")) ?? [];
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};
    server.send(JSON.stringify({ type: "init", mode, backlog, shareFlags }));

    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      try {
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
