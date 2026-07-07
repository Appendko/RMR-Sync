-- Load this script after boot.lua has finished booting into gameplay
-- (not during the boot/boss-select screen). No special BizHawk launch
-- flags are needed -- this script never touches comm.http*; all networking
-- is relayed through tracker/sync_relay.html (Task 16) via local files.

package.path = package.path..";lua\\?.lua"
require "json"
require "file_relay"
require "share_logic"
require "config"

local cChecksPerTitle = 0x20
local addrChecksSeen = 0x7FFF80
local addrItems = 0x7FFF00
local addrLastProgressFrame = 0x7E0244
local cItems = 0x60
local cItemCheckFrames = 12 -- ~0.2s at 60fps: cheap RAM-only check for newly-acquired items; can trigger an early outbox write ahead of the heartbeat
local cWaitFrames = 600 -- ~10s at 60fps: idle-only heartbeat (pulls others' checksSeen updates when nothing local has triggered a request) -- deliberately slow to reduce Worker/Durable-Object request volume for a real multi-player session; checksSeen sync has no real latency requirement
local cStaleThreshold = 20 -- ~20 fast-cycles * ~0.2s = ~4s of genuine unresponsiveness before warning, matching the original user-facing timing despite ack-checking now running on the fast timer instead of the (now much slower) idle heartbeat

local function currentTitle()
    local tmp = cpu[0x80FFC9] - 0x30
    if tmp < 0 then tmp = 1 end
    return tmp
end

local function readChecksSeen()
    local arr = {}
    for i = 0, 95 do
        arr[i + 1] = sessionSave.checksSeen[i] or 0
    end
    return arr
end

-- forceOverwrite=false (normal case): OR the merged bytes into live RAM, same
-- fold-back style as boot.lua's own synchronize_or, so a very recent
-- not-yet-relayed in-game discovery isn't lost.
-- forceOverwrite=true (a new resetEpoch was just detected): overwrite RAM
-- directly instead, since the whole point is to discard whatever stale bits
-- are still sitting there from before the reset.
local function writeChecksSeen(merged, forceOverwrite)
    for i = 0, 95 do
        if forceOverwrite then
            sessionSave.checksSeen[i] = merged[i + 1]
        else
            sessionSave.checksSeen[i] = (sessionSave.checksSeen[i] or 0) | merged[i + 1]
        end
    end
    local title = currentTitle()
    local baseOffset = (title - 1) * cChecksPerTitle
    for i = 0, cChecksPerTitle - 1 do
        if forceOverwrite then
            cpu[addrChecksSeen + i] = merged[baseOffset + i + 1]
        else
            cpu[addrChecksSeen + i] = cpu[addrChecksSeen + i] | merged[baseOffset + i + 1]
        end
    end
end

local function readItems()
    local arr = {}
    for i = 0, cItems - 1 do
        arr[i + 1] = cpu[addrItems + i]
    end
    return arr
end

local cfg, cfgErr = ShareConfig.load("share_config.txt")
if not cfg then
    error("share_info.lua: " .. cfgErr)
end

-- The room key (Option string) commonly contains "#" and "+", which are
-- special characters in a URL query string ("#" starts a fragment, cutting
-- the query short if pasted in raw) -- percent-encode it here so players can
-- copy a working tracker link straight out of the Lua console instead of
-- hand-encoding it themselves.
local function urlEncode(str)
    return (str:gsub("[^%w_%-%.~]", function(c)
        return string.format("%%%02X", c:byte())
    end))
end

print("RMR Sync: tracker link query suffix: ?room=" .. urlEncode(ShareLogic.extractSeedKey(sessionSave.param)))

math.randomseed(os.time())
local session = string.format("%06x", math.random(0, 0xFFFFFF))
local seq = 0
local outstandingSeq = nil
local pendingEvents = {}
local shareMode = nil
local previousItems = nil
local previousProgressFrame = nil
local knownEpoch = 0
local waitFrames = 0
local staleCycles = 0
local itemCheckFrames = 0

-- Lua console only (not Text.out/on-screen) -- an on-screen overlay redrawn
-- only once per poll cycle (every ~1.5s) reads as a flicker rather than a
-- steady HUD element. Only print when the message actually changes, so a
-- routine successful sync doesn't spam the console every cycle -- only a
-- genuinely new state (a different epoch, a new error, a new wait state)
-- produces a new line.
local lastStatusText = nil
local function statusLine(text)
    if text ~= lastStatusText then
        print("share_info: " .. text)
        lastStatusText = text
    end
end

local function tryConsumeInbox()
    local msg = Relay.readInbox()
    if not ShareLogic.isResponseFor(msg, session, outstandingSeq) then
        return
    end
    if msg.ok and msg.sync then
        shareMode = msg.sync.mode
        local forceOverwrite = ShareLogic.shouldForceOverwrite(msg.sync.epoch, knownEpoch)
        knownEpoch = msg.sync.epoch
        writeChecksSeen(msg.sync.checksSeen, forceOverwrite)
        pendingEvents = {}
        statusLine("synced (epoch " .. knownEpoch .. ")")
    else
        statusLine(tostring(msg.error or "relay error"))
    end
    outstandingSeq = nil
    staleCycles = 0
end

local function issueRequest()
    seq = seq + 1
    outstandingSeq = seq
    Relay.writeOutbox({
        session = session,
        seq = seq,
        workerUrl = cfg.worker_url,
        roomKey = ShareLogic.extractSeedKey(sessionSave.param),
        player = cfg.player_name,
        sync = { checksSeen = readChecksSeen(), epoch = knownEpoch },
        events = pendingEvents,
    })
end

-- Checked far more often than the routine heartbeat (see cItemCheckFrames) since
-- this is just a cheap RAM read/diff, no I/O. The moment a new item is detected,
-- fire a fresh outbox write immediately rather than waiting for the next
-- heartbeat cycle -- this is what makes item-pickup events show up quickly.
-- Safe to supersede an already-outstanding request: the old request's eventual
-- (now-stale) response will be ignored by ShareLogic.isResponseFor, since its
-- seq will no longer match the new outstandingSeq this function just set.
local function checkForNewItems()
    if shareMode ~= "checksSeen+items" then
        return
    end
    local progressFrame = cpu2[addrLastProgressFrame]
    if previousProgressFrame == progressFrame then
        return -- no real in-game progress since the last check; skip the diff entirely,
               -- matching boot.lua's own gating (raw item bytes aren't stable between
               -- real progress events, so diffing them unconditionally causes false positives)
    end
    previousProgressFrame = progressFrame

    local items = readItems()
    if previousItems then
        local acquired = ShareLogic.diffNewBits(previousItems, items)
        if #acquired > 0 then
            table.insert(pendingEvents, { game = currentTitle(), items = acquired })
            issueRequest()
        end
    end
    previousItems = items
end

while true do
    itemCheckFrames = itemCheckFrames - 1
    if itemCheckFrames <= 0 then
        itemCheckFrames = cItemCheckFrames
        tryConsumeInbox()
        checkForNewItems()
        if outstandingSeq ~= nil then
            staleCycles = staleCycles + 1
            if staleCycles >= cStaleThreshold then
                statusLine("waiting for relay page (open tracker/sync_relay.html)")
            end
        end
    end

    waitFrames = waitFrames - 1
    if waitFrames <= 0 then
        waitFrames = cWaitFrames
        if outstandingSeq == nil then
            issueRequest()
        end
    end
    ew.frameadvance()
end
