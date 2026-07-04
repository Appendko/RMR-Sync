import { RoomDO } from "./room.js";
import { withCors, handleOptions } from "./cors.js";

export { RoomDO };

const ROOM_PATH_PATTERN = /^\/room\/([^/]+)(\/.*)$/;

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    const url = new URL(request.url);
    const match = url.pathname.match(ROOM_PATH_PATTERN);
    if (!match) {
      return withCors(jsonResponse({ error: "not found" }, 404));
    }

    const [, roomKey, subPath] = match;
    const id = env.ROOM.idFromName(roomKey);
    const stub = env.ROOM.get(id);

    const forwardedUrl = new URL(subPath, "https://do").toString();
    const isBodyless = request.method === "GET" || request.method === "HEAD";
    const response = await stub.fetch(forwardedUrl, {
      method: request.method,
      headers: request.headers,
      body: isBodyless ? undefined : request.body,
    });

    if (subPath === "/ws") {
      return response;
    }
    return withCors(response);
  },
};
