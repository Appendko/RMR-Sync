package.path = package.path..";lua\\?.lua"
require "json"
require "file_relay"

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(label .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
    end
end

-- writeOutbox produces a file readInbox-compatible JSON can decode back
local ok, err = Relay.writeOutbox({ session = "abc123", seq = 1, sync = { checksSeen = {0, 1, 2}, epoch = 0 } })
assertEqual(ok, true, "writeOutbox ok")
assertEqual(err, nil, "writeOutbox err")

local fh = io.open("rmrsync_out.json", "r")
local raw = fh:read("*a")
fh:close()
local decoded = json.decode(raw)
assertEqual(decoded.session, "abc123", "outbox session round-trip")
assertEqual(decoded.seq, 1, "outbox seq round-trip")
assertEqual(decoded.sync.checksSeen[1], 0, "outbox checksSeen[1] round-trip")
assertEqual(decoded.sync.epoch, 0, "outbox epoch round-trip")
os.remove("rmrsync_out.json")

-- readInbox: missing file -> nil, not an error
os.remove("rmrsync_in.json")
assertEqual(Relay.readInbox(), nil, "readInbox missing file")

-- readInbox: valid file -> decoded table
local fh2 = io.open("rmrsync_in.json", "w")
fh2:write('{"session":"abc123","seq":1,"ok":true,"sync":{"mode":"checksSeen","checksSeen":[1,1,0],"epoch":0},"eventsPosted":0,"error":null}')
fh2:close()
local inbox = Relay.readInbox()
assertEqual(inbox.session, "abc123", "readInbox session")
assertEqual(inbox.ok, true, "readInbox ok")
assertEqual(inbox.sync.mode, "checksSeen", "readInbox sync.mode")
assertEqual(inbox.sync.checksSeen[1], 1, "readInbox sync.checksSeen[1]")

-- readInbox: empty file -> nil, not an error
local fh3 = io.open("rmrsync_in.json", "w")
fh3:write("")
fh3:close()
assertEqual(Relay.readInbox(), nil, "readInbox empty file")

-- readInbox: torn/garbage file -> nil, not a crash
local fh4 = io.open("rmrsync_in.json", "w")
fh4:write('{"session":"abc123","seq":1,"ok":tr')  -- truncated mid-value
fh4:close()
assertEqual(Relay.readInbox(), nil, "readInbox torn file")

os.remove("rmrsync_in.json")
print("ALL PASS")
