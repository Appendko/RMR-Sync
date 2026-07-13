-- Pure decision logic with no BizHawk dependency (no cpu/ew/comm/sessionSave
-- references), so it can be tested standalone. All bit tests use native Lua
-- 5.3+ operators (&, |, <<) -- BizHawk's Lua fully supports these directly
-- (confirmed by boot.lua's own usage); there is no need for a bit.* shim.

ShareLogic = {}

-- Returns a list of newly-set bit offsets (0-based) where `after` has a bit
-- set that `before` didn't, scanning byte-by-byte (1-indexed arrays in,
-- matching how share_info.lua reads RAM into plain Lua tables).
function ShareLogic.diffNewBits(before, after)
    local acquired = {}
    for i = 1, #after do
        local b = before[i] or 0
        local a = after[i] or 0
        if a ~= b then
            for bit = 0, 7 do
                local mask = 1 << bit
                if (b & mask) == 0 and (a & mask) ~= 0 then
                    table.insert(acquired, (i - 1) * 8 + bit)
                end
            end
        end
    end
    return acquired
end

-- Does this inbox message answer the request we're currently waiting on?
function ShareLogic.isResponseFor(msg, session, outstandingSeq)
    return msg ~= nil and msg.session == session and msg.seq == outstandingSeq
end

-- Given the epoch reported in a sync response and the last epoch we knew
-- about, should checksSeen be force-overwritten (a reset happened) instead
-- of OR-folded?
function ShareLogic.shouldForceOverwrite(responseEpoch, knownEpoch)
    return responseEpoch > knownEpoch
end

-- Should a batch of `count` simultaneously-acquired items be reported to the
-- event feed? Entering a title for the first time auto-initializes several
-- item bits at once, which looks identical to a real multi-item pickup from
-- a raw bit diff alone -- a count threshold is the only signal available to
-- tell "the game just initialized a fresh title" apart from "the player
-- genuinely picked up a few things at once".
function ShareLogic.shouldReportAcquired(count, threshold)
    return count > 0 and count < threshold
end

-- Global check ids (see tracker/check_id_map.js's own CHECK_ID_MAP, same
-- indexing) that are "events" rather than "locations": per-stage Stage Clear
-- flags and the 5 one-off boss-defeat flags (Bit, Byte, and the X-Hunters
-- Violen/Serges/Agile). Everything else -- life capsules, sub tanks, armor
-- parts, weapon energy, Ride Armor pickups, Hadouken/Shoryuken/Z-Saber/Hyper
-- Chip -- is a "location": after randomization it holds a different item,
-- so its completion state is about item ownership (already covered by the
-- items merge), not a stand-alone achievement worth announcing. Kept as a
-- static id list (not derived from a naming convention) because Lua has no
-- access to CHECK_ID_MAP's short codes -- mirrored 1:1 in
-- tracker/check_id_map.js's own EVENT_CHECK_IDS; keep both in sync if this
-- ever needs revisiting.
local EVENT_CHECK_IDS = {
    [240] = true, [241] = true, [242] = true, [243] = true, [244] = true,
    [245] = true, [246] = true, [247] = true, [248] = true, [249] = true,
    [250] = true, [251] = true,
    [493] = true, [494] = true, [495] = true,
    [496] = true, [497] = true, [498] = true, [499] = true, [500] = true,
    [501] = true, [502] = true, [503] = true, [504] = true, [505] = true,
    [506] = true, [507] = true, [508] = true,
    [750] = true, [751] = true,
    [752] = true, [753] = true, [754] = true, [755] = true, [756] = true,
    [757] = true, [758] = true, [759] = true, [760] = true, [761] = true,
    [762] = true, [763] = true, [764] = true, [765] = true, [766] = true,
    -- Synthetic "whole game beaten" ids (see ShareLogic.isGameCleared /
    -- share_info.lua's checkForNewGameClear) -- not real check bits, but
    -- events in every sense that matters here. 903 is the "all 3 titles
    -- cleared" milestone (see ShareLogic.formatClearTime).
    [900] = true, [901] = true, [902] = true, [903] = true,
}

-- Is this global check id an "event" (stage clear / boss defeat) rather than
-- a plain item-pickup location? Used to filter real check-completion diffs
-- down to only the ids worth announcing in the event feed.
function ShareLogic.isEventCheckId(id)
    return EVENT_CHECK_IDS[id] == true
end

-- ref/aaa/boot.lua's own "whole game beaten" flag: a per-title byte kept in
-- sessionSave.titleValue[title][0x7FFFCF] (the same "keep the higher value,
-- only the active title refreshes it" pattern checks/checksSeen use), read
-- as >= 0x80 meaning "this title's story is complete" -- matches boot.lua's
-- own cMS_queryClearStatus check exactly.
function ShareLogic.isGameCleared(rawValue)
    return rawValue >= 0x80
end

-- Converts a frame count into ref/aaa/boot.lua's own "H:MM:SS" display
-- format (its getHMMSS, called on sessionSave.clearFrames -- the play-frame
-- count frozen the moment all 3 titles first became cleared, itself synced
-- the same "keep the higher value" way as clearFrames' own live counterpart
-- addrPlayFrames0/1). Uses a flat 60 frames/second conversion, matching
-- boot.lua's own approximation (not the true NTSC ~60.0988Hz rate) -- this
-- must match what boot.lua already shows the player on the boss-select
-- screen, not be more "correct" than it.
function ShareLogic.formatClearTime(frames)
    local totalSeconds = math.floor(frames / 60)
    local seconds = totalSeconds % 60
    local totalMinutes = math.floor(totalSeconds / 60)
    local minutes = totalMinutes % 60
    local hours = math.floor(totalMinutes / 60) % 60
    return string.format("%d:%02d:%02d", hours, minutes, seconds)
end

-- Returns the positive increase from `before` to `after`, or nil if there's
-- no prior baseline yet (`before` is nil, meaning this is the first read
-- this session) or the value didn't increase. Used for monotonic RAM
-- counters (deaths, IFG uses) where any real change is always an increase --
-- a decrease would mean `before` was stale/never actually observed, not a
-- real decrease.
function ShareLogic.positiveDelta(before, after)
    if before == nil or after <= before then
        return nil
    end
    return after - before
end

-- Extracts the randomizer's unique Base64 seed value from a full Option
-- string, so the room key stays short and stable even when boot.lua's
-- own 128-byte ROM-read cap truncates sessionSave.param for an unusually
-- long Option string (many non-default settings). Falls back to the
-- original string unchanged if the expected "S<base64>" segment isn't
-- found, so an unexpected format degrades gracefully.
function ShareLogic.extractSeedKey(optionString)
    for segment in optionString:gmatch("[^#]+") do
        local seed = segment:match("^S([%w%+/]+)$")
        if seed then
            return seed
        end
    end
    return optionString
end
