// Per-title grid layout for the team-progress panel in sync_relay.html (see
// design spec decision 7 and its "Alternatives considered" section for why
// this is fresh data rather than adapted from ref's own bundle). gameClear
// ids match lua/share_info.lua's cCheckIdGameClear (900/901/902); the "all 3
// cleared" milestone (903) is tracked once, globally, via ALL_CLEAR_CHECK_ID
// below -- not part of any single title's panel.
var TEAM_PROGRESS_LAYOUT = {
  1: {
    titleIcon: "assets/title_x1.ico",
    openingCheckId: 240,
    bossCheckIds: [241, 242, 243, 244, 245, 246, 247, 248], // LO, SC, AA, BN, SE, SM, BK, IP
    weaponIds: [40, 41, 42, 43, 44, 45, 46, 47],
    sigmaCheckIds: [249, 250, 251],
    armor: [[88, 89], [90, 91], [92, 93], [94, 95]], // Head, Arm, Body, Foot (Part id, Chip id)
    subtankIds: [36, 37, 38, 39],
    superWeaponId: 80, // Hadouken
    gameClearCheckId: 900,
  },
  2: {
    titleIcon: "assets/title_x2.ico",
    openingCheckId: 496,
    bossCheckIds: [497, 498, 499, 500, 501, 502, 503, 504], // MM, WH, BC, FS, MH, CM, SO, WA
    weaponIds: [296, 297, 298, 299, 300, 301, 302, 303],
    sigmaCheckIds: [505, 506, 507, 508], // 508 = stage-4 8-Maverick refight, no single boss
    armor: [[344, 345], [346, 347], [348, 349], [350, 351]],
    subtankIds: [292, 293, 294, 295],
    superWeaponId: 336, // Shoryuken
    gameClearCheckId: 901,
  },
  3: {
    titleIcon: "assets/title_x3.ico",
    openingCheckId: 752,
    bossCheckIds: [753, 754, 755, 756, 757, 758, 759, 760], // EH, FB, GB, AS, EN, SS, SM, ST
    weaponIds: [552, 553, 554, 555, 556, 557, 558, 559],
    sigmaCheckIds: [762, 763, 764, 765, 766], // S1a, S2a, S3, S1b, S2b
    armor: [[600, 601], [602, 603], [604, 605], [606, 607]],
    subtankIds: [548, 549, 550, 551],
    superWeaponId: 592, // Z-Saber
    gameClearCheckId: 902,
  },
};

// ref/aaa/boot.lua's own "all 3 titles cleared" milestone (lua/share_info.lua's
// cCheckIdGameClearAll) -- shown once, globally, not per-title.
var ALL_CLEAR_CHECK_ID = 903;
