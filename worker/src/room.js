import { orMergeBytes, countSetBits, setBit } from "./bits.js";
import { isValidMode, isValidAdminSecret, isValidChecksSeenArray, isValidItemsArray, isValidEpoch, isValidShareFlags, validateEventBody } from "./validation.js";
import { shareCategoryForId } from "./shareCategories.js";

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

// Cross-PLAYER, same-byte-position OR-merge of one client's full 96-byte
// items snapshot into the room's stored mergedItems. This NEVER projects a
// bit from one title's byte range into another title's byte range (unlike
// the old, deleted itemMergeSiblings sibling-projection) -- it's a straight
// per-title, per-byte-position merge across players, so there is no more
// "same slot number != same item across titles" risk for any item, in any
// mode.
function mergeIncomingItems(stored, incoming, mode, shareFlags) {
  if (mode === "checksSeen+items") {
    // No category filter at all -- the entire array OR-merges unconditionally.
    return orMergeBytes(stored, incoming);
  }
  if (mode !== "checksSeen+shared") {
    // Plain "checksSeen" mode: items sharing isn't enabled for this room --
    // the field is still validated above (so a malformed client is still
    // caught), it's just never folded into mergedItems.
    return stored;
  }
  // "checksSeen+shared": only fold in bits whose id belongs to one of the 7
  // whitelisted categories AND that category is enabled in this room's
  // shareFlags. This must be bit-granular, not byte-granular: subTank's
  // range (0x24-0x27) does not start on a byte boundary, so the byte that
  // holds subTank ids 36-39 also holds the unrelated, unwhitelisted ids
  // 32-35 -- merging the whole byte would incorrectly pull those in too.
  const merged = stored.slice();
  for (let id = 0; id < ITEMS_LENGTH * 8; id++) {
    const byteIndex = Math.floor(id / 8);
    const mask = 1 << (id % 8);
    if ((incoming[byteIndex] & mask) === 0) continue; // not set in this client's snapshot
    const category = shareCategoryForId(id);
    if (!category || !shareFlags[category]) continue; // not whitelisted, or not enabled
    if ((merged[byteIndex] & mask) === 0) {
      setBit(merged, id);
    }
  }
  return merged;
}

export class RoomDO {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
    this.recentlyPosted = new Map(); // "player::kind::id" -> last-posted timestamp (ms)
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
    this.recentlyPosted.clear();
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
    await this.state.storage.put("teamChecks", []);
    await this.state.storage.put("totalDeaths", 0);
    await this.state.storage.put("totalIfgUses", 0);
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
    await this.scheduleExpiry();
    return jsonResponse({ mode: body.mode, created: true });
  }

  async handleStatus() {
    const mode = (await this.state.storage.get("mode")) ?? null;
    const checksSeen = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const mergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);
    const events = (await this.state.storage.get("events")) ?? [];
    return jsonResponse({
      mode,
      checksSeenBitsSet: countSetBits(checksSeen),
      mergedItemsBitsSet: countSetBits(mergedItems),
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
    await this.state.storage.put("teamChecks", []);
    await this.state.storage.put("totalDeaths", 0);
    await this.state.storage.put("totalIfgUses", 0);
    await this.state.storage.put("events", []);
    await this.state.storage.put("shareFlags", {});
    await this.scheduleExpiry();
    this.recentlyPosted.clear();
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
    this.recentlyPosted.clear();
    return jsonResponse({ deleted: true });
  }

  async handleSync(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !isValidChecksSeenArray(body.checksSeen) ||
      !isValidItemsArray(body.items) ||
      !isValidEpoch(body.epoch) ||
      !isValidShareFlags(body.shareFlags)
    ) {
      return jsonResponse({ error: "invalid checksSeen, items, epoch, or shareFlags" }, 400);
    }
    const currentEpoch = (await this.state.storage.get("resetEpoch")) ?? 0;
    const storedChecksSeen = (await this.state.storage.get("checksSeen")) ?? new Array(CHECKS_SEEN_LENGTH).fill(0);
    const storedMergedItems = (await this.state.storage.get("mergedItems")) ?? new Array(ITEMS_LENGTH).fill(0);

    // Static per-seed data (read once from ROM by lua/share_info.lua, not derived
    // from player progress) -- just store whatever's sent, no merge logic needed.
    if (body.shareFlags !== undefined) {
      await this.state.storage.put("shareFlags", body.shareFlags);
    }
    const shareFlags = (await this.state.storage.get("shareFlags")) ?? {};

    let checksSeen = storedChecksSeen;
    let mergedItems = storedMergedItems;
    // A client reporting a stale (pre-reset) epoch has its contribution to
    // BOTH arrays discarded -- same protection checksSeen/items already had.
    if (body.epoch >= currentEpoch) {
      checksSeen = orMergeBytes(storedChecksSeen, body.checksSeen);
      await this.state.storage.put("checksSeen", checksSeen);
      mergedItems = mergeIncomingItems(storedMergedItems, body.items, mode, shareFlags);
      await this.state.storage.put("mergedItems", mergedItems);
    }

    await this.scheduleExpiry();
    return jsonResponse({ mode, checksSeen, epoch: currentEpoch, shareFlags, mergedItems });
  }

  async handleEvent(request) {
    const mode = await this.state.storage.get("mode");
    if (!mode) {
      return jsonResponse({ error: "room not initialized" }, 409);
    }
    const body = await request.json().catch(() => null);
    const validationError = validateEventBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    // Item-pickup events are only meaningful in a room that's actually
    // sharing items -- reported the same way mergeIncomingItems silently
    // no-ops items in plain "checksSeen" mode. Check-completion events
    // (stage clear / boss defeat) are announcements about a player's own
    // local progress, unrelated to which item categories this room shares,
    // so they're allowed in all 3 modes.
    if (body.items !== undefined && mode !== "checksSeen+shared" && mode !== "checksSeen+items") {
      return jsonResponse({ error: "items sharing not enabled for this room" }, 403);
    }
    const now = Date.now();
    // Prune stale entries so this map doesn't grow unbounded over a long session.
    for (const [key, postedAt] of this.recentlyPosted) {
      if (now - postedAt > DUPLICATE_EVENT_WINDOW_MS) {
        this.recentlyPosted.delete(key);
      }
    }

    // Namespaced by kind ("item"/"check") since item ids and check ids share
    // the same 0-767 numeric space -- without this, an item id and an
    // unrelated check id with the same number would collide and incorrectly
    // dedupe against each other.
    const dedupeNew = (ids, kind) =>
      (ids ?? []).filter((id) => {
        const key = `${body.player}::${kind}::${id}`;
        const lastPosted = this.recentlyPosted.get(key);
        if (lastPosted !== undefined && now - lastPosted <= DUPLICATE_EVENT_WINDOW_MS) {
          return false; // recent duplicate, skip it
        }
        this.recentlyPosted.set(key, now);
        return true;
      });

    const newItems = dedupeNew(body.items, "item");
    const newChecks = dedupeNew(body.checks, "check");

    if (newItems.length === 0 && newChecks.length === 0) {
      // Everything in this request was a recent duplicate -- nothing new to log.
      return jsonResponse({ ok: true });
    }

    const events = (await this.state.storage.get("events")) ?? [];
    const event = { player: body.player, game: body.game, ts: now };
    if (newItems.length > 0) {
      event.items = newItems;
    }
    if (newChecks.length > 0) {
      event.checks = newChecks;
      // Companion display data for the synthetic "all 3 titles cleared" id
      // (903) -- see validation.js's isValidGameClearTime. Only attached
      // alongside a genuinely-new checks entry, never on its own.
      if (body.gameClearTime !== undefined) {
        event.gameClearTime = body.gameClearTime;
      }
    }
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
