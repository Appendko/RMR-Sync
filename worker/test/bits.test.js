import { describe, it, expect } from "vitest";
import { orMergeBytes, countSetBits } from "../src/bits.js";

describe("orMergeBytes", () => {
  it("ORs each byte position", () => {
    expect(orMergeBytes([0b0001, 0b0100], [0b0010, 0b0000])).toEqual([0b0011, 0b0100]);
  });

  it("throws on length mismatch", () => {
    expect(() => orMergeBytes([1, 2], [1])).toThrow(/length mismatch/);
  });
});

describe("countSetBits", () => {
  it("counts bits across all bytes", () => {
    expect(countSetBits([0, 0xff, 0b101])).toBe(10);
  });

  it("returns 0 for all-zero input", () => {
    expect(countSetBits([0, 0, 0])).toBe(0);
  });
});
