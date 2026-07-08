function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getRoomFromQuery() {
  return getQueryParam("room");
}

const WORKER_URL_STORAGE_KEY = "rmrSyncWorkerUrl";

// Resolves the Worker URL without necessarily needing an interactive prompt --
// important for OBS Browser Source, where a static configured URL is the only
// practical option (OBS's embedded Chromium does not reliably support
// window.prompt()) and for normal browser tabs, where re-prompting on every
// reload (e.g. mid-stream) would be disruptive. Priority: explicit ?workerUrl=
// query param (best for OBS -- bake it into the one-time Browser Source URL),
// then a previously-saved value in localStorage, then finally an interactive
// prompt as a last resort (saving whatever's entered for next time).
function resolveWorkerUrl() {
  const fromQuery = getQueryParam("workerUrl");
  if (fromQuery) {
    try {
      window.localStorage.setItem(WORKER_URL_STORAGE_KEY, fromQuery);
    } catch {
      // localStorage may be unavailable (e.g. private browsing) -- not fatal,
      // the query param itself is still used for this page load.
    }
    return fromQuery;
  }

  let stored = null;
  try {
    stored = window.localStorage.getItem(WORKER_URL_STORAGE_KEY);
  } catch {
    // ignore -- fall through to prompting
  }
  if (stored) {
    return stored;
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

// Optional ?maxLines=N query param for OBS-style compact display: keep only
// the most recent N rendered entries on screen (older ones are dropped from
// the DOM entirely, not scrolled) so the log never grows taller than a fixed
// number of lines and no scrollbar is ever needed. Unset (the default) keeps
// today's unlimited behavior unchanged.
function getMaxLines() {
  const raw = getQueryParam("maxLines");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Optional ?showText=1 query param to set the "Show item names" checkbox's
// initial state -- an OBS Browser Source can't click a checkbox, so this
// lets that default be baked into the configured URL. The checkbox remains
// clickable afterward for normal browser-tab viewers.
function getShowTextDefault() {
  const raw = getQueryParam("showText");
  return raw === "1" || raw === "true";
}

function toWebSocketUrl(workerUrl, room) {
  const httpUrl = new URL(`/room/${encodeURIComponent(room)}/ws`, workerUrl);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

function renderEntry(event, showText) {
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
    const label = getIconInfoForId(itemId).label;
    if (spritePos) {
      const icon = document.createElement("div");
      icon.className = "icon-sprite";
      icon.style.backgroundPosition = `-${spritePos.sx * 1.5}px -${spritePos.sy * 1.5}px`;
      icon.title = label;
      entry.appendChild(icon);
    } else {
      // Rare fallback: no sprite slot for this id (see getSpritePositionForId in
      // icon_map.js). Render the old hand-curated icon so nothing renders blank.
      const info = getIconInfoForId(itemId);
      const img = document.createElement("img");
      img.src = info.file;
      img.alt = info.label;
      img.title = info.label;
      entry.appendChild(img);
    }
    if (showText) {
      const text = document.createElement("span");
      text.className = "item-label";
      text.textContent = label;
      entry.appendChild(text);
    }
  }

  return entry;
}

function main() {
  const room = getRoomFromQuery();
  const log = document.getElementById("log");
  const showTextCheckbox = document.getElementById("showText");
  showTextCheckbox.checked = getShowTextDefault();
  const maxLines = getMaxLines();
  let allEvents = [];

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
      const el = renderEntry(event, showTextCheckbox.checked);
      if (el) {
        rendered.push(el);
      }
    }
    const toShow = maxLines ? rendered.slice(-maxLines) : rendered;
    for (const el of toShow) {
      log.appendChild(el);
    }
  }

  showTextCheckbox.addEventListener("input", renderAll);

  if (!room) {
    appendStatusLine("no ?room=<key> in URL");
    return;
  }

  const workerUrl = resolveWorkerUrl();
  if (!workerUrl) {
    appendStatusLine("no Worker URL provided");
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
        renderAll();
        appendStatusLine(`connected to room ${room} (mode: ${data.mode ?? "not created yet"})`);
      } else if (data.type === "event") {
        allEvents.push(data.event);
        const el = renderEntry(data.event, showTextCheckbox.checked);
        if (el) {
          appendToLog(el);
        }
      }
    });
  }

  connect();
}

main();
