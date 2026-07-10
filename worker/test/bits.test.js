import { describe, it, expect } from "vitest";
import { orMergeBytes, countSetBits, setBit } from "../src/bits.js";

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

describe("setBit", () => {
  it("sets the correct bit within the correct byte", () => {
    const bytes = new Array(96).fill(0);
    setBit(bytes, 36); // byte 4, bit 4 (0x10)
    expect(bytes[4]).toBe(0x10);
    expect(bytes.filter((b) => b !== 0)).toHaveLength(1);
  });

  it("ORs into an existing byte without clobbering other bits", () => {
    const bytes = new Array(96).fill(0);
    bytes[4] = 0x01; // some other bit already set in the same byte
    setBit(bytes, 36); // bit 4 (0x10) of the same byte
    expect(bytes[4]).toBe(0x11);
  });

  it("is idempotent -- setting an already-set bit changes nothing", () => {
    const bytes = new Array(96).fill(0);
    setBit(bytes, 36);
    setBit(bytes, 36);
    expect(bytes[4]).toBe(0x10);
  });
});
