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
