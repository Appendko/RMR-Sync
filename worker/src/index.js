import { RoomDO } from "./room.js";

export { RoomDO };

// Placeholder entry point so the `ROOM` Durable Object binding (which requires
// `main` to export the `RoomDO` class) resolves during tests. Task 7 replaces
// this default export with the real routing/CORS-wired Worker entry point.
export default {
  async fetch() {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
