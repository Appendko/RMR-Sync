-- DIAGNOSTIC TOOL, not part of the mod -- deliberately kept in debug/
-- (outside lua/) so it never ends up bundled if you zip lua/ to send to
-- players; copy it into your own game folder alongside boot.lua only when
-- you actually want to run it. One-shot check of whether X3's Gravity
-- Beetle defeat (check id 755, tracker/check_id_map.js) is actually
-- recorded in sessionSave.checks -- the same table checkForNewChecks() in
-- share_info.lua diffs against -- to tell apart two very different bugs:
--   (a) the defeat IS recorded here but never got reported (a
--       share_info.lua diffing/baseline bug), vs
--   (b) the defeat is NOT recorded here at all (boot.lua itself hasn't
--       synced this check into sessionSave.checks yet, or the id mapping
--       is wrong -- unrelated to share_info.lua's settling logic).
--
-- How to use:
--   1. Copy this file into your game folder (alongside boot.lua).
--   2. Load it as an extra Lua script any time after the GB defeat --
--      no need to be on X3 currently, no need to reproduce anything.
--      It runs once and does not loop, so it's safe to reload any time.
--
-- Check id 755 = floor(755/8)=94th byte of the 96-byte checks array,
-- bit 755%8=3 (mask 0x08) -- same indexing share_logic.lua's
-- EVENT_CHECK_IDS and share_info.lua's readChecks()/cVavaStageKeyCheckByte
-- pattern use.

local cGbCheckId = 755
local cGbByte = cGbCheckId // 8
local cGbMask = 1 << (cGbCheckId % 8)

print("")
print("################ GB check (id 755) diagnostic ################")
local rawByte = sessionSave.checks[cGbByte] or 0
local isSet = (rawByte & cGbMask) ~= 0
print(string.format("sessionSave.checks[%d] = 0x%02X (mask 0x%02X) -> GB defeat recorded: %s",
    cGbByte, rawByte, cGbMask, tostring(isSet)))

print("")
print("Surrounding X3 boss bytes (checks 752-760, bytes 94-95 plus neighbors):")
for b = 92, 95 do
    print(string.format("  sessionSave.checks[%d] = 0x%02X", b, sessionSave.checks[b] or 0))
end
print("#################################################################")
print("")
