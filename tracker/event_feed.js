function getRoomFromQuery() {
  return new URLSearchParams(window.location.search).get("room");
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
  const connectionState = document.getElementById("connectionState");
  const log = document.getElementById("log");
  const showTextCheckbox = document.getElementById("showText");
  let allEvents = [];

  function renderAll() {
    log.innerHTML = "";
    for (const event of allEvents) {
      const el = renderEntry(event, showTextCheckbox.checked);
      if (el) {
        log.appendChild(el);
      }
    }
  }

  showTextCheckbox.addEventListener("input", renderAll);

  if (!room) {
    connectionState.textContent = "no ?room=<key> in URL";
    return;
  }

  // eslint-disable-next-line no-alert
  const workerUrl = window.prompt("Worker URL (e.g. https://rmr-sync.yourname.workers.dev)");
  if (!workerUrl) {
    connectionState.textContent = "no Worker URL provided";
    return;
  }

  let reconnectDelayMs = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;

  function connect() {
    const ws = new WebSocket(toWebSocketUrl(workerUrl, room));

    ws.addEventListener("open", () => {
      connectionState.textContent = `connected to room ${room}`;
      reconnectDelayMs = 1000;
    });

    ws.addEventListener("close", () => {
      const retryInSeconds = Math.round(reconnectDelayMs / 1000);
      connectionState.textContent = `disconnected -- reconnecting in ${retryInSeconds}s...`;
      setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    });

    ws.addEventListener("message", (message) => {
      const data = JSON.parse(message.data);
      if (data.type === "init") {
        connectionState.textContent = `connected to room ${room} (mode: ${data.mode ?? "not created yet"})`;
        allEvents = data.backlog.slice();
        renderAll();
      } else if (data.type === "event") {
        allEvents.push(data.event);
        const el = renderEntry(data.event, showTextCheckbox.checked);
        if (el) {
          log.appendChild(el);
          log.scrollTop = log.scrollHeight;
        }
      }
    });
  }

  connect();
}

main();
