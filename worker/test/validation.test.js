import { describe, it, expect } from "vitest";
import { isValidMode, isValidChecksSeenArray, validateEventBody, isValidAdminSecret, isValidEpoch } from "../src/validation.js";

describe("isValidMode", () => {
  it("accepts the two known modes", () => {
    expect(isValidMode("checksSeen")).toBe(true);
    expect(isValidMode("checksSeen+items")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidMode("items")).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(123)).toBe(false);
  });
});

describe("isValidChecksSeenArray", () => {
  it("accepts a 96-length array of byte values", () => {
    expect(isValidChecksSeenArray(new Array(96).fill(0))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidChecksSeenArray(new Array(95).fill(0))).toBe(false);
  });

  it("rejects out-of-range or non-integer values", () => {
    const bad1 = new Array(96).fill(0);
    bad1[0] = 256;
    expect(isValidChecksSeenArray(bad1)).toBe(false);

    const bad2 = new Array(96).fill(0);
    bad2[0] = 1.5;
    expect(isValidChecksSeenArray(bad2)).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidChecksSeenArray("not an array")).toBe(false);
    expect(isValidChecksSeenArray(null)).toBe(false);
  });
});

describe("validateEventBody", () => {
  const valid = { player: "ds83171", game: 2, items: [0] };

  it("accepts a well-formed body", () => {
    expect(validateEventBody(valid)).toBeNull();
  });

  it("rejects a missing or empty player name", () => {
    expect(validateEventBody({ ...valid, player: "" })).toMatch(/player/);
    expect(validateEventBody({ ...valid, player: undefined })).toMatch(/player/);
  });

  it("rejects a player name over 32 characters", () => {
    expect(validateEventBody({ ...valid, player: "x".repeat(33) })).toMatch(/player/);
  });

  it("rejects an out-of-range game number", () => {
    expect(validateEventBody({ ...valid, game: 0 })).toMatch(/game/);
    expect(validateEventBody({ ...valid, game: 4 })).toMatch(/game/);
    expect(validateEventBody({ ...valid, game: 1.5 })).toMatch(/game/);
  });

  it("rejects an empty or oversized items array", () => {
    expect(validateEventBody({ ...valid, items: [] })).toMatch(/items/);
    expect(validateEventBody({ ...valid, items: new Array(21).fill(0) })).toMatch(/items/);
  });

  it("rejects non-integer or out-of-range item entries", () => {
    expect(validateEventBody({ ...valid, items: ["not-a-number"] })).toMatch(/item/);
    expect(validateEventBody({ ...valid, items: [-1] })).toMatch(/item/);
    expect(validateEventBody({ ...valid, items: [768] })).toMatch(/item/);
    expect(validateEventBody({ ...valid, items: [1.5] })).toMatch(/item/);
  });

  it("rejects a non-object body", () => {
    expect(validateEventBody(null)).toMatch(/object/);
    expect(validateEventBody("nope")).toMatch(/object/);
  });
});

describe("isValidAdminSecret", () => {
  it("accepts a non-empty string up to 100 characters", () => {
    expect(isValidAdminSecret("my-secret")).toBe(true);
    expect(isValidAdminSecret("x".repeat(100))).toBe(true);
  });

  it("rejects empty, oversized, or non-string values", () => {
    expect(isValidAdminSecret("")).toBe(false);
    expect(isValidAdminSecret("x".repeat(101))).toBe(false);
    expect(isValidAdminSecret(undefined)).toBe(false);
    expect(isValidAdminSecret(123)).toBe(false);
  });
});

describe("isValidEpoch", () => {
  it("accepts zero and positive integers", () => {
    expect(isValidEpoch(0)).toBe(true);
    expect(isValidEpoch(42)).toBe(true);
  });

  it("rejects negative numbers, non-integers, and non-numbers", () => {
    expect(isValidEpoch(-1)).toBe(false);
    expect(isValidEpoch(1.5)).toBe(false);
    expect(isValidEpoch("0")).toBe(false);
    expect(isValidEpoch(undefined)).toBe(false);
  });
});
