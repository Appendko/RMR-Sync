import { describe, it, expect } from "vitest";
import { shareCategoryForId } from "../src/shareCategories.js";

describe("shareCategoryForId", () => {
  it("classifies lifeUp (0x00-0x0F)", () => {
    expect(shareCategoryForId(0)).toBe("lifeUp"); // 1ItLifeUp1
    expect(shareCategoryForId(13)).toBe("lifeUp"); // 1ItLifeUpD6, 0x0D
    expect(shareCategoryForId(256)).toBe("lifeUp"); // 2ItLifeUp1
    expect(shareCategoryForId(512 + 13)).toBe("lifeUp"); // 3ItLifeUpD6
  });

  it("classifies energyUp (0x10-0x1F)", () => {
    expect(shareCategoryForId(16)).toBe("energyUp"); // 1ItEnergyUp1
    expect(shareCategoryForId(29)).toBe("energyUp"); // 1ItEnergyUp14, 0x1D
  });

  it("classifies subTank (0x24-0x27)", () => {
    expect(shareCategoryForId(36)).toBe("subTank"); // 1ItSubtank1
    expect(shareCategoryForId(39)).toBe("subTank"); // 1ItSubtank4
  });

  it("classifies sigmaKey (0x40-0x4F)", () => {
    expect(shareCategoryForId(64)).toBe("sigmaKey"); // 1ItKeyS1
    expect(shareCategoryForId(76)).toBe("sigmaKey"); // 1ItKeyS13, 0x4C
    expect(shareCategoryForId(589)).toBe("sigmaKey"); // 3ItKeyS14, 512+0x4D
  });

  it("classifies finalWeapon (exactly 0x50)", () => {
    expect(shareCategoryForId(80)).toBe("finalWeapon"); // 1ItHadouken
    expect(shareCategoryForId(336)).toBe("finalWeapon"); // 2ItShoryuken
    expect(shareCategoryForId(592)).toBe("finalWeapon"); // 3ItSaber
  });

  it("classifies armor (0x58-0x5F)", () => {
    expect(shareCategoryForId(88)).toBe("armor"); // 1ItHeadPart
    expect(shareCategoryForId(95)).toBe("armor"); // 1ItFootChip
  });

  it("classifies upgradeItem (0x60-0x73)", () => {
    expect(shareCategoryForId(96)).toBe("upgradeItem"); // 1ItBusterAmmo1
    expect(shareCategoryForId(115)).toBe("upgradeItem"); // 1ItCharge150, 0x73
  });

  it("returns null for boss weapons/keys, stage-varied codes, and the gap between energyUp and subTank", () => {
    expect(shareCategoryForId(40)).toBeNull(); // 1ItWeaponLO, 0x28
    expect(shareCategoryForId(48)).toBeNull(); // 1ItKeyLO, 0x30
    expect(shareCategoryForId(57)).toBeNull(); // 1ItStageVariedSC, 0x39
    expect(shareCategoryForId(32)).toBeNull(); // 0x20, unused gap (boot.lua's own "Unknown Item" range)
  });

  it("returns null for the ItEmpty sentinel", () => {
    expect(shareCategoryForId(255)).toBeNull();
  });
});
