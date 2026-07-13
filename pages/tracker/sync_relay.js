const statusEl = document.getElementById("status");
const pickBtn = document.getElementById("pickBtn");
const reconnectBtn = document.getElementById("reconnectBtn");

let dirHandle = null;
let lastSession = null;
let lastSeq = -1;
let pollHandle = null;
let keepAlivePcs = null; // holds the two RTCPeerConnections so they aren't GC'd

const PROGRESS_WORKER_URL_KEY = "rmrSyncRelayWorkerUrl";
const PROGRESS_ROOM_KEY_KEY = "rmrSyncRelayRoomKey";

let progressWs = null;
let progressReconnectDelayMs = 1000;
const PROGRESS_MAX_RECONNECT_DELAY_MS = 15000;
let teamChecks = [];
let mergedItems = new Array(96).fill(0);
let totalDeaths = 0;
let totalIfgUses = 0;

function toProgressWebSocketUrl(workerUrl, room) {
  const httpUrl = new URL(`/room/${encodeURIComponent(room)}/ws`, workerUrl);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

// Implemented for real in a later task (grid rendering) -- a no-op for now
// so this task's WS wiring can be verified independently.
function renderProgressGrid() {
  // placeholder -- see Task 11
}

function applyProgressState(msg) {
  if (msg.teamChecks !== undefined) teamChecks = msg.teamChecks;
  if (msg.mergedItems !== undefined) mergedItems = msg.mergedItems;
  if (msg.totalDeaths !== undefined) totalDeaths = msg.totalDeaths;
  if (msg.totalIfgUses !== undefined) totalIfgUses = msg.totalIfgUses;
  renderProgressGrid();
}

// Connects (or reconnects) to the room's WebSocket purely for team-progress
// display -- entirely independent of the outbox/inbox file relay above (see
// design spec decision 8: nothing from this connection is ever written to
// the inbox file Lua reads).
function connectProgressWs() {
  const workerUrl = getProgressWorkerUrl();
  const roomKey = getProgressRoomKey();
  if (!workerUrl || !roomKey) {
    return;
  }
  if (progressWs) {
    progressWs.close();
  }
  const ws = new WebSocket(toProgressWebSocketUrl(workerUrl, roomKey));
  progressWs = ws;

  ws.addEventListener("open", () => {
    if (progressWs !== ws) return; // superseded before it even opened
    progressReconnectDelayMs = 1000;
  });
  ws.addEventListener("close", () => {
    // A close event on a socket that's no longer the current progressWs means
    // this socket was deliberately superseded by a newer connectProgressWs()
    // call (e.g. the user edited the Worker URL/room key), not a real
    // disconnect -- reconnecting here would fight the new connection and
    // cause a perpetual reconnect-thrash loop.
    if (progressWs !== ws) return;
    setTimeout(connectProgressWs, progressReconnectDelayMs);
    progressReconnectDelayMs = Math.min(progressReconnectDelayMs * 2, PROGRESS_MAX_RECONNECT_DELAY_MS);
  });
  ws.addEventListener("message", (message) => {
    if (progressWs !== ws) return;
    let data;
    try {
      data = JSON.parse(message.data);
    } catch {
      return; // malformed message -- ignore rather than throw
    }
    if (data.type === "init" || data.type === "progress") {
      applyProgressState(data);
    }
  });
}

function getProgressWorkerUrl() {
  return document.getElementById("progressWorkerUrl").value.trim();
}
function getProgressRoomKey() {
  return document.getElementById("progressRoomKey").value.trim();
}

function persistProgressSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not fatal -- this session just won't be remembered next time
  }
}

function restoreProgressSettings() {
  try {
    const workerUrl = localStorage.getItem(PROGRESS_WORKER_URL_KEY);
    const roomKey = localStorage.getItem(PROGRESS_ROOM_KEY_KEY);
    if (workerUrl) document.getElementById("progressWorkerUrl").value = workerUrl;
    if (roomKey) document.getElementById("progressRoomKey").value = roomKey;
  } catch {
    // localStorage unavailable -- just start blank
  }
}

// Auto-fills the two progress fields from a successfully-read outbox
// request, but only if empty -- so connecting a game folder doesn't
// overwrite a room key the user deliberately typed in to spectate a
// different room (see design spec decision 7).
function maybeAutoFillProgressFields(req) {
  const workerUrlInput = document.getElementById("progressWorkerUrl");
  const roomKeyInput = document.getElementById("progressRoomKey");
  let changed = false;
  if (!workerUrlInput.value.trim() && req.workerUrl) {
    workerUrlInput.value = req.workerUrl;
    persistProgressSetting(PROGRESS_WORKER_URL_KEY, req.workerUrl);
    changed = true;
  }
  if (!roomKeyInput.value.trim() && req.roomKey) {
    roomKeyInput.value = req.roomKey;
    persistProgressSetting(PROGRESS_ROOM_KEY_KEY, req.roomKey);
    changed = true;
  }
  if (changed) {
    connectProgressWs();
  }
  return changed;
}

function log(text) {
  statusEl.textContent = text;
}

// --- minimal IndexedDB key-value store for persisting the directory handle ---
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("rmrsync_relay", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: "rmrsync", mode: "readwrite" });
  await idbSet("dirHandle", handle);
  return handle;
}

async function restoreFolder() {
  const handle = await idbGet("dirHandle");
  if (!handle) return null;
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return handle;
  return "needs-permission";
}

async function writeInbox(dir, obj) {
  const fh = await dir.getFileHandle("rmrsync_in.json", { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(obj));
  await w.close();
}

async function tick() {
  let req;
  try {
    const fh = await dirHandle.getFileHandle("rmrsync_out.json");
    req = JSON.parse(await (await fh.getFile()).text());
  } catch {
    return; // no outbox yet, or a torn read -- try again next tick
  }

  maybeAutoFillProgressFields(req);

  if (req.session !== lastSession) {
    lastSession = req.session;
    lastSeq = -1;
  }
  if (typeof req.seq !== "number" || req.seq <= lastSeq) {
    return; // already handled, or malformed
  }

  const base = String(req.workerUrl || "").replace(/\/$/, "");
  const room = `${base}/room/${encodeURIComponent(req.roomKey)}`;
  const resp = { session: req.session, seq: req.seq, ok: false, sync: null, eventsPosted: 0, error: null };

  try {
    const syncResp = await fetch(`${room}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.sync),
    });
    const syncData = await syncResp.json();
    if (!syncResp.ok) {
      resp.error = syncData.error || `HTTP ${syncResp.status}`;
    } else {
      resp.sync = syncData;
      resp.ok = true;
      for (const ev of req.events || []) {
        // Every field ev might carry is enumerated explicitly here --
        // JSON.stringify drops undefined keys, so this is correct whether
        // ev carries any subset of these. This exact spot has already
        // silently dropped a real field twice (checks, then
        // gameClearTime) because a new Lua-side field was added without
        // updating this list -- if you're adding a new field to the event
        // shape in lua/share_info.lua, it MUST be added here too.
        const evResp = await fetch(`${room}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            player: req.player,
            game: ev.game,
            items: ev.items,
            checks: ev.checks,
            gameClearTime: ev.gameClearTime,
            deathDelta: ev.deathDelta,
            ifgDelta: ev.ifgDelta,
          }),
        });
        if (evResp.ok) resp.eventsPosted++;
      }
    }
  } catch (e) {
    resp.error = String(e);
  }

  await writeInbox(dirHandle, resp);
  lastSeq = req.seq;
  log(`Connected. Last handled request: seq ${req.seq}${resp.error ? " (error: " + resp.error + ")" : ""}`);
}

// Keep this tab exempt from Chrome's *intensive* background-tab timer
// throttling (which otherwise drops our poll from 400ms to once-per-minute
// when the window is hidden or fully covered by BizHawk). A tab holding a
// live WebRTC connection is exempt from that tier; the once-per-second base
// clamp still applies, which is fine for a file relay. This is a purely
// local loopback -- two peer connections in this same page wired to each
// other -- so there's no server, no STUN/TURN, and no network traffic.
async function startKeepAlive() {
  if (keepAlivePcs || typeof RTCPeerConnection === "undefined") return;
  try {
    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();
    keepAlivePcs = [pc1, pc2];
    pc1.onicecandidate = (e) => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
    pc2.onicecandidate = (e) => { if (e.candidate) pc1.addIceCandidate(e.candidate); };
    pc1.createDataChannel("keepalive");
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);
  } catch (e) {
    // Non-fatal: relay still works, just subject to throttling as before.
    // (Keeping the window visible remains the fallback -- see README.)
    keepAlivePcs = null;
    console.warn("keep-alive setup failed; relay may throttle when hidden:", e);
  }
}

function startPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(() => { tick().catch((e) => log("Relay error: " + e)); }, 400);
  startKeepAlive();
  log("Connected. Watching for sync requests...");
}

pickBtn.addEventListener("click", async () => {
  try {
    dirHandle = await pickFolder();
    reconnectBtn.style.display = "none";
    startPolling();
  } catch (e) {
    log("Folder selection cancelled or failed: " + e);
  }
});

reconnectBtn.addEventListener("click", async () => {
  const handle = await idbGet("dirHandle");
  if (!handle) { log("No previously connected folder found."); return; }
  const granted = await handle.requestPermission({ mode: "readwrite" });
  if (granted === "granted") {
    dirHandle = handle;
    reconnectBtn.style.display = "none";
    startPolling();
  } else {
    log("Permission not granted.");
  }
});

document.getElementById("progressWorkerUrl").addEventListener("input", (e) => persistProgressSetting(PROGRESS_WORKER_URL_KEY, e.target.value.trim()));
document.getElementById("progressRoomKey").addEventListener("input", (e) => persistProgressSetting(PROGRESS_ROOM_KEY_KEY, e.target.value.trim()));
document.getElementById("progressWorkerUrl").addEventListener("change", connectProgressWs);
document.getElementById("progressRoomKey").addEventListener("change", connectProgressWs);
restoreProgressSettings();
connectProgressWs();

(async () => {
  const restored = await restoreFolder();
  if (restored === "needs-permission") {
    log("Previously connected folder needs permission again.");
    reconnectBtn.style.display = "inline-block";
  } else if (restored) {
    dirHandle = restored;
    startPolling();
  } else {
    log("Not connected. Click \"Choose game folder\" to select the folder containing boot.lua.");
  }
})();
