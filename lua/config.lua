ShareConfig = {}

function ShareConfig.load(filename)
    local fh = io.open(filename, "r")
    if not fh then
        return nil, "config file not found: " .. filename
    end
    local cfg = {}
    for line in fh:lines() do
        local trimmed = line:match("^%s*(.-)%s*$")
        if trimmed ~= "" and not trimmed:match("^#") then
            local key, value = trimmed:match("^([%w_]+)%s*=%s*(.-)%s*$")
            if key then
                cfg[key] = value
            end
        end
    end
    fh:close()
    if not cfg.player_name or cfg.player_name == "" then
        return nil, "share_config.txt is missing player_name"
    end
    if not cfg.worker_url or cfg.worker_url == "" then
        return nil, "share_config.txt is missing worker_url"
    end
    return cfg, nil
end
