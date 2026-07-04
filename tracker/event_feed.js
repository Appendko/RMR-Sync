import { getIconInfoForId } from "./icon_map.mjs";

function getRoomFromQuery() {
  return new URLSearchParams(window.location.search).get("room");
}

function toWebSocketUrl(workerUrl, room) {
  const httpUrl = new URL(`/room/${encodeURIComponent(room)}/ws`, workerUrl);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

function renderEntry(event, showText) {
  const entry = document.createElement("div");
  entry.className = "entry";

  const player = document.createElement("span");
  player.className = "player";
  player.textContent = `${event.player}:`;
  entry.appendChild(player);

  for (const itemId of event.items) {
    const info = getIconInfoForId(itemId);
    const img = document.createElement("img");
    img.src = info.file;
    img.alt = info.label;
    img.title = info.label;
    entry.appendChild(img);
    if (showText) {
      const text = document.createElement("span");
      text.className = "item-label";
      text.textContent = info.label;
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
  const allEvents = [];

  function renderAll() {
    log.innerHTML = "";
    for (const event of allEvents) {
      log.appendChild(renderEntry(event, showTextCheckbox.checked));
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

  const ws = new WebSocket(toWebSocketUrl(workerUrl, room));

  ws.addEventListener("open", () => {
    connectionState.textContent = `connected to room ${room}`;
  });

  ws.addEventListener("close", () => {
    connectionState.textContent = "disconnected";
  });

  ws.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "init") {
      connectionState.textContent = `connected to room ${room} (mode: ${data.mode ?? "not created yet"})`;
      allEvents.push(...data.backlog);
      renderAll();
    } else if (data.type === "event") {
      allEvents.push(data.event);
      log.appendChild(renderEntry(data.event, showTextCheckbox.checked));
      log.scrollTop = log.scrollHeight;
    }
  });
}

main();
