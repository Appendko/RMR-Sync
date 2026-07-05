package.path = package.path..";lua\\?.lua"
require "json"

Relay = {}

local OUTBOX_FILE = "rmrsync_out.json"
local INBOX_FILE = "rmrsync_in.json"

function Relay.writeOutbox(doc)
    local fh = io.open(OUTBOX_FILE, "w")
    if not fh then
        return false, "cannot open " .. OUTBOX_FILE .. " for writing"
    end
    fh:write(json.encode(doc))
    fh:close()
    return true, nil
end

function Relay.readInbox()
    local fh = io.open(INBOX_FILE, "r")
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
