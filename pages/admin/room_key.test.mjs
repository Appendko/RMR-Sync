import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

// room_key.js is a classic (non-module) browser script loaded via a plain
// <script> tag (see host_admin.html). We faithfully mirror that loading
// mechanism here using vm, rather than importing it as an ES module.
const dir = path.dirname(fileURLToPath(import.meta.url));
const context = {};
vm.createContext(context);
vm.runInContext(readFileSync(path.join(dir, "room_key.js"), "utf8"), context);
const { extractSeedKey } = context;

// Mirrors the test cases in lua/share_logic_test.lua for
// ShareLogic.extractSeedKey, using the exact same input strings, so both
// language implementations are verified to agree on the same room key.

test("extracts the seed segment from the full Option string", () => {
  const fullOptionString =
    "V204#X7#xABA#Sbc8XFnwXt+HHkWR/eJMZRA#sk#W1#T#sKM75#ISB0#ISC#cL25#sK1AP//Y/8#sK2AP//Y2P/#sK3AP//Y/8#PEREREREREQ#MQQAIgEgE#clAA7gARw#roHw";
  assert.equal(extractSeedKey(fullOptionString), "bc8XFnwXt+HHkWR/eJMZRA");
});

test("extracts the identical seed segment from boot.lua's truncated string", () => {
  const truncatedOptionString =
    "V204#X7#xABA#Sbc8XFnwXt+HHkWR/eJMZRA#sk#W1#T#sKM75#ISB0#ISC#cL25#sK1AP//Y/8#sK2AP//Y2P/#sK3AP//Y";
  assert.equal(extractSeedKey(truncatedOptionString), "bc8XFnwXt+HHkWR/eJMZRA");
});

test("falls back to the input unchanged when no S<base64> segment is present", () => {
  const noSeedSegment = "V204#X7#xABA#sk#W1#T#sKM75#ISB0#ISC";
  assert.equal(extractSeedKey(noSeedSegment), noSeedSegment);
});

test("finds the seed segment regardless of its position in the string", () => {
  const shortOptionString =
    "V204#X7#SV8d5m27k+p99XcvrXsSiYA#sk#W1#T#ISB0#ISC#PEREREREREQ#MQAAIgEgA";
  assert.equal(extractSeedKey(shortOptionString), "V8d5m27k+p99XcvrXsSiYA");
});
