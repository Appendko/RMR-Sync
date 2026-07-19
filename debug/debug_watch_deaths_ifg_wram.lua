-- DIAGNOSTIC TOOL, not part of the mod -- deliberately kept in debug/
-- (outside lua/) so it never ends up bundled if you zip lua/ to send to
-- players; copy it into your own game folder alongside boot.lua only when
-- you actually want to run it. Structural sibling of
-- debug_watch_items_wram.lua, but watching addrIFG and all 3
-- addrDeathByTitle addresses instead of addrItems -- built to catch
-- whether either value's post-reload correction lands in one atomic jump
-- or in several small visible steps a short time apart, which share_info.lua
-- itself can't tell apart from a genuine repeated real event.
--
-- How to use:
--   1. Copy this file into your game folder (alongside boot.lua).
--   2. Boot into gameplay as normal (boot.lua has already finished booting).
--   3. Load THIS script ALONGSIDE share_info.lua (both loaded at the same
--      time, as two separate scripts) -- BizHawk's Lua console interleaves
--      print() output from every loaded script into one shared console, in
--      the order it happens, so you'll see share_info.lua's own "title
--      switch detected" / "WRAM settled" / "synced (epoch N)" lines mixed
--      in with this script's "IFG CHANGED"/"DEATHS[title] CHANGED" lines --
--      letting you see exactly how many raw WRAM changes happen around a
--      settling window, and whether share_info.lua's own event report(s)
--      line up with one of them or with several.
--   4. Watch the console. Every change prints immediately; nothing prints
--      when nothing changes, so the log stays readable over a long watch.
--   5. To reproduce the "death message repeats after IFG use" report: die,
--      switch games, then use IFG, and watch whether DEATHS[title] prints
--      more than once around that point even though only one real death
--      happened.

local addrIFG = 0x7FFFAE
local addrDeathByTitle = { 0x7E1F80, 0x7E1FB3, 0x7E1FB4 }

local function currentTitle()
    local tmp = cpu[0x80FFC9] - 0x30
    if tmp < 0 then tmp = 1 end
    return tmp
end

print("")
print("################ IFG/deaths WRAM watch started ################")
local prevIfg = cpu[addrIFG]
local prevDeaths = { cpu[addrDeathByTitle[1]], cpu[addrDeathByTitle[2]], cpu[addrDeathByTitle[3]] }
print(string.format(
    "Baseline at frame %d: IFG=%d, deaths[X1]=%d deaths[X2]=%d deaths[X3]=%d (active title X%d)",
    ew.framecount(), prevIfg, prevDeaths[1], prevDeaths[2], prevDeaths[3], currentTitle()
))
print("#################################################################")
print("")

while true do
    local ifgNow = cpu[addrIFG]
    if ifgNow ~= prevIfg then
        print(string.format("!! IFG CHANGED at frame %d: %d -> %d (%+d)", ew.framecount(), prevIfg, ifgNow, ifgNow - prevIfg))
        prevIfg = ifgNow
    end
    for title = 1, 3 do
        local deathsNow = cpu[addrDeathByTitle[title]]
        if deathsNow ~= prevDeaths[title] then
            print(string.format(
                "!! DEATHS[X%d] CHANGED at frame %d: %d -> %d (%+d) (active title X%d)",
                title, ew.framecount(), prevDeaths[title], deathsNow, deathsNow - prevDeaths[title], currentTitle()
            ))
            prevDeaths[title] = deathsNow
        end
    end
    ew.frameadvance()
end
