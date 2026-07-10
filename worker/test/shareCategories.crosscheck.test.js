import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { shareCategoryForId } from "../src/shareCategories.js";

let ITEM_ID_MAP;
let shareCategoryFor;

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
