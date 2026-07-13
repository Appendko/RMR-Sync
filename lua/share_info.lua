-- Load this script after boot.lua has finished booting into gameplay
-- (not during the boot/boss-select screen). No special BizHawk launch
-- flags are needed -- this script never touches comm.http*; all networking
-- is relayed through tracker/sync_relay.html (Task 16) via local files.

-- All the actual logic lives in a lib/ subfolder next to this script itself
-- (kept out of this top-level folder so a player only ever sees this one
-- script + share_config.txt). Deliberately NOT cwd-relative: BizHawk's Lua
-- console runs with cwd set to its own EmuHawk.exe install directory, not
-- wherever this script (dragged in from the player's ROM folder, possibly
-- renamed from "lua" to anything else) actually lives -- a cwd-relative
-- "lua\lib\?.lua" guess would only ever find a lib/ folder sitting next to
-- EmuHawk.exe itself. Instead, derive our own directory from this chunk's
-- own source path (debug.getinfo), which BizHawk always sets to the
-- absolute path it was loaded from, regardless of cwd or folder name.
local scriptSource = debug.getinfo(1, "S").source
local scriptDir = scriptSource:match("^@?(.*)[\\/]") or "."
package.path = package.path..";"..scriptDir.."\\lib\\?.lua"
require "json"
require "file_relay"
require "share_logic"
require "config"

-- boot.lua, share_config.txt, and the outbox/inbox relay files all live one
-- directory up from this script (this script itself lives in its own
-- subfolder -- named "lua" by default, but players are free to rename it,
-- e.g. to "sync", since scriptDir above never assumed a fixed name).
-- Same cwd-independence reasoning as scriptDir: BizHawk's actual cwd is its
-- own install directory, not the player's ROM folder, so these must be
-- absolute paths built from scriptDir, never bare relative filenames.
local gameDir = scriptDir:match("^(.*)[\\/]") or "."

local cChecksPerTitle = 0x20
local addrChecksSeen = 0x7FFF80
local addrItems = 0x7FFF00
local addrLastProgressFrame = 0x7E0244
local cItems = 0x60
-- ref/aaa/boot.lua's own "whole game beaten" flag address, kept per-title in
-- sessionSave.titleValue (see readGameClearFlags below) -- not a WRAM
-- address we read directly ourselves, just the key boot.lua's own
-- keep-if-greater sync loop uses to index into each title's table.
local addrTitleValueClear = 0x7FFFCF
-- Synthetic check ids (see tracker/check_id_map.js's matching comment) for
-- "title N fully cleared", reported through the same `checks` event field
-- as real check completions -- index 1/2/3 for X1/X2/X3.
local cCheckIdGameClear = {900, 901, 902}
-- Synthetic id for "all 3 titles cleared", ref/aaa/boot.lua's own "All
-- Clear" milestone.
local cCheckIdGameClearAll = 903
-- Matches ref/aaa/boot.lua's own addrMultiworldInfo table exactly: a per-game,
-- ROM-resident (not RAM/progress-dependent) address whose +0 byte encodes
-- which of the 3 titles this seed actually randomizes (see readRandomizedGames
-- below, bits 0x10/0x20/0x40 -- exactly boot.lua's own sessionInfo.randomizedGame
-- derivation, re-read independently since sessionInfo is local to boot.lua's
-- own chunk and not reachable from here) and whose +1/+2 bytes encode this
-- seed's own settings for which item categories are configured as shared
-- across all 3 games (see readShareFlags below). Static for the whole
-- session, so it's safe to read once.
local addrMultiworldInfo = {0xBFFDD0, 0xBFFDD0, 0xCFFDD0}
-- ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/
-- RMR_progress_tracker.lua's own addresses, reused verbatim (see design spec
-- decision 5/"Reference material"): a single global IFG-use counter, and a
-- per-title death counter only meaningful for whichever title is currently
-- active (same limitation that reference script has -- it never caches
-- other titles' death counts while inactive).
local addrIFG = 0x7FFFAE
local addrDeathByTitle = { 0x7E1F80, 0x7E1FB3, 0x7E1FB4 }
-- ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/
-- RMR_progress_tracker.lua's own address for the checks array, distinct
-- from addrChecksSeen -- like addrChecksSeen, a shared, per-active-title RAM
-- window (only the currently active title's slice is live), used here only
-- for the one deliberate exception below (writeVavaStageKeyCheck).
local addrChecks = 0x7FFF60
-- Check 736 (3ChKeyVavaStage, tracker/check_id_map.js) -- confirmed live
-- (seen in an actual checks diff capture) and cross-referenced against the
-- randomizer's own C# source (hAppendVavaStageKeyIntoCheckSequence appends
-- check 0x3E0, 1-indexed-by-title in the C#'s own numbering; translated to
-- this project's 0-indexed scheme: (3-1)*256 + (0x3E0 & 0xFF) = 736).
-- Deliberately NOT added to ShareLogic.isEventCheckId -- kept in sync with
-- item 572 purely locally (see checkForVavaStageKeyOwned/
-- writeVavaStageKeyCheck below), never reported anywhere.
local cVavaStageKeyCheckByte = 92 -- floor(736 / 8), flat byte index in the 96-byte checks array
local cVavaStageKeyCheckMask = 0x01 -- 736 % 8
local cVavaStageKeyCheckTitle = 3 -- X3
local cVavaStageKeyCheckTitleByte = cVavaStageKeyCheckByte - (cVavaStageKeyCheckTitle - 1) * cChecksPerTitle -- 92 - 64 = 28
-- Item 572 (3ItKeyVavaStage, pages/tracker/item_id_map.js) -- addrItems is
-- already a flat, all-3-titles-simultaneously region (see writeMergedItems
-- below), so no title-gating is needed to read it, unlike the check write.
local cVavaStageKeyItemByte = 71 -- floor(572 / 8)
local cVavaStageKeyItemMask = 0x10 -- 572 % 8
local cItemCheckFrames = 12 -- ~0.2s at 60fps: cheap RAM-only check for newly-acquired items; can trigger an early outbox write ahead of the heartbeat
local cWaitFrames = 600 -- ~10s at 60fps: idle-only heartbeat (pulls others' checksSeen updates when nothing local has triggered a request) -- deliberately slow to reduce Worker/Durable-Object request volume for a real multi-player session; checksSeen sync has no real latency requirement
local cStaleThreshold = 20 -- ~20 fast-cycles * ~0.2s = ~4s of genuine unresponsiveness before warning, matching the original user-facing timing despite ack-checking now running on the fast timer instead of the (now much slower) idle heartbeat
local cInitBurstThreshold = 6 -- entering a title for the first time auto-initializes several item bits at once (observed ~8); a batch this size or larger is treated as initialization noise, not a real pickup, and isn't reported to the event feed

local function currentTitle()
    local tmp = cpu[0x80FFC9] - 0x30
    if tmp < 0 then tmp = 1 end
    return tmp
end

-- Reads this seed's own "shared across all 3 games" settings for the item
-- categories that ref/aaa/boot.lua actually acts on (its shareSpecialWeapon and
-- shareStageKey bits exist in the byte layout but are commented out/unused in
-- boot.lua itself, so boss weapons/keys are never really shared -- omitted here
-- to match actual game behavior). Bit layout confirmed against boot.lua's own
-- decoding of the same two bytes.
local function readShareFlags()
    local base = addrMultiworldInfo[currentTitle()]
    local shareInfo1 = cpu[base + 1]
    local shareInfo2 = cpu[base + 2]
    return {
        lifeUp = (shareInfo1 & 0x80) ~= 0,
        energyUp = (shareInfo1 & 0x40) ~= 0,
        armor = (shareInfo1 & 0x20) ~= 0,
        subTank = (shareInfo1 & 0x10) ~= 0,
        finalWeapon = (shareInfo1 & 0x02) ~= 0,
        sigmaKey = (shareInfo1 & 0x01) ~= 0,
        upgradeItem = (shareInfo2 & 0x80) ~= 0,
    }
end

-- Which of the 3 titles this seed actually randomizes -- independently
-- re-derives ref/aaa/boot.lua's own sessionInfo.randomizedGame (bits
-- 0x10/0x20/0x40 of the same multiworldValue byte boot.lua itself reads at
-- addrMultiworldInfo[title]) since sessionInfo is local to boot.lua's own
-- chunk. Static ROM data for the whole session, same as shareFlags -- read
-- once. Read from title 1's own copy: boot.lua's own load-time validation
-- (its "Incorrect .smc(game selection)" check) already requires every
-- title's copy of this byte to agree, so any one of the 3 addresses works.
local function readRandomizedGames()
    local multiworldValue = cpu[addrMultiworldInfo[1]]
    local randomized = {}
    for title = 1, 3 do
        randomized[title] = (multiworldValue & (0x10 << (title - 1))) ~= 0
    end
    return randomized
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

-- Unlike writeChecksSeen, no currentTitle()/baseOffset slicing is needed:
-- addrItems is already a flat, all-3-titles-simultaneously region (per
-- boot.lua's own "全タイトル分" comment), so this is a straight 96-byte
-- OR-loop. Written into both sessionSave.items (so a later, unrelated
-- title switch doesn't lose it when boot.lua restores addrItems from its
-- own sessionSave.items) and live RAM (immediate effect, confirmed
-- sufficient by direct BizHawk testing: manually OR-ing a title's own item
-- bit into WRAM after switching to it, with no reboot involved, was enough
-- for the game to recognize the item as owned).
local function writeMergedItems(merged, forceOverwrite)
    for i = 0, 95 do
        if forceOverwrite then
            sessionSave.items[i] = merged[i + 1]
            cpu[addrItems + i] = merged[i + 1]
        else
            sessionSave.items[i] = (sessionSave.items[i] or 0) | merged[i + 1]
            cpu[addrItems + i] = cpu[addrItems + i] | merged[i + 1]
        end
    end
end

-- Deliberate, narrow exception to "checks are never synced back" (see the
-- long comment above readChecks() for why that rule exists in general):
-- item 572 (3ItKeyVavaStage) and its corresponding check 736 are a fixed,
-- non-randomized pair (not shuffled into the randomizer's own item/check
-- pool the way a normal check/item is), so every player's copy of this one
-- specific check means exactly the same thing -- writing it back carries
-- none of the "a teammate's progress in a title I haven't touched
-- incorrectly advances my own hint pointer" risk that motivated the general
-- rule. Same write-shape as writeChecksSeen: unconditional in
-- sessionSave.checks (our own all-titles bookkeeping cache), RAM only while
-- title 3 is currently active (addrChecks, like addrChecksSeen, is a
-- shared per-active-title window). OR-only (never overwrites), matching
-- how boot.lua's own synchronize_or treats this array as set-only/monotonic.
local function writeVavaStageKeyCheck()
    sessionSave.checks[cVavaStageKeyCheckByte] = (sessionSave.checks[cVavaStageKeyCheckByte] or 0) | cVavaStageKeyCheckMask
    if currentTitle() == cVavaStageKeyCheckTitle then
        cpu[addrChecks + cVavaStageKeyCheckTitleByte] = cpu[addrChecks + cVavaStageKeyCheckTitleByte] | cVavaStageKeyCheckMask
    end
end

local function readItems()
    local arr = {}
    for i = 0, cItems - 1 do
        arr[i + 1] = cpu[addrItems + i]
    end
    return arr
end

local function readChecks()
    local arr = {}
    for i = 0, 95 do
        arr[i + 1] = sessionSave.checks[i] or 0
    end
    return arr
end

-- checksSeen/items *are* written back locally (writeChecksSeen/writeMergedItems
-- above) because nothing else in ref/aaa/boot.lua reads sessionSave.checksSeen
-- or sessionSave.items except the game itself restoring its own state -- so a
-- merge is the only way a teammate's discovery/pickup ever reaches the local
-- game. Real check-completion progress (sessionSave.checks) is different, and
-- deliberately NOT synced/merged at all (no writeChecks(), no full-array
-- upload, no room-level merged state):
--   1. ref/aaa/boot.lua's own synchronizeHintInfo() reads sessionSave.checks
--      directly (not RAM) to advance addrHintOffset for the two titles NOT
--      currently active -- writing a merged, cross-player array into it
--      would make this player's own in-game hint pointer advance based on a
--      teammate's progress in a title this player hasn't personally
--      touched, a real (and wrong) gameplay side effect.
--   2. There is no code path that reads sessionSave.checks back into "is
--      this boss actually defeated" for the active title (that's driven by
--      the game's own RAM, refreshed into sessionSave.checks one-way by
--      boot.lua's own synchronize_or) -- so merging could never grant a
--      teammate's boss-defeat to this player anyway.
--   3. A "check" is really two different things: a *location* (a
--      randomized pickup spot -- after randomization it holds a different
--      item, so its completion is just item ownership, already covered by
--      the items merge) and an *event* (a stage clear or boss defeat --
--      still the same achievement regardless of randomization). Only the
--      event subset (ShareLogic.isEventCheckId, checkForNewChecks below) is
--      worth announcing to teammates; syncing the full location bitfield
--      would just be re-deriving item-ownership info a second, redundant way.
-- readChecks() below is used purely as the local diffing baseline for
-- checkForNewChecks()'s event detection -- it is never sent over the wire.

local cfg, cfgErr = ShareConfig.load(gameDir.."\\share_config.txt")
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
-- Read once: this seed's own sharing settings are static ROM data for the
-- whole session, not something that changes as the player progresses.
local shareFlags = readShareFlags()
-- Read once, same reasoning: which titles this seed randomizes never
-- changes mid-session.
local randomizedGames = readRandomizedGames()
local seq = 0
local outstandingSeq = nil
local pendingEvents = {}
local shareMode = nil
local previousItems = nil
local previousChecks = nil
local previousProgressFrame = nil
local previousGameClear = nil
local previousAllClear = nil
local previousIfg = nil
local previousDeathByTitle = { nil, nil, nil }
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
    local msg = Relay.readInbox(gameDir)
    if not ShareLogic.isResponseFor(msg, session, outstandingSeq) then
        return
    end
    if msg.ok and msg.sync then
        shareMode = msg.sync.mode
        local forceOverwrite = ShareLogic.shouldForceOverwrite(msg.sync.epoch, knownEpoch)
        knownEpoch = msg.sync.epoch
        writeChecksSeen(msg.sync.checksSeen, forceOverwrite)
        if msg.sync.mergedItems then
            writeMergedItems(msg.sync.mergedItems, forceOverwrite)
            -- Resync the diffing baseline to the real post-merge state, so
            -- checkForNewItems() doesn't mistake a merge that just landed for
            -- a genuine local pickup and report it as "this player got X" --
            -- only real gameplay after this point should ever be reported.
            previousItems = readItems()
        end
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
        sync = { checksSeen = readChecksSeen(), items = readItems(), epoch = knownEpoch, shareFlags = shareFlags },
        events = pendingEvents,
    }, gameDir)
end

-- Checked far more often than the routine heartbeat (see cItemCheckFrames) since
-- this is just a cheap RAM read/diff, no I/O. The moment a new item is detected,
-- fire a fresh outbox write immediately rather than waiting for the next
-- heartbeat cycle -- this is what makes item-pickup events show up quickly.
-- Safe to supersede an already-outstanding request: the old request's eventual
-- (now-stale) response will be ignored by ShareLogic.isResponseFor, since its
-- seq will no longer match the new outstandingSeq this function just set.
local function checkForNewItems()
    if shareMode ~= "checksSeen+shared" and shareMode ~= "checksSeen+items" then
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
        if ShareLogic.shouldReportAcquired(#acquired, cInitBurstThreshold) then
            table.insert(pendingEvents, { game = currentTitle(), items = acquired })
            issueRequest()
        end
    end
    previousItems = items
end

-- Structural copy of checkForNewItems, tracking real check completion
-- instead of item pickups -- but unlike items, this never merges/syncs
-- anything across the network (see the comment above readChecks() writer
-- removal further up): checks are read purely locally and, when a newly
-- completed check is an "event" (ShareLogic.isEventCheckId -- a stage clear
-- or boss defeat, not a plain randomized-item location), reported to the
-- event feed so other players see "PlayerA cleared Storm Eagle!" etc. Runs
-- in all 3 modes -- unlike items, this has nothing to do with which item
-- categories this room shares, so it isn't gated by shareMode at all.
--
-- Deliberately NOT gated by addrLastProgressFrame the way checkForNewItems
-- is: live testing showed that counter doesn't reliably advance on a boss
-- defeat by itself, only on item-related progress -- gating on it left a
-- real check completion sitting silently detected-but-unreported until an
-- unrelated item pickup happened to also bump the counter, sometimes
-- minutes later. checks (sessionSave.checks) are also set-only/monotonic
-- (boot.lua's own synchronize_or only ever ORs bits in, never clears them),
-- unlike items' raw bytes -- so there's no equivalent "unstable
-- intermediate value" risk to guard against by waiting for a stability
-- signal; reading and diffing the same 96 bytes every poll cycle
-- (~0.2s, cItemCheckFrames) is cheap and always safe.
local function checkForNewChecks()
    local checksNow = readChecks()
    if previousChecks then
        local acquired = ShareLogic.diffNewBits(previousChecks, checksNow)
        -- Burst-suppression is checked against the full diff (matching
        -- items), not just the event-filtered subset, so an init burst
        -- doesn't get chopped down to "under threshold" by filtering first.
        if ShareLogic.shouldReportAcquired(#acquired, cInitBurstThreshold) then
            local eventChecks = {}
            for _, id in ipairs(acquired) do
                if ShareLogic.isEventCheckId(id) then
                    table.insert(eventChecks, id)
                end
            end
            -- A batch that's entirely plain-location checks (no event ids)
            -- has nothing worth announcing -- randomized-item ownership is
            -- already covered by the items merge, not this local-only path.
            if #eventChecks > 0 then
                table.insert(pendingEvents, { game = currentTitle(), checks = eventChecks })
                issueRequest()
            end
        end
    end
    previousChecks = checksNow
end

-- Reads ref/aaa/boot.lua's per-title "whole game beaten" byte for all 3
-- titles at once. Like readChecks()/readChecksSeen(), no currentTitle()
-- branching is needed: sessionSave.titleValue[title] is refreshed from RAM
-- every frame while that title is active (boot.lua's own "keep the higher
-- value" loop) and simply holds the last-known value for inactive titles --
-- exactly the same one-way, always-readable pattern checks/checksSeen use.
-- A title sessionSave.titleValue has never touched at all is nil, treated
-- as 0 (not cleared).
local function readGameClearFlags()
    local flags = {}
    for title = 1, 3 do
        local titleValue = sessionSave.titleValue[title]
        local raw = (titleValue and titleValue[addrTitleValueClear]) or 0
        flags[title] = ShareLogic.isGameCleared(raw)
    end
    return flags
end

-- Reports a player finishing a title's whole story (not a single stage) as
-- a one-off milestone event, through the same `checks` event field
-- checkForNewChecks uses -- see the synthetic ids in tracker/check_id_map.js
-- for why this reuses that field instead of inventing a new one. Never
-- synced/merged (same reasoning as real checks): this is a local read-only
-- observation, reported once per newly-true transition. No burst-suppression
-- needed -- unlike a 96-byte bit diff, this is 3 booleans, and there's no
-- "game just initialized" false-positive risk to guard against.
--
-- Also reports the "all 3 titles cleared" milestone the same way, id 903 --
-- ref/aaa/boot.lua's own cMS_queryClearStatus allClear condition, faithfully
-- reproduced: only titles randomizedGames[title] marks as actually part of
-- this seed can block all-clear, exactly matching boot.lua's own
-- "if sessionInfo.randomizedGame[title] then check tmpValue ... end" loop --
-- a seed that only randomizes 1 or 2 titles reports All Clear as soon as
-- those are done, without waiting on an untouched title that was never in
-- play. sessionSave.clearFrames is boot.lua's own frozen play-frame count
-- from the moment allClear first became true (synced the same "keep the
-- higher value" way as its live counterpart addrPlayFrames0/1) -- read here
-- purely to format and report it, never written.
local function checkForNewGameClear()
    local flagsNow = readGameClearFlags()
    if previousGameClear then
        for title = 1, 3 do
            if flagsNow[title] and not previousGameClear[title] then
                table.insert(pendingEvents, { game = title, checks = { cCheckIdGameClear[title] } })
                issueRequest()
            end
        end
    end
    previousGameClear = flagsNow

    local allClearNow = true
    for title = 1, 3 do
        if randomizedGames[title] and not flagsNow[title] then
            allClearNow = false
        end
    end
    if previousAllClear ~= nil and allClearNow and not previousAllClear then
        local clearTime = ShareLogic.formatClearTime(sessionSave.clearFrames or 0)
        table.insert(pendingEvents, { game = currentTitle(), checks = { cCheckIdGameClearAll }, gameClearTime = clearTime })
        issueRequest()
    end
    previousAllClear = allClearNow
end

-- Reports IFG (Invincible Frame Generator) usage as a one-off event each
-- time the game's own usage counter increases -- see design spec decision 5
-- and ref/rmr_option.html for what IFG is. Global, not per-title (addrIFG is
-- a single shared address). Never synced/merged, same reasoning as checks:
-- this is a local read-only observation, reported once per real increase.
local function checkForNewIfg()
    local ifgNow = cpu[addrIFG]
    local delta = ShareLogic.positiveDelta(previousIfg, ifgNow)
    if delta then
        table.insert(pendingEvents, { game = currentTitle(), ifgDelta = delta })
        issueRequest()
    end
    previousIfg = ifgNow
end

-- Structural sibling of checkForNewIfg, tracking each title's own death
-- counter instead -- only the currently-active title's address is
-- meaningful (see addrDeathByTitle above), so previousDeathByTitle keeps one
-- baseline per title, updated only for whichever title is active this poll
-- cycle, so switching titles never produces a false jump.
local function checkForNewDeaths()
    local title = currentTitle()
    local deathsNow = cpu[addrDeathByTitle[title]]
    local delta = ShareLogic.positiveDelta(previousDeathByTitle[title], deathsNow)
    if delta then
        table.insert(pendingEvents, { game = title, deathDelta = delta })
        issueRequest()
    end
    previousDeathByTitle[title] = deathsNow
end

-- Local-only, single-player consistency fix, no server round-trip at all:
-- whenever this player's own item 572 (3ItKeyVavaStage) bit is set in RAM --
-- from a real local pickup, or from a cross-player merge grant, it makes no
-- difference which -- also set check 736 (3ChKeyVavaStage) to match (see
-- writeVavaStageKeyCheck's own comment for why writing this one specific
-- check back is safe). The Vava-stage teleporter disappearing the moment a
-- player owns the key is expected, correct behavior, not something this
-- guards against -- it just keeps the check flag truthful about it. Cheap
-- and idempotent (OR-only), so no need to gate this on a diff/baseline the
-- way the reporting-to-server checks above do -- there's nothing to report
-- or de-duplicate, just a bit to keep in sync every cycle.
local function checkForVavaStageKeyOwned()
    if (cpu[addrItems + cVavaStageKeyItemByte] & cVavaStageKeyItemMask) ~= 0 then
        writeVavaStageKeyCheck()
    end
end

while true do
    itemCheckFrames = itemCheckFrames - 1
    if itemCheckFrames <= 0 then
        itemCheckFrames = cItemCheckFrames
        tryConsumeInbox()
        checkForNewItems()
        checkForNewChecks()
        checkForNewGameClear()
        checkForNewIfg()
        checkForNewDeaths()
        checkForVavaStageKeyOwned()
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
