-- No package.path setup here: this file is only ever loaded via `require`
-- from a caller (share_info.lua in production, file_relay_test.lua in
-- tests) that has already configured package.path correctly for its own
-- situation before requiring this module -- see share_info.lua's own
-- comment for why that can't be a fixed cwd-relative guess.
require "json"

Relay = {}

local OUTBOX_FILE_NAME = "rmrsync_out.json"
local INBOX_FILE_NAME = "rmrsync_in.json"

-- gameDir is the absolute path to the folder containing boot.lua (see
-- share_info.lua's own scriptDir/gameDir comment) -- these two files are
-- read/written there, NOT relative to BizHawk's own cwd, so
-- tracker/sync_relay.html (pointed at that same folder by the player) can
-- actually find them.
function Relay.writeOutbox(doc, gameDir)
    local path = gameDir .. "\\" .. OUTBOX_FILE_NAME
    local fh = io.open(path, "w")
    if not fh then
        return false, "cannot open " .. path .. " for writing"
    end
    fh:write(json.encode(doc))
    fh:close()
    return true, nil
end

function Relay.readInbox(gameDir)
    local fh = io.open(gameDir .. "\\" .. INBOX_FILE_NAME, "r")
    if not fh then
        return nil
    end
    local body = fh:read("*a")
    fh:close()
    if not body or body == "" then
        return nil
    end
    local ok, decoded = pcall(json.decode, body)
    if not ok then
        return nil
    end
    return decoded
end
