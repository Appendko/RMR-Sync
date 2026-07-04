json = {}

local function encodeString(s)
    local out = { '"' }
    for i = 1, #s do
        local byte = s:byte(i)
        local c = s:sub(i, i)
        if c == '"' then
            out[#out + 1] = '\\"'
        elseif c == "\\" then
            out[#out + 1] = "\\\\"
        elseif c == "\n" then
            out[#out + 1] = "\\n"
        elseif c == "\r" then
            out[#out + 1] = "\\r"
        elseif c == "\t" then
            out[#out + 1] = "\\t"
        elseif byte < 0x20 then
            out[#out + 1] = string.format("\\u%04x", byte)
        else
            out[#out + 1] = c
        end
    end
    out[#out + 1] = '"'
    return table.concat(out)
end

local function encodeValue(v)
    local t = type(v)
    if t == "string" then
        return encodeString(v)
    elseif t == "number" then
        return tostring(v)
    elseif t == "boolean" then
        return v and "true" or "false"
    elseif t == "nil" then
        return "null"
    elseif t == "table" then
        local isArray = true
        local n = 0
        for k in pairs(v) do
            n = n + 1
            if type(k) ~= "number" then isArray = false end
        end
        if isArray and n == #v then
            local parts = {}
            for i = 1, #v do
                parts[i] = encodeValue(v[i])
            end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            local parts = {}
            for k, val in pairs(v) do
                parts[#parts + 1] = encodeString(tostring(k)) .. ":" .. encodeValue(val)
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    end
    error("json.encode: cannot encode type " .. t)
end

json.encode = function(v)
    return encodeValue(v)
end

local decodeValue

local function skipWhitespace(str, pos)
    local _, e = str:find("^%s*", pos)
    return e + 1
end

local function decodeString(str, pos)
    assert(str:sub(pos, pos) == '"', "expected string")
    local out = {}
    local i = pos + 1
    while true do
        local c = str:sub(i, i)
        if c == "" then error("unterminated string") end
        if c == '"' then
            return table.concat(out), i + 1
        elseif c == "\\" then
            local nextC = str:sub(i + 1, i + 1)
            local escapes = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
            out[#out + 1] = escapes[nextC] or nextC
            i = i + 2
        else
            out[#out + 1] = c
            i = i + 1
        end
    end
end

local function decodeNumber(str, pos)
    local s, e = str:find("^%-?%d+%.?%d*[eE]?[%+%-]?%d*", pos)
    return tonumber(str:sub(s, e)), e + 1
end

local function decodeArray(str, pos)
    local arr = {}
    local i = skipWhitespace(str, pos + 1)
    if str:sub(i, i) == "]" then return arr, i + 1 end
    while true do
        local value
        value, i = decodeValue(str, i)
        arr[#arr + 1] = value
        i = skipWhitespace(str, i)
        local c = str:sub(i, i)
        if c == "]" then return arr, i + 1 end
        assert(c == ",", "expected , or ] in array")
        i = skipWhitespace(str, i + 1)
    end
end

local function decodeObject(str, pos)
    local obj = {}
    local i = skipWhitespace(str, pos + 1)
    if str:sub(i, i) == "}" then return obj, i + 1 end
    while true do
        i = skipWhitespace(str, i)
        local key
        key, i = decodeString(str, i)
        i = skipWhitespace(str, i)
        assert(str:sub(i, i) == ":", "expected : in object")
        i = skipWhitespace(str, i + 1)
        local value
        value, i = decodeValue(str, i)
        obj[key] = value
        i = skipWhitespace(str, i)
        local c = str:sub(i, i)
        if c == "}" then return obj, i + 1 end
        assert(c == ",", "expected , or } in object")
        i = skipWhitespace(str, i + 1)
    end
end

decodeValue = function(str, pos)
    local i = skipWhitespace(str, pos)
    local c = str:sub(i, i)
    if c == '"' then
        return decodeString(str, i)
    elseif c == "{" then
        return decodeObject(str, i)
    elseif c == "[" then
        return decodeArray(str, i)
    elseif str:sub(i, i + 3) == "true" then
        return true, i + 4
    elseif str:sub(i, i + 4) == "false" then
        return false, i + 5
    elseif str:sub(i, i + 3) == "null" then
        return nil, i + 4
    else
        return decodeNumber(str, i)
    end
end

json.decode = function(str)
    return decodeValue(str, 1)
end
