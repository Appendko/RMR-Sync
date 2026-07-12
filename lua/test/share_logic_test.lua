-- Run from the lua/ folder (cwd = lua/): lua test/share_logic_test.lua
package.path = package.path..";lib\\?.lua"
require "share_logic"

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(label .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
    end
end

-- diffNewBits: detects newly-set bits across a byte-array change
local before = { 0, 0xFF, 0 }
local after  = { 1, 0xFF, 0x80 }
local acquired = ShareLogic.diffNewBits(before, after)
assertEqual(#acquired, 2, "diffNewBits count")
assertEqual(acquired[1], 0, "diffNewBits first bit offset")   -- byte 1 bit 0 -> offset 0
assertEqual(acquired[2], 23, "diffNewBits second bit offset") -- byte 3 bit 7 -> offset (3-1)*8+7

assertEqual(#ShareLogic.diffNewBits({ 5, 5, 5 }, { 5, 5, 5 }), 0, "diffNewBits no change")
assertEqual(#ShareLogic.diffNewBits({ 1 }, { 0 }), 0, "diffNewBits bit cleared not reported")

-- isResponseFor: matches session+seq of the currently outstanding request
assertEqual(ShareLogic.isResponseFor({ session = "a", seq = 3 }, "a", 3), true, "isResponseFor match")
assertEqual(ShareLogic.isResponseFor({ session = "a", seq = 2 }, "a", 3), false, "isResponseFor wrong seq")
assertEqual(ShareLogic.isResponseFor({ session = "b", seq = 3 }, "a", 3), false, "isResponseFor wrong session")
assertEqual(ShareLogic.isResponseFor(nil, "a", 3), false, "isResponseFor nil message")

-- shouldForceOverwrite: epoch strictly ahead of what we knew -> force overwrite instead of OR-fold
assertEqual(ShareLogic.shouldForceOverwrite(2, 1), true, "shouldForceOverwrite ahead")
assertEqual(ShareLogic.shouldForceOverwrite(1, 1), false, "shouldForceOverwrite equal")
assertEqual(ShareLogic.shouldForceOverwrite(0, 1), false, "shouldForceOverwrite behind")

-- shouldReportAcquired: skip empty batches and initialization-sized bursts
assertEqual(ShareLogic.shouldReportAcquired(0, 6), false, "shouldReportAcquired empty batch")
assertEqual(ShareLogic.shouldReportAcquired(1, 6), true, "shouldReportAcquired single item")
assertEqual(ShareLogic.shouldReportAcquired(5, 6), true, "shouldReportAcquired just under threshold")
assertEqual(ShareLogic.shouldReportAcquired(6, 6), false, "shouldReportAcquired at threshold")
assertEqual(ShareLogic.shouldReportAcquired(8, 6), false, "shouldReportAcquired well over threshold")

-- isGameCleared: >= 0x80 means the title's story is complete, matching
-- boot.lua's own cMS_queryClearStatus threshold
assertEqual(ShareLogic.isGameCleared(0x80), true, "isGameCleared at threshold")
assertEqual(ShareLogic.isGameCleared(0xFF), true, "isGameCleared well above threshold")
assertEqual(ShareLogic.isGameCleared(0x7F), false, "isGameCleared just below threshold")
assertEqual(ShareLogic.isGameCleared(0), false, "isGameCleared untouched title")

-- formatClearTime: matches boot.lua's own getHMMSS (flat 60 frames/sec)
assertEqual(ShareLogic.formatClearTime(0), "0:00:00", "formatClearTime zero")
assertEqual(ShareLogic.formatClearTime(59), "0:00:00", "formatClearTime under a second rounds down")
assertEqual(ShareLogic.formatClearTime(60), "0:00:01", "formatClearTime exactly one second")
assertEqual(ShareLogic.formatClearTime(3600), "0:01:00", "formatClearTime exactly one minute")
assertEqual(ShareLogic.formatClearTime(216000), "1:00:00", "formatClearTime exactly one hour")
assertEqual(ShareLogic.formatClearTime(302160), "1:23:56", "formatClearTime H:MM:SS composite (1h23m56s * 60 frames/sec)")

-- isEventCheckId: stage-clear and boss-defeat ids are events, plain pickup
-- locations are not
assertEqual(ShareLogic.isEventCheckId(240), true, "isEventCheckId X1 opening stage clear")
assertEqual(ShareLogic.isEventCheckId(251), true, "isEventCheckId X1 sigma stage 3 clear")
assertEqual(ShareLogic.isEventCheckId(493), true, "isEventCheckId Violen defeated")
assertEqual(ShareLogic.isEventCheckId(751), true, "isEventCheckId Byte defeated")
assertEqual(ShareLogic.isEventCheckId(766), true, "isEventCheckId X3 sigma stage 2 clear (2)")
assertEqual(ShareLogic.isEventCheckId(0), false, "isEventCheckId life capsule is not an event")
assertEqual(ShareLogic.isEventCheckId(53), false, "isEventCheckId Hadouken is not an event")
assertEqual(ShareLogic.isEventCheckId(610), false, "isEventCheckId Ride Armor pickup is not an event")
assertEqual(ShareLogic.isEventCheckId(492), false, "isEventCheckId id just before X-Hunters block")

-- extractSeedKey: pulls the capital-S Base64 seed segment out of the Option
-- string, surviving boot.lua's own truncation of the tail since the seed
-- segment sits early in the string.
local fullOptionString = "V204#X7#xABA#Sbc8XFnwXt+HHkWR/eJMZRA#sk#W1#T#sKM75#ISB0#ISC#cL25#sK1AP//Y/8#sK2AP//Y2P/#sK3AP//Y/8#PEREREREREQ#MQQAIgEgE#clAA7gARw#roHw"
assertEqual(ShareLogic.extractSeedKey(fullOptionString), "bc8XFnwXt+HHkWR/eJMZRA", "extractSeedKey full string")

local truncatedOptionString = "V204#X7#xABA#Sbc8XFnwXt+HHkWR/eJMZRA#sk#W1#T#sKM75#ISB0#ISC#cL25#sK1AP//Y/8#sK2AP//Y2P/#sK3AP//Y"
assertEqual(ShareLogic.extractSeedKey(truncatedOptionString), "bc8XFnwXt+HHkWR/eJMZRA", "extractSeedKey boot.lua-truncated string")

local noSeedSegment = "V204#X7#xABA#sk#W1#T#sKM75#ISB0#ISC"
assertEqual(ShareLogic.extractSeedKey(noSeedSegment), noSeedSegment, "extractSeedKey no seed segment falls back unchanged")

local shortOptionString = "V204#X7#SV8d5m27k+p99XcvrXsSiYA#sk#W1#T#ISB0#ISC#PEREREREREQ#MQAAIgEgA"
assertEqual(ShareLogic.extractSeedKey(shortOptionString), "V8d5m27k+p99XcvrXsSiYA", "extractSeedKey short non-truncated string, seed segment in different position")

print("ALL PASS")
