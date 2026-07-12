import { describe, it, expect } from "vitest";
import { isValidMode, isValidChecksSeenArray, isValidItemsArray, validateEventBody, isValidAdminSecret, isValidEpoch, isValidShareFlags, isValidGameClearTime } from "../src/validation.js";

describe("isValidMode", () => {
  it("accepts the three known modes", () => {
    expect(isValidMode("checksSeen")).toBe(true);
    expect(isValidMode("checksSeen+shared")).toBe(true);
    expect(isValidMode("checksSeen+items")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidMode("items")).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(123)).toBe(false);
    expect(isValidMode("checksSeen+item")).toBe(false);
    expect(isValidMode("checksSeen+items+checks")).toBe(false);
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

describe("isValidItemsArray", () => {
  it("accepts a 96-length array of byte values", () => {
    expect(isValidItemsArray(new Array(96).fill(0))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidItemsArray(new Array(95).fill(0))).toBe(false);
  });

  it("rejects out-of-range or non-integer values", () => {
    const bad1 = new Array(96).fill(0);
    bad1[0] = 256;
    expect(isValidItemsArray(bad1)).toBe(false);

    const bad2 = new Array(96).fill(0);
    bad2[0] = 1.5;
    expect(isValidItemsArray(bad2)).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidItemsArray("not an array")).toBe(false);
    expect(isValidItemsArray(null)).toBe(false);
  });
});

describe("validateEventBody", () => {
  const valid = { player: "ds83171", game: 2, items: [0] };

  it("accepts a well-formed body with only items", () => {
    expect(validateEventBody(valid)).toBeNull();
  });

  it("accepts a well-formed body with only checks", () => {
    expect(validateEventBody({ player: "ds83171", game: 2, checks: [0] })).toBeNull();
  });

  it("accepts a well-formed body with both items and checks", () => {
    expect(validateEventBody({ player: "ds83171", game: 2, items: [0], checks: [1] })).toBeNull();
  });

  it("rejects a body with neither items nor checks", () => {
    expect(validateEventBody({ player: "ds83171", game: 2 })).toMatch(/items or checks/);
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
    expect(validateEventBody({ ...valid, items: ["not-a-number"] })).toMatch(/items/);
    expect(validateEventBody({ ...valid, items: [-1] })).toMatch(/items/);
    expect(validateEventBody({ ...valid, items: [1000] })).toMatch(/items/);
    expect(validateEventBody({ ...valid, items: [1.5] })).toMatch(/items/);
  });

  it("rejects an empty or oversized checks array", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [] })).toMatch(/checks/);
    expect(validateEventBody({ player: "a", game: 1, checks: new Array(21).fill(0) })).toMatch(/checks/);
  });

  it("rejects non-integer or out-of-range check entries", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [-1] })).toMatch(/checks/);
    expect(validateEventBody({ player: "a", game: 1, checks: [1000] })).toMatch(/checks/);
  });

  it("accepts the synthetic 900-902 game-clear check ids (see tracker/check_id_map.js)", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [900] })).toBeNull();
    expect(validateEventBody({ player: "a", game: 2, checks: [901] })).toBeNull();
    expect(validateEventBody({ player: "a", game: 3, checks: [902] })).toBeNull();
  });

  it("accepts the id range up to 999, rejecting just past it", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [999] })).toBeNull();
    expect(validateEventBody({ player: "a", game: 1, checks: [1000] })).toMatch(/checks/);
  });

  it("accepts the synthetic 903 all-clear check id with a companion gameClearTime", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [903], gameClearTime: "1:23:56" })).toBeNull();
  });

  it("omitting gameClearTime is fine (it's optional on every other event)", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [900] })).toBeNull();
  });

  it("rejects a malformed gameClearTime", () => {
    expect(validateEventBody({ player: "a", game: 1, checks: [903], gameClearTime: "not a time" })).toMatch(/gameClearTime/);
    expect(validateEventBody({ player: "a", game: 1, checks: [903], gameClearTime: 5036 })).toMatch(/gameClearTime/);
    expect(validateEventBody({ player: "a", game: 1, checks: [903], gameClearTime: "1:2:03" })).toMatch(/gameClearTime/);
  });

  it("rejects a non-object body", () => {
    expect(validateEventBody(null)).toMatch(/object/);
    expect(validateEventBody("nope")).toMatch(/object/);
  });
});

describe("isValidGameClearTime", () => {
  it("accepts undefined and well-formed H:MM:SS strings", () => {
    expect(isValidGameClearTime(undefined)).toBe(true);
    expect(isValidGameClearTime("0:00:00")).toBe(true);
    expect(isValidGameClearTime("1:23:56")).toBe(true);
    expect(isValidGameClearTime("123:00:00")).toBe(true);
  });

  it("rejects malformed strings and non-strings", () => {
    expect(isValidGameClearTime("1:2:3")).toBe(false);
    expect(isValidGameClearTime("abc")).toBe(false);
    expect(isValidGameClearTime(123)).toBe(false);
    expect(isValidGameClearTime(null)).toBe(false);
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

describe("isValidShareFlags", () => {
  it("accepts undefined (older Lua clients that predate this field)", () => {
    expect(isValidShareFlags(undefined)).toBe(true);
  });

  it("accepts an empty object and an object with any subset of the known boolean flags", () => {
    expect(isValidShareFlags({})).toBe(true);
    expect(isValidShareFlags({ sigmaKey: true, lifeUp: false })).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(isValidShareFlags({ sigmaKey: true, notARealFlag: true })).toBe(false);
  });

  it("rejects a non-boolean value for a known key", () => {
    expect(isValidShareFlags({ sigmaKey: "yes" })).toBe(false);
  });

  it("rejects null, arrays, and non-objects", () => {
    expect(isValidShareFlags(null)).toBe(false);
    expect(isValidShareFlags([])).toBe(false);
    expect(isValidShareFlags("nope")).toBe(false);
  });
});
