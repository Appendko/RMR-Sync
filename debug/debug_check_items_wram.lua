-- DIAGNOSTIC TOOL, not part of the mod -- deliberately kept in debug/
-- (outside lua/) so it never ends up bundled if you zip lua/ to send to
-- players; copy it into your own game folder alongside boot.lua only when
-- you actually want to run it. Purpose: check whether addrItems (the flat,
-- all-3-titles-at-once 96-byte WRAM buffer boot.lua synchronizes every
-- frame) already has a suspicious number of bits set on a *freshly booted*
-- save, before any real gameplay -- and if so, whether that garbage is
-- concentrated in the title(s) that AREN'T currently active (see the
-- mergedItemsBitsSet=406 investigation).
--
-- How to use:
--   1. Copy this file into your game folder (alongside boot.lua).
--   2. Boot into gameplay as normal (boot.lua has already finished booting).
--   3. Load THIS script as an extra Lua script (same as you'd load
--      share_info.lua) -- no share_config.txt or network setup needed, this
--      never touches the relay files or the Worker.
--   4. Read the Lua Console output. It runs once and does not loop, so it's
--      safe to run again any time by reloading the script.
--
-- Compares two sources for the same data:
--   - raw WRAM (cpu[addrItems+i]) -- what share_info.lua's readItems() sends
--   - sessionSave.items[i] -- the Lua-side table boot.lua's own on-screen
--     "Item:NNN" debug counter reads (see boot.lua's displayTimeAndItemsAndChecks)
-- They should always match (boot.lua's synchronize_or keeps them equal every
-- frame) -- this script prints both anyway so a mismatch, if one exists, is
-- immediately visible rather than assumed away.

local addrItems = 0x7FFF00
local cItems = 0x60          -- 96 bytes total
local cBytesPerTitle = 0x20  -- 32 bytes/title (matches boot.lua's own
                              -- handler_testGame default-item indexing)
local cForcedBitsPerTitle = 9 -- boot.lua's own debug-display baseline
                              -- ("items = items - 9*3")

local function currentTitle()
    local tmp = cpu[0x80FFC9] - 0x30
    if tmp < 0 then tmp = 1 end
    return tmp
end

local function countBits(value)
    local cnt = 0
    while value > 0 do
        if value % 2 == 1 then cnt = cnt + 1 end
        value = value // 2
    end
    return cnt
end

local function dumpSource(label, readByte)
    print("=== " .. label .. " ===")
    local totalBits = 0
    local hex = {}
    for title = 1, 3 do
        local titleBits = 0
        local base = (title - 1) * cBytesPerTitle
        for i = 0, cBytesPerTitle - 1 do
            local b = readByte(base + i)
            titleBits = titleBits + countBits(b)
            hex[base + i + 1] = string.format("%02X", b)
        end
        totalBits = totalBits + titleBits
        local extra = titleBits - cForcedBitsPerTitle
        print(string.format(
            "  X%d (bytes %3d-%3d): %3d bits set  (expected ~%d baseline -> %+d unexplained)",
            title, base, base + cBytesPerTitle - 1, titleBits, cForcedBitsPerTitle, extra
        ))
    end
    print(string.format("  TOTAL: %d bits set across all 3 titles", totalBits))
    print("  Hex dump (96 bytes): " .. table.concat(hex, " "))
    print("")
    return totalBits
end

print("")
print("################ addrItems WRAM diagnostic ################")
print("Currently active title: X" .. tostring(currentTitle()))
print("")

local wramTotal = dumpSource("Raw WRAM (cpu[addrItems+i]) -- what readItems() sends", function(i)
    return cpu[addrItems + i]
end)

local sessionTotal = dumpSource("sessionSave.items[i] -- what boot.lua's own on-screen counter reads", function(i)
    return sessionSave.items[i] or 0
end)

if wramTotal ~= sessionTotal then
    print("!! MISMATCH: raw WRAM and sessionSave.items disagree right now (" ..
        wramTotal .. " vs " .. sessionTotal .. " total bits set). Note the " ..
        "titles above where they differ -- that's new information beyond " ..
        "what we've reasoned about from source alone.")
else
    print("(Raw WRAM and sessionSave.items agree, as expected from boot.lua's own synchronize_or.)")
end
print("#############################################################")
print("")
