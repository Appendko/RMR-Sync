import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { shareCategoryForId, itemMergeSiblings } from "../src/shareCategories.js";

let ITEM_ID_MAP;
let shareCategoryFor;

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

describe("itemMergeSiblings", () => {
  it("returns the same 3 ids regardless of which title's id you start from", () => {
    expect(itemMergeSiblings(36)).toEqual([36, 292, 548]); // Sub Tank #1, starting from title 1
    expect(itemMergeSiblings(292)).toEqual([36, 292, 548]); // same slot, starting from title 2
    expect(itemMergeSiblings(548)).toEqual([36, 292, 548]); // same slot, starting from title 3
  });
});

// Cross-checks against tracker/icon_map.js's shareCategoryFor (string-code
// based) for every real id in tracker/item_id_map.js, guarding the two
// independent implementations against drifting apart -- see
// docs/superpowers/specs/2026-07-10-item-merge-mode-design.md's
// Verification section.
describe("shareCategoryForId matches tracker/icon_map.js's shareCategoryFor", () => {
  beforeAll(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const trackerDir = path.join(dir, "..", "..", "tracker");
    const context = {};
    vm.createContext(context);

    // item_id_map.js declares ITEM_ID_MAP via `const`, which vm does NOT
    // expose as a context object property (unlike `function`/`var`
    // declarations) -- bridge it onto the context object explicitly from
    // within the same script execution, where the const binding is in scope.
    const itemIdMapSrc = readFileSync(path.join(trackerDir, "item_id_map.js"), "utf8");
    vm.runInContext(itemIdMapSrc + "\nthis.ITEM_ID_MAP = ITEM_ID_MAP;\n", context);
    for (const file of ["item_names_en.js", "item_names_ja.js", "item_names_zhtw.js", "icon_map.js"]) {
      vm.runInContext(readFileSync(path.join(trackerDir, file), "utf8"), context);
    }
    ITEM_ID_MAP = context.ITEM_ID_MAP;
    shareCategoryFor = context.shareCategoryFor;
  });

  it("agrees for every id in ITEM_ID_MAP", () => {
    for (const idStr of Object.keys(ITEM_ID_MAP)) {
      const id = Number(idStr);
      const code = ITEM_ID_MAP[id];
      expect(shareCategoryForId(id)).toBe(shareCategoryFor(code));
    }
  });
});
