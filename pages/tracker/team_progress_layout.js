// Per-title grid layout for the team-progress panel in sync_relay.html (see
// design spec decision 7 and its "Alternatives considered" section for why
// this is fresh data rather than adapted from ref's own bundle). gameClear
// ids match lua/share_info.lua's cCheckIdGameClear (900/901/902); the "all 3
// cleared" milestone (903) is tracked once, globally, via ALL_CLEAR_CHECK_ID
// below -- not part of any single title's panel.
var TEAM_PROGRESS_LAYOUT = {
  1: {
    titleIcon: "assets/title_x1.ico",
    bossCheckIds: [241, 242, 243, 244, 245, 246, 247, 248], // LO, SC, AA, BN, SE, SM, BK, IP
    // One dedicated "stage access key" item per boss, same order as
    // bossCheckIds -- confirmed 2026-07-19: a boss icon is "locked" (no key
    // yet), "unlocked" (key owned, not yet defeated), or "defeated", not the
    // old simple 2-state look.
    bossKeyIds: [48, 49, 50, 51, 52, 53, 54, 55],
    weaponIds: [40, 41, 42, 43, 44, 45, 46, 47],
    // Sigma-palace progression row, in intended display order (not raw
    // check-id order). lockIndex indexes into sigmaKeyRequirements[title]
    // (synced from lua/share_info.lua's readSigmaKeyRequirements, read from
    // ROM at addrRequiredSigmaKeys) -- "unlocked" once the room's collected
    // Sigma-key count reaches that lock's required threshold. isSigma marks
    // the final boss slot, rendered with the dedicated x{title}_sigma_boss.gif
    // portrait instead of a check-id icon lookup. Confirmed 2026-07-19
    // (X1/X2 have no a/b split the way X3 does).
    sigmaLockStages: [
      { checkId: 240, lockIndex: 0 }, // Intro
      { checkId: 249, lockIndex: 1 },
      { checkId: 250, lockIndex: 2 },
      { checkId: 251, lockIndex: 3 },
      { checkId: 900, lockIndex: 4, isSigma: true },
    ],
    armor: [[88, 89], [90, 91], [92, 93], [94, 95]], // Head, Arm, Body, Foot (Part id, Chip id)
    subtankIds: [36, 37, 38, 39],
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76], category: "sigmaKey" },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], category: "lifeUp" },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29], category: "energyUp" },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [36, 37, 38, 39], category: "subTank" },
      { file: "assets/b.png", label: "Buster ammo capacity", ids: [96, 97, 98, 99, 100] },
      { file: "assets/ba.png", label: "Buster attack power", ids: [101, 102] },
      { file: "assets/br.png", label: "Buster fire rate", ids: [104, 105, 106, 107, 108, 109] },
      { file: "assets/bd.png", label: "Dash shot capacity", ids: [110, 111] },
      { file: "assets/bc.png", label: "Charge speed", ids: [112, 113, 114, 115] },
    ],
    superWeaponId: 80, // Hadouken
    gameClearCheckId: 900,
  },
  2: {
    titleIcon: "assets/title_x2.ico",
    bossCheckIds: [497, 498, 499, 500, 501, 502, 503, 504], // MM, WH, BC, FS, MH, CM, SO, WA
    bossKeyIds: [304, 305, 306, 307, 308, 309, 310, 311],
    weaponIds: [296, 297, 298, 299, 300, 301, 302, 303],
    sigmaLockStages: [
      { checkId: 496, lockIndex: 0 }, // Intro
      { checkId: 505, lockIndex: 1 },
      { checkId: 506, lockIndex: 2 },
      { checkId: 507, lockIndex: 3 },
      { checkId: 508, lockIndex: 4 }, // stage-4 8-Maverick refight, no single boss
      { checkId: 901, lockIndex: 5, isSigma: true },
    ],
    armor: [[344, 345], [346, 347], [348, 349], [350, 351]],
    subtankIds: [292, 293, 294, 295],
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332], category: "sigmaKey" },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269], category: "lifeUp" },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285], category: "energyUp" },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [292, 293, 294, 295], category: "subTank" },
      { file: "assets/b.png", label: "Buster ammo capacity", ids: [352, 353, 354, 355, 356] },
      { file: "assets/ba.png", label: "Buster attack power", ids: [357, 358] },
      { file: "assets/br.png", label: "Buster fire rate", ids: [360, 361, 362, 363, 364, 365] },
      { file: "assets/bd.png", label: "Dash shot capacity", ids: [366, 367] },
      { file: "assets/bc.png", label: "Charge speed", ids: [368, 369, 370, 371] },
    ],
    zeroIds: [313, 314, 312], // 2ItZeroFHead, 2ItZeroBody, 2ItZeroFoot -- head/body/foot order
    superWeaponId: 336, // Shoryuken
    gameClearCheckId: 901,
  },
  3: {
    titleIcon: "assets/title_x3.ico",
    bossCheckIds: [753, 754, 755, 756, 757, 758, 759, 760], // EH, FB, GB, AS, EN, SS, SM, ST
    bossKeyIds: [560, 561, 562, 563, 564, 565, 566, 567],
    weaponIds: [552, 553, 554, 555, 556, 557, 558, 559],
    // X3's locks are more complex than X1/X2 -- lock 1 gates BOTH S1a (762)
    // and S1b (765), lock 2 gates both S2a (763) and S2b (766); the "b"
    // stages additionally require specific "Victory over" key items beyond
    // just the Sigma-key threshold (confirmed 2026-07-19). Display order
    // (Intro, S1a, S1b, S2a, S2b, S3, Sigma) intentionally does NOT match
    // raw check-id ascending order.
    sigmaLockStages: [
      { checkId: 752, lockIndex: 0 }, // Intro
      { checkId: 762, lockIndex: 1 }, // S1a
      { checkId: 765, lockIndex: 1, extraItemIds: [573, 574] }, // S1b: + Victory over Bit & Byte
      { checkId: 763, lockIndex: 2 }, // S2a
      { checkId: 766, lockIndex: 2, extraItemIds: [575] }, // S2b: + Victory over Vile
      { checkId: 764, lockIndex: 3 }, // S3
      { checkId: 902, lockIndex: 4, isSigma: true },
    ],
    armor: [[600, 601], [602, 603], [604, 605], [606, 607]],
    subtankIds: [548, 549, 550, 551],
    gauges: [
      { file: "assets/sigma.png", label: "Sigma keys collected", ids: [576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589], category: "sigmaKey" },
      { file: "assets/heart.png", label: "Life-up upgrades", ids: [512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525], category: "lifeUp" },
      { file: "assets/energy.png", label: "Energy-up upgrades", ids: [528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541], category: "energyUp" },
      { file: "assets/etank.png", label: "Subtanks collected", ids: [548, 549, 550, 551], category: "subTank" },
      { file: "assets/b.png", label: "Buster ammo capacity", ids: [608, 609, 610, 611, 612] },
      { file: "assets/ba.png", label: "Buster attack power", ids: [613, 614] },
      { file: "assets/br.png", label: "Buster fire rate", ids: [616, 617, 618, 619, 620, 621] },
      { file: "assets/bd.png", label: "Dash shot capacity", ids: [622, 623] },
      { file: "assets/bc.png", label: "Charge speed", ids: [624, 625, 626, 627] },
    ],
    rideArmorIds: [599, 598, 597, 596], // 3ItRideArmorF/H/K/N, F/H/K/N order
    // Vajurila FF/Mandarela BB/Vava are tracked by their "victory" key items
    // (573/574/575), not by the raw defeat checks (750/751/761) -- the
    // checks fire the instant the fight is won, but the intended tracker
    // status is "Victory" (a distinct, later state), which corresponds to
    // actually owning the key item, confirmed 2026-07-19.
    subbossItemIds: [573, 574, 575], // 3ItKeyVajurila, 3ItKeyMandarela, 3ItKeyVava
    superWeaponId: 592, // Z-Saber
    gameClearCheckId: 902,
  },
};

// Wire each title's subtank gauge to read from the single source of truth
// (subtankIds) instead of duplicating the ids in the gauge definition.
for (const title of [1, 2, 3]) {
  const layout = TEAM_PROGRESS_LAYOUT[title];
  const subtankGauge = layout.gauges.find((g) => g.label === "Subtanks collected");
  subtankGauge.ids = layout.subtankIds;
}

// ref/aaa/boot.lua's own "all 3 titles cleared" milestone (lua/share_info.lua's
// cCheckIdGameClearAll) -- shown once, globally, not per-title.
var ALL_CLEAR_CHECK_ID = 903;
