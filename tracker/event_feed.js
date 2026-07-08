function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

const ROOM_STORAGE_KEY = "rmrSyncRoom";
const WORKER_URL_STORAGE_KEY = "rmrSyncWorkerUrl";
const MAX_LINES_STORAGE_KEY = "rmrSyncMaxLines";
const SHOW_TEXT_STORAGE_KEY = "rmrSyncShowText";
const LANG_STORAGE_KEY = "rmrSyncLang";

// Resolves a setting that can come from either a URL query param or the
// settings panel (saved to localStorage). localStorage wins whenever it has
// *any* value (including an explicitly-cleared empty string) -- the query
// param only seeds localStorage the first time nothing is saved yet. This
// makes the settings panel actually useful for values baked into an OBS
// Browser Source's configured URL (like room): once you Apply a change in
// the panel, it keeps sticking even though OBS keeps reloading that same
// original URL with its old query params.
function resolveStoredOrQuery(storageKey, queryName) {
  let stored = null;
  try {
    stored = window.localStorage.getItem(storageKey);
  } catch {
    // localStorage may be unavailable (e.g. private browsing) -- fall
    // through to the query param for this page load.
  }
  if (stored !== null) {
    return stored;
  }
  const fromQuery = getQueryParam(queryName);
  if (fromQuery !== null) {
    try {
      window.localStorage.setItem(storageKey, fromQuery);
    } catch {
      // not fatal -- the query param itself still applies for this load
    }
    return fromQuery;
  }
  return null;
}

function resolveRoom() {
  return resolveStoredOrQuery(ROOM_STORAGE_KEY, "room");
}

// Resolves the Worker URL without necessarily needing an interactive prompt --
// important for OBS Browser Source, where window.prompt() doesn't reliably
// work (use the settings panel instead) and for normal browser tabs, where
// re-prompting on every reload (e.g. mid-stream) would be disruptive.
function resolveWorkerUrl() {
  const resolved = resolveStoredOrQuery(WORKER_URL_STORAGE_KEY, "workerUrl");
  if (resolved) {
    return resolved;
  }

  // eslint-disable-next-line no-alert
  const prompted = window.prompt("Worker URL (e.g. https://rmr-sync.yourname.workers.dev)");
  if (prompted) {
    try {
      window.localStorage.setItem(WORKER_URL_STORAGE_KEY, prompted);
    } catch {
      // ignore
    }
  }
  return prompted;
}

// Optional ?maxLines=N query param (or settings-panel equivalent) for
// OBS-style compact display: keep only the most recent N rendered entries
// on screen (older ones are dropped from the DOM entirely, not scrolled) so
// the log never grows taller than a fixed number of lines and no scrollbar
// is ever needed. Unset/blank keeps the unlimited default.
function getMaxLines() {
  const raw = resolveStoredOrQuery(MAX_LINES_STORAGE_KEY, "maxLines");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Optional ?showText=1 query param (or settings-panel equivalent) for
// whether item names render next to their icons.
function getShowTextDefault() {
  const raw = resolveStoredOrQuery(SHOW_TEXT_STORAGE_KEY, "showText");
  return raw === "1" || raw === "true";
}

// Best-effort mapping from the browser's language preference to one of our
// supported item-name languages. Only maps to zh-TW for Traditional-Chinese-
// flavored tags (zh-TW/zh-Hant/zh-HK/zh-MO) -- plain "zh" or "zh-CN" is
// ambiguous/likely Simplified, which we have no data for, so it falls through
// instead of guessing wrong.
function detectBrowserLang() {
  const candidates = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
  for (const raw of candidates) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (lower.startsWith("ja")) return "ja";
    if (lower.startsWith("zh-tw") || lower.startsWith("zh-hant") || lower.startsWith("zh-hk") || lower.startsWith("zh-mo")) return "zh-TW";
    if (lower.startsWith("en")) return "en";
  }
  return null;
}

// Resolves the item-name language: explicit ?lang= / settings-panel choice first
// (see resolveStoredOrQuery), then auto-detected from the browser, then English.
function resolveLanguage() {
  const stored = resolveStoredOrQuery(LANG_STORAGE_KEY, "lang");
  if (stored && SUPPORTED_LANGS.includes(stored)) {
    return stored;
  }
  return detectBrowserLang() || DEFAULT_LANG;
}

// Hidden top-left settings panel (revealed on hover) so a streamer can
// change room/workerUrl/maxLines/showText from inside an OBS Browser
// Source via "Interact" -- without editing the source's configured URL,
// which is awkward mid-stream and doesn't support window.prompt() anyway.
// Applying always reloads the page (see resolveStoredOrQuery above for why
// a saved value keeps sticking across reloads).
function setupSettingsPanel() {
  const roomInput = document.getElementById("settingsRoom");
  const workerUrlInput = document.getElementById("settingsWorkerUrl");
  const maxLinesInput = document.getElementById("settingsMaxLines");
  const showTextInput = document.getElementById("settingsShowText");
  const langInput = document.getElementById("settingsLang");
  const applyButton = document.getElementById("settingsApply");

  roomInput.value = resolveStoredOrQuery(ROOM_STORAGE_KEY, "room") ?? "";
  workerUrlInput.value = resolveStoredOrQuery(WORKER_URL_STORAGE_KEY, "workerUrl") ?? "";
  maxLinesInput.value = resolveStoredOrQuery(MAX_LINES_STORAGE_KEY, "maxLines") ?? "";
  const storedShowText = resolveStoredOrQuery(SHOW_TEXT_STORAGE_KEY, "showText");
  showTextInput.checked = storedShowText === "1" || storedShowText === "true";
  // Prefill with the fully-resolved language (falling through to auto-detect)
  // rather than only the raw stored/query value, so the dropdown always shows
  // what's actually in effect right now, not blank when nothing's been chosen yet.
  langInput.value = resolveLanguage();

  applyButton.addEventListener("click", () => {
    const setStored = (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // localStorage unavailable -- Apply can't persist anything this session
      }
    };
    setStored(ROOM_STORAGE_KEY, roomInput.value.trim());
    setStored(WORKER_URL_STORAGE_KEY, workerUrlInput.value.trim());
    setStored(MAX_LINES_STORAGE_KEY, maxLinesInput.value.trim());
    setStored(SHOW_TEXT_STORAGE_KEY, showTextInput.checked ? "1" : "0");
    setStored(LANG_STORAGE_KEY, langInput.value);
    window.location.reload();
  });
}

function toWebSocketUrl(workerUrl, room) {
  const httpUrl = new URL(`/room/${encodeURIComponent(room)}/ws`, workerUrl);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

function renderEntry(event, showText, lang, shareFlags) {
  // Some newly-set bits in the game's item-memory region don't correspond to a
  // real, named item (e.g. check/progress-tracking bits that happen to live in
  // the same memory range) -- ITEM_ID_MAP has no entry for those ids. Treat
  // them as "not really an item": don't show an icon/label for them, and don't
  // render an entry line at all if every item in this event turns out to be one
  // of these unnamed bits.
  const realItems = event.items.filter((itemId) => ITEM_ID_MAP[itemId] !== undefined);
  if (realItems.length === 0) {
    return null;
  }

  const entry = document.createElement("div");
  entry.className = "entry";

  const player = document.createElement("span");
  player.className = "player";
  player.textContent = `${event.player}:`;
  entry.appendChild(player);

  for (const itemId of realItems) {
    const spritePos = getSpritePositionForId(itemId);
    const name = getItemNameForId(itemId, lang, shareFlags);
    if (spritePos) {
      const icon = document.createElement("div");
      icon.className = "icon-sprite";
      icon.style.backgroundPosition = `-${spritePos.sx * 1.5}px -${spritePos.sy * 1.5}px`;
      icon.title = name;
      entry.appendChild(icon);
    } else {
      // Rare fallback: no sprite slot for this id (see getSpritePositionForId in
      // icon_map.js). Render the old hand-curated icon so nothing renders blank.
      const info = getIconInfoForId(itemId);
      const img = document.createElement("img");
      img.src = info.file;
      img.alt = name;
      img.title = name;
      entry.appendChild(img);
    }
    if (showText) {
      const text = document.createElement("span");
      text.className = "item-label";
      text.textContent = name;
      entry.appendChild(text);
    }
  }

  return entry;
}

function main() {
  const log = document.getElementById("log");
  const showText = getShowTextDefault();
  const lang = resolveLanguage();
  const maxLines = getMaxLines();
  let allEvents = [];
  // Which item categories this seed's own settings configured as shared across
  // all 3 games (see gameTagFor in icon_map.js) -- learned from the room's "init"
  // WS message (see lua/share_info.lua's readShareFlags / worker/src/room.js).
  // Empty until that first message arrives, meaning every item just shows its
  // own game's tag until then.
  let shareFlags = {};

  // Appends an already-built element to the log, trimming the oldest entry
  // off the front whenever maxLines is set and exceeded -- used for both
  // real item entries and status messages, so status lines are just another
  // entry in the same capped stream and naturally get pushed out by newer
  // ones (item pickups or later status updates) rather than staying pinned
  // as a permanent header.
  function appendToLog(el) {
    log.appendChild(el);
    if (maxLines) {
      while (log.children.length > maxLines) {
        log.firstElementChild.remove();
      }
    }
    log.scrollTop = log.scrollHeight;
  }

  function appendStatusLine(text) {
    const el = document.createElement("div");
    el.className = "entry status-line";
    el.textContent = text;
    appendToLog(el);
  }

  function renderAll() {
    log.innerHTML = "";
    const rendered = [];
    for (const event of allEvents) {
      const el = renderEntry(event, showText, lang, shareFlags);
      if (el) {
        rendered.push(el);
      }
    }
    const toShow = maxLines ? rendered.slice(-maxLines) : rendered;
    for (const el of toShow) {
      log.appendChild(el);
    }
  }

  setupSettingsPanel();

  const room = resolveRoom();
  if (!room) {
    appendStatusLine("no room set -- use the settings panel (top-left corner) or add ?room=<key> to the URL");
    return;
  }

  const workerUrl = resolveWorkerUrl();
  if (!workerUrl) {
    appendStatusLine("no Worker URL set -- use the settings panel (top-left corner) or add ?workerUrl=<url> to the URL");
    return;
  }

  let reconnectDelayMs = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;

  function connect() {
    const ws = new WebSocket(toWebSocketUrl(workerUrl, room));

    ws.addEventListener("open", () => {
      reconnectDelayMs = 1000;
    });

    ws.addEventListener("close", () => {
      const retryInSeconds = Math.round(reconnectDelayMs / 1000);
      appendStatusLine(`disconnected -- reconnecting in ${retryInSeconds}s...`);
      setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    });

    ws.addEventListener("message", (message) => {
      const data = JSON.parse(message.data);
      if (data.type === "init") {
        allEvents = data.backlog.slice();
        shareFlags = data.shareFlags || {};
        renderAll();
        appendStatusLine(`connected to room ${room} (mode: ${data.mode ?? "not created yet"})`);
      } else if (data.type === "event") {
        allEvents.push(data.event);
        const el = renderEntry(data.event, showText, lang, shareFlags);
        if (el) {
          appendToLog(el);
        }
      }
    });
  }

  connect();
}

main();
