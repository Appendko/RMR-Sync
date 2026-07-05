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
local cItems = 0x60
local cWaitFrames = 90 -- ~1.5s at 60fps; safe to poll this often now -- pure local file I/O, no network stutter

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

math.randomseed(os.time())
local session = string.format("%06x", math.random(0, 0xFFFFFF))
local seq = 0
local outstandingSeq = nil
local pendingEvents = {}
local shareMode = nil
local previousItems = nil
local knownEpoch = 0
local waitFrames = 0
local staleCycles = 0

local function statusLine(text)
    Text.out(16, 32, "share_info: " .. text, ew.RGB(255, 255, 0), ew.RGBA(0, 0, 0, 192))
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
    if shareMode == "checksSeen+items" then
        local items = readItems()
        if previousItems then
            local acquired = ShareLogic.diffNewBits(previousItems, items)
            if #acquired > 0 then
                table.insert(pendingEvents, { game = currentTitle(), items = acquired })
            end
        end
        previousItems = items
    end

    seq = seq + 1
    outstandingSeq = seq
    Relay.writeOutbox({
        session = session,
        seq = seq,
        workerUrl = cfg.worker_url,
        roomKey = sessionSave.param,
        player = cfg.player_name,
        sync = { checksSeen = readChecksSeen(), epoch = knownEpoch },
        events = pendingEvents,
    })
end

while true do
    waitFrames = waitFrames - 1
    if waitFrames <= 0 then
        waitFrames = cWaitFrames
        tryConsumeInbox()
        if outstandingSeq == nil then
            issueRequest()
        else
            staleCycles = staleCycles + 1
            if staleCycles >= 4 then
                statusLine("waiting for relay page (open tracker/sync_relay.html)")
            end
        end
    end
    ew.frameadvance()
end
