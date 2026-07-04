import { describe, it, expect } from "vitest";
import { withCors, handleOptions } from "../src/cors.js";

describe("withCors", () => {
  it("adds CORS headers while preserving status and body", async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const wrapped = withCors(original);
    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(wrapped.headers.get("Content-Type")).toBe("application/json");
    expect(await wrapped.json()).toEqual({ ok: true });
  });
});

describe("handleOptions", () => {
  it("returns a 204 with CORS headers and no body", async () => {
    const res = handleOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(await res.text()).toBe("");
  });
});
