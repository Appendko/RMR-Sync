// Shared check-name/icon resolution, used by both check_audit.html
// (authoring) and event_feed.html (live display). Mirrors icon_map.js's role
// for items, but simpler for names: no game-tag prefix, no M-prefix
// cross-reference -- checks have neither concept.
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

// Global check id -> dedicated event art: boss portraits (ref/RMR_progress_
// tracker_displayer_ver_js_20260126/progress_tracker_assets/*bosses*.png,
// plus hand-prepared sub-boss portraits for mid-bosses with no ready-made
// asset in ref/) for stage clears, or a title logo for the synthetic
// game-clear/all-clear ids -- NOT the weapon icon icon_map.js shows for
// picking up that boss's weapon item; "defeated Storm Eagle" and "picked up
// Storm Eagle's weapon" are different events and deliberately look
// different. Reuses icon_map.js's own BOSS_CODE_MAP (2-letter check code ->
// asset-file code) for the 24 main Mavericks so the two tables never drift
// apart.
const CHECK_BOSS_PORTRAIT_FILE = {};
for (const game of [1, 2, 3]) {
  for (const [bossCode, assetCode] of Object.entries(BOSS_CODE_MAP[game])) {
    // Reverse-derive the check id from CHECK_ID_MAP's own "<game>Ch<bossCode>Clear"
    // short code, rather than hand-copying 24 ids a second time.
    const shortCode = `${game}Ch${bossCode}Clear`;
    for (const [idStr, code] of Object.entries(CHECK_ID_MAP)) {
      if (code === shortCode) {
        CHECK_BOSS_PORTRAIT_FILE[Number(idStr)] = `assets/x${game}_bosses_${assetCode}.png`;
      }
    }
  }
}
Object.assign(CHECK_BOSS_PORTRAIT_FILE, {
  // Per-game "OP" opening-stage clears.
  240: "assets/x1_bosses_intro.png", 496: "assets/x2_bosses_intro.png", 752: "assets/x3_bosses_intro.png",

  // Bit, Byte, Vile.
  750: "assets/x3_subbosses_bff.png", 751: "assets/x3_subbosses_mbb.png", 761: "assets/x3_subbosses_vava.png",

  // X1 Sigma stages 1-3: Bospider, Rangda Bangda, D-Rex -- this hack's own
  // Sigma-fortress mid-bosses, not in any ref/ asset set.
  249: "assets/x1_subbosses_bsp.png", 250: "assets/x1_subbosses_rgb.png", 251: "assets/x1_subbosses_drx.png",

  // The X-Hunters (Violen/Serges/Agile) -- both their first defeat (493-495)
  // and their Sigma-stage 1-3 refight (505-507) reuse the same 3 portraits,
  // since it's the same character both times.
  493: "assets/x2_subbosses_vio.png", 494: "assets/x2_subbosses_srg.png", 495: "assets/x2_subbosses_agl.png",
  505: "assets/x2_subbosses_vio.png", 506: "assets/x2_subbosses_srg.png", 507: "assets/x2_subbosses_agl.png",
  // Stage 4: the 8-Maverick refight itself, not a single boss -- its own
  // dedicated "refight" art rather than any one Maverick's portrait.
  508: "assets/x2_bosses_refight.png",

  // X3 Sigma stages, per this hack's own mid-boss lineup (762=S1a, 763=S2a,
  // 764=S3, 765=S1b, 766=S2b -- the a/b ordering per stage is the owner's
  // best guess, easy to swap if it turns out reversed). 763 is Vila refought
  // here too, but with a distinct second portrait (vava2) from his own
  // dedicated-stage clear (761's vava.png) -- presumably a different
  // form/appearance for this encounter.
  762: "assets/x3_subbosses_gko.png", 765: "assets/x3_subbosses_pd.png",
  763: "assets/x3_subbosses_vava2.png", 766: "assets/x3_subbosses_vk.png",
  764: "assets/x3_subbosses_dop.png",

  // Synthetic game-clear/all-clear ids (see ShareLogic.isGameCleared /
  // lua/share_info.lua's checkForNewGameClear) -- these represent a whole
  // title being cleared, not a specific boss, so each gets that title's own
  // logo icon instead of a boss portrait.
  900: "assets/title_x1.ico", 901: "assets/title_x2.ico", 902: "assets/title_x3.ico",
  903: "assets/title_x123.ico",
});

// Boss portraits are always dedicated files, never sprite-sheet slices
// (unlike items, which try a sprite position first) -- so event_feed.js
// renders every check icon via this <img>-only path, with no sprite-vs-file
// branch to take.
function getCheckIconInfoForId(checkId) {
  const file = CHECK_BOSS_PORTRAIT_FILE[checkId];
  return { file: file ?? GENERIC_ICON, label: getCheckNameForId(checkId, "en") };
}
