-- DIAGNOSTIC TOOL, not part of the mod -- deliberately kept in debug/
-- (outside lua/) so it never ends up bundled if you zip lua/ to send to
-- players; copy it into your own game folder alongside boot.lua only when
-- you actually want to run it. Structural sibling of
-- debug_watch_items_wram.lua, but watching sessionSave.checks (the same
-- 96-byte table share_info.lua's readChecks()/checkForNewChecks() diffs
-- against) instead of raw addrItems WRAM. Built to find out whether checks
-- show the same transient "hub garbage" swing around a title switch that
-- addrItems does (confirmed 654-741 frames to correct), and if so, whether
-- the current 900-frame settling cooldown covers it -- this is suspected as
-- the cause of the unreported X3 Gravity Beetle (check 755) defeat: a large
-- "noise" batch read while sessionSave.checks was still unsettled would get
-- silently folded into share_info.lua's previousChecks baseline (even
-- though not reported, since checkForNewChecks treats large batches as
-- title-entry initialization noise), permanently marking any bit it
-- happened to include as "already seen".
--
-- How to use:
--   1. Copy this file into your game folder (alongside boot.lua).
--   2. Boot into gameplay as normal (boot.lua has already finished booting).
--   3. Load THIS script ALONGSIDE share_info.lua (both loaded at the same
--      time, as two separate scripts) -- BizHawk's Lua console interleaves
--      print() output from every loaded script into one shared console, in
--      the order it happens, so you'll see share_info.lua's own "title
--      switch detected"/"WRAM settled"/"synced (epoch N)" lines mixed in
--      with this script's "CHECKS CHANGED at frame N" lines -- letting you
--      see exactly how long after a reload sessionSave.checks keeps
--      swinging, the same way the items watcher already showed for
--      addrItems.
--   4. Watch the console. Every change prints immediately; nothing prints
--      when nothing changes, so the log stays readable over a long watch.
--   5. To reproduce: switch titles (any titles) a few times and watch for
--      a large (dozens+) bit-count swing right after each "title switch
--      detected" line, and note the frame number it settles back down at.

local cChecks = 96 -- 96 bytes total, same as addrItems (3 titles x 32 bytes/title)

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
    for i = 0, cChecks - 1 do
        local b = sessionSave.checks[i] or 0
        bytes[i] = b
        total = total + countBits(b)
    end
    return bytes, total
end

print("")
print("################ sessionSave.checks watch started ################")
local prevBytes, prevTotal = readAll()
print(string.format("Baseline at frame %d: %d bits set", ew.framecount(), prevTotal))
print("#####################################################################")
print("")

while true do
    local bytes, total = readAll()
    if total ~= prevTotal then
        local changedBytes = {}
        for i = 0, cChecks - 1 do
            if bytes[i] ~= prevBytes[i] then
                table.insert(changedBytes, string.format("byte[%d] %02X->%02X", i, prevBytes[i], bytes[i]))
            end
        end
        print(string.format(
            "!! CHECKS CHANGED at frame %d: %d -> %d bits set (%+d). Changed bytes: %s",
            ew.framecount(), prevTotal, total, total - prevTotal, table.concat(changedBytes, ", ")
        ))
        prevBytes = bytes
        prevTotal = total
    end
    ew.frameadvance()
end
