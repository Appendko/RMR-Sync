const statusEl = document.getElementById("status");
const pickBtn = document.getElementById("pickBtn");
const reconnectBtn = document.getElementById("reconnectBtn");

let dirHandle = null;
let lastSession = null;
let lastSeq = -1;
let pollHandle = null;

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
        const evResp = await fetch(`${room}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player: req.player, game: ev.game, items: ev.items }),
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

function startPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(() => { tick().catch((e) => log("Relay error: " + e)); }, 1500);
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
