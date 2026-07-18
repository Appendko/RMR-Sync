-- DIAGNOSTIC TOOL, not part of the mod -- deliberately kept in debug/
-- (outside lua/) so it never ends up bundled if you zip lua/ to send to
-- players; copy it into your own game folder alongside boot.lua only when
-- you actually want to run it. Continuously watches addrItems (raw WRAM)
-- frame-by-frame and prints the moment its bit count changes, with the
-- exact frame number and which bytes changed -- unlike
-- debug_check_items_wram.lua's one-shot snapshot, this catches the
-- *transition* in the act. Also watches boot.lua's own addrIInfo/addrSInfo
-- validity flags (the same ones its main loop checks every frame to
-- detect a Soft/Hard Reset) alongside the items bit count, to check
-- whether they flip back to "valid" sooner than addrItems actually
-- settles -- if so, that'd be a faster, precise replacement for
-- share_info.lua's current fixed 60s cooldown.
--
-- How to use:
--   1. Copy this file into your game folder (alongside boot.lua).
--   2. Boot into gameplay as normal (boot.lua has already finished booting).
--   3. Load THIS script ALONGSIDE share_info.lua (both loaded at the same
--      time, as two separate scripts) -- BizHawk's Lua console interleaves
--      print() output from every loaded script into one shared console, in
--      the order it happens, so you'll see share_info.lua's own "waiting
--      for relay page" / "synced (epoch N)" lines mixed in with this
--      script's "WRAM CHANGED at frame N" lines -- letting you see exactly
--      whether a jump lines up with a sync completing, or happens with no
--      corresponding share_info.lua message at all.
--   4. Watch the console. Every change prints immediately; nothing prints
--      when nothing changes, so the log stays readable over a long watch.
--      A short ~10s capture right after one title switch is enough to see
--      whether addrIInfo/addrSInfo become valid quickly -- it just won't
--      show the full settling duration for a slow title pairing (the
--      slowest observed so far took ~47s), only the early part of it.

local addrItems = 0x7FFF00
local cItems = 0x60 -- 96 bytes total
local addrIInfo = 0x7FFFE6 -- boot.lua's own "properly booted" magic value (0x784D when valid)
local addrSInfo = 0x7FFFEC -- boot.lua's own sync-state byte (0xFF means invalid/uninitialized)

local function countBits(value)
    local cnt = 0
    while value > 0 do
        if value % 2 == 1 then cnt = cnt + 1 end
        value = value // 2
    end
    return cnt
end

local function readAll()
    local bytes = {}
    local total = 0
    for i = 0, cItems - 1 do
        local b = cpu[addrItems + i]
        bytes[i] = b
        total = total + countBits(b)
    end
    return bytes, total
end

local function readBootFlags()
    return cpu2[addrIInfo], cpu[addrSInfo]
end

local function bootFlagsStr(iInfo, sInfo)
    local validStr = (iInfo == 0x784D and sInfo ~= 0xFF) and "VALID" or "INVALID"
    return string.format("iInfo=%04X sInfo=%02X (%s)", iInfo, sInfo, validStr)
end

print("")
print("################ addrItems WRAM watch started ################")
local prevBytes, prevTotal = readAll()
local prevIInfo, prevSInfo = readBootFlags()
print(string.format("Baseline at frame %d: %d bits set, %s", ew.framecount(), prevTotal, bootFlagsStr(prevIInfo, prevSInfo)))
print("#################################################################")
print("")

while true do
    local bytes, total = readAll()
    local iInfo, sInfo = readBootFlags()
    if iInfo ~= prevIInfo or sInfo ~= prevSInfo then
        print(string.format(
            "-- boot flags changed at frame %d: %s -> %s (items currently %d bits)",
            ew.framecount(), bootFlagsStr(prevIInfo, prevSInfo), bootFlagsStr(iInfo, sInfo), total
        ))
        prevIInfo, prevSInfo = iInfo, sInfo
    end
    if total ~= prevTotal then
        local changedBytes = {}
        for i = 0, cItems - 1 do
            if bytes[i] ~= prevBytes[i] then
                table.insert(changedBytes, string.format("byte[%d] %02X->%02X", i, prevBytes[i], bytes[i]))
            end
        end
        print(string.format(
            "!! WRAM CHANGED at frame %d: %d -> %d bits set (%+d), %s. Changed bytes: %s",
            ew.framecount(), prevTotal, total, total - prevTotal, bootFlagsStr(iInfo, sInfo), table.concat(changedBytes, ", ")
        ))
        prevBytes = bytes
        prevTotal = total
    end
    ew.frameadvance()
end
