// Shared check-name resolution, used by both check_audit.html (authoring)
// and event_feed.html (live display). Mirrors icon_map.js's role for items,
// but far simpler: no game-tag prefix, no icon lookup, no M-prefix
// cross-reference -- checks have none of those concepts.
const CHECK_NAME_TABLES = { en: CHECK_NAMES_EN, ja: CHECK_NAMES_JA, "zh-TW": CHECK_NAMES_ZHTW };

// Returns { name, isFallback }. isFallback is true when no localized name has
// been authored yet for this id/language, so callers can flag it visually
// (matching icon_map.js's own fallback-flagging convention for items).
function getCheckNameInfo(checkId, lang) {
  const table = CHECK_NAME_TABLES[lang];
  if (table && table[checkId] !== undefined) {
    return { name: table[checkId], isFallback: false };
  }
  // No localized name authored yet -- fall back to the raw ported short
  // code (e.g. "1ChAASubtank") so something readable shows regardless.
  return { name: CHECK_ID_MAP[checkId] ?? `check ${checkId}`, isFallback: true };
}

function getCheckNameForId(checkId, lang) {
  return getCheckNameInfo(checkId, lang).name;
}
