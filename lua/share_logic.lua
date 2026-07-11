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
