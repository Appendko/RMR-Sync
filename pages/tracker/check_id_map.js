// Ported from ref/RMR_progress_tracker_displayer_ver_js_20260126/progress_tracker_js/
// RMR_progress_tracker_id_maps.js's own `checkId` table (global bit index 0-766,
// same indexing convention ITEM_ID_MAP already uses). These are the original
// AutoTracker-derived short codes -- not player-facing names. See
// docs/superpowers/specs/2026-07-11-progress-mode-design.md for the authoring
// plan (check_audit.html + check_names_en/ja/zhtw.js).
const CHECK_ID_MAP = {
  0: "1ChOPLifeL", 1: "1ChOPLifeS",
  16: "1ChLOLifeL", 17: "1ChLOLifeUp",
  32: "1ChSCBodyPart", 33: "1ChSCLifeUp", 34: "1ChSC1UP", 35: "1ChSCLifeL",
  48: "1ChAASubtank", 49: "1ChAALifeL_CL", 50: "1ChAALifeL_CR", 51: "1ChAALifeUp", 52: "1ChAALifeL_End", 53: "1ChAAHadouken",
  64: "1ChBNLifeL_P", 65: "1ChBNArmPart", 66: "1ChBNSubtank", 67: "1ChBN1UP", 68: "1ChBNLifeL_G", 69: "1ChBNLifeUp",
  80: "1ChSELifeUp", 81: "1ChSELifeL_1", 82: "1ChSELifeL_2", 83: "1ChSELifeL_3", 84: "1ChSE1UP_S", 85: "1ChSESubtank",
  86: "1ChSE1UP_E", 87: "1ChSEHeadPart", 88: "1ChSE1UP_R", 89: "1ChSELifeL_D", 90: "1ChSEWeaponL",
  96: "1ChSMSubtank", 97: "1ChSMLifeUp",
  112: "1ChBKLifeUp",
  128: "1ChIPFootPart", 129: "1ChIPLifeUp", 130: "1ChIPWeaponL",
  144: "1ChS1ArmPart",
  176: "1ChS3LifeL_2", 177: "1ChS3WeaponL_3", 178: "1ChS3LifeL_3", 179: "1ChS3LifeL_4", 180: "1ChS3WeaponL_4",
  181: "1ChS3LifeL_5", 182: "1ChS3WeaponL_5", 183: "1ChS31UP",
  240: "1ChOPClear", 241: "1ChLOClear", 242: "1ChSCClear", 243: "1ChAAClear", 244: "1ChBNClear", 245: "1ChSEClear",
  246: "1ChSMClear", 247: "1ChBKClear", 248: "1ChIPClear", 249: "1ChS1Clear", 250: "1ChS2Clear", 251: "1ChS3Clear",
  254: "ChUnused", 255: "ChDefault",
  256: "2ChOPLifeL_P", 257: "2ChOPLifeL_B",
  272: "2ChMM1UP_R", 273: "2ChMMLifeUp", 274: "2ChMMBodyPart", 275: "2ChMM1UP", 276: "2ChMMLifeL_P",
  277: "2ChMMLifeL_HL", 278: "2ChMMLifeL_HR", 279: "2ChMMLifeL_SL", 280: "2ChMMLifeL_SR",
  288: "2ChWHLifeUp", 289: "2ChWH1UP", 290: "2ChWHSubtank", 291: "2ChWHLifeL_CH", 292: "2ChWHLifeL_P",
  304: "2ChBC1UP", 305: "2ChBCLifeS_P", 306: "2ChBCLifeUp", 307: "2ChBCLifeL_Ceiling", 308: "2ChBCLifeL_Scrap",
  309: "2ChBCWeaponL_C", 310: "2ChBCLifeL_SeaBottom", 311: "2ChBCLifeS_Shed", 312: "2ChBCWeaponL_S",
  313: "2ChBCSubtank", 314: "2ChBCLifeL_Cave", 315: "2ChBCLifeL_Boss",
  320: "2ChFSLifeS_F1", 321: "2ChFSWeaponS_F2", 322: "2ChFSLifeS_F3", 323: "2ChFSWeaponS_F4", 324: "2ChFSLifeS_F5",
  325: "2ChFSSubtank", 326: "2ChFS1UP_L", 327: "2ChFS1UP_V", 328: "2ChFSLifeL_V", 329: "2ChFSLifeS_V",
  330: "2ChFSWeaponS_V", 331: "2ChFSLifeUp", 332: "2ChFSLifeL_Crater", 333: "2ChFSWeaponL_Cave", 334: "2ChFSLifeL_Cave",
  335: "2ChFSLifeL_CH",
  336: "2ChMHLifeUp", 337: "2ChMHSubtank", 338: "2ChMHLifeL_P", 339: "2ChMHLifeL_CH",
  350: "2ChFSLifeL_G", 351: "2ChFS1UP_Cave",
  352: "2ChCMLifeUp", 353: "2ChCMWeaponL_P", 354: "2ChCMLifeL_P", 355: "2ChCMLifeL_CH", 356: "2ChCMLifeS_P",
  357: "2ChCM1UP_P", 358: "2ChCMLifeL_N", 359: "2ChCMHeadPart", 360: "2ChCM1UP_C", 361: "2ChCMWeaponL_Scrap",
  368: "2ChSOLifeL_CH", 369: "2ChSOLifeL_Scrap", 370: "2ChSO1UP", 371: "2ChSOWeaponS_S", 372: "2ChSOLifeS_S",
  373: "2ChSOWeaponL_S", 374: "2ChSOLifeL_S", 375: "2ChSOLifeUp", 376: "2ChSOFootPart",
  384: "2ChWAArmPart", 385: "2ChWALifeL_P1", 386: "2ChWALifeL_P2", 387: "2ChWALifeUp", 388: "2ChWA1UP",
  389: "2ChWAWeaponL", 390: "2ChWALifeL_CH", 391: "2ChWALifeL_S1", 392: "2ChWALifeL_S2", 393: "2ChWALifeL_S3", 394: "2ChWALifeL_B",
  400: "2ChS11UP_N", 401: "2ChS1LifeL", 402: "2ChS11UP_B",
  416: "2ChS2LifeS", 417: "2ChS21UP",
  432: "2ChS3LifeL_W", 433: "2ChS31UP_W", 434: "2ChS3LifeL_S11", 435: "2ChS3LifeL_S12", 436: "2ChS3LifeL_S13",
  437: "2ChS3LifeL_S21", 438: "2ChS3LifeL_S22", 439: "2ChS31UP_U1", 440: "2ChS3LifeL_U1", 441: "2ChS3LifeL_U2",
  442: "2ChS31UP_U2", 443: "2ChS3Shoryuken", 444: "2ChS31UP_M",
  448: "2ChS4LifeS_1", 449: "2ChS4LifeS_2", 450: "2ChS4LifeS_3", 451: "2ChS4LifeS_4",
  493: "2ChViolen", 494: "2ChSerges", 495: "2ChAgile",
  496: "2ChOPClear", 497: "2ChMMClear", 498: "2ChWHClear", 499: "2ChBCClear", 500: "2ChFSClear", 501: "2ChMHClear",
  502: "2ChCMClear", 503: "2ChSOClear", 504: "2ChWAClear", 505: "2ChS1Clear", 506: "2ChS2Clear", 507: "2ChS3Clear", 508: "2ChS4Clear",
  512: "3ChOPLifeL_P", 513: "3ChOPLifeL_Shaft",
  528: "3ChEHHeadChip", 529: "3ChEHLifeL_C", 530: "3ChEHLifeL_W", 531: "3ChEHRideArmor", 532: "3ChEHLifeUp",
  544: "3ChFBLifeUp", 545: "3ChFBLifeL_R", 546: "3ChFBLifeL_BEn", 547: "3ChFBLifeL_BS", 548: "3ChFBLifeL_BEx",
  549: "3ChFBSubtank", 550: "3ChFBLifeL_S", 551: "3ChFBFootPart",
  560: "3ChGBLifeUp", 561: "3ChGBLifeL_S", 562: "3ChGBFrog", 563: "3ChGBLifeL_D", 564: "3ChGBWeaponL_6",
  565: "3ChGBLifeL_6", 566: "3ChGB1UP_7", 567: "3ChGBLifeL_7", 568: "3ChGBLifeL_8", 569: "3ChGBWeaponL_8",
  570: "3ChGBLifeL_M", 571: "3ChGBArmChip",
  576: "3ChASLifeL_S", 577: "3ChASLifeL_F", 578: "3ChASLifeUp", 579: "3ChASKangaroo", 580: "3ChASFootChip", 581: "3ChASLifeL_L",
  592: "3ChENLifeL_L1", 593: "3ChENLifeL_L2", 594: "3ChENLifeUp", 595: "3ChENBodyPart", 596: "3ChENLifeL_RST",
  597: "3ChENWeaponL_RST", 598: "3ChENSubtank", 599: "3ChENWeaponL_LST", 600: "3ChENLifeL_LST", 601: "3ChENWeaponL_NB", 602: "3ChENLifeL_NB",
  608: "3ChSSLifeL_C", 609: "3ChSSLifeL_NC", 610: "3ChSSHawk", 611: "3ChSSLifeUp", 612: "3ChSSBodyChip",
  613: "3ChSSLifeL_NT", 614: "3ChSSLifeL_ND", 615: "3ChSSWeaponL", 616: "3ChSSLifeL_SL", 617: "3ChSSLifeL_SR",
  618: "3ChSS1UP_SL", 619: "3ChSS1UP_SR",
  624: "3ChSMLifeUp", 625: "3ChSMSubtank", 626: "3ChSMWeaponL", 627: "3ChSMLifeL", 628: "3ChSMHeadPart",
  640: "3ChSTLifeL_R", 641: "3ChSTSubtank", 642: "3ChSTLifeL_L", 643: "3ChSTArmPart", 644: "3ChSTLifeL_NMB", 645: "3ChSTLifeUp",
  656: "3ChVALifeL_EV1", 657: "3ChVALifeL_EV2", 658: "3ChVALifeL_EV3", 659: "3ChVALifeL_EV4", 660: "3ChVAEnergyL",
  661: "3ChVALifeL_E1", 662: "3ChVALifeL_E2", 663: "3ChVALifeL_E3", 664: "3ChVA1UP", 665: "3ChVALifeL_E4", 666: "3ChVALifeL_E5",
  672: "3ChS1LifeL_P", 673: "3ChS1EnergyL", 674: "3ChS1LifeL_LR", 675: "3ChS1HyperChip",
  688: "3ChS2Saber",
  704: "3ChS31UP", 705: "3ChS3LifeL",
  // Not part of the original ported AutoTracker map -- confirmed live (seen
  // as id 736 in an actual checks diff capture) and cross-referenced against
  // the randomizer's own C# source (hAppendVavaStageKeyIntoCheckSequence
  // appends check 0x3E0, only when enableSpoiler is on; 0x3E0 is 1-indexed
  // by title in the C#'s own numbering, translating to this project's
  // 0-indexed CHECK_ID_MAP as (3-1)*256 + (0x3E0 & 0xFF) = 736). Named to
  // mirror its corresponding item's own code (3ItKeyVavaStage, id 572) --
  // not reported to the event feed (no display-name translation), only used
  // by lua/share_info.lua as the local write-back target once item 572 is
  // owned (see checkForVavaStageKeyOwned).
  736: "3ChKeyVavaStage",
  750: "3ChVajurilaFF", 751: "3ChMandarelaBB",
  752: "3ChOPClear", 753: "3ChEHClear", 754: "3ChFBClear", 755: "3ChGBClear", 756: "3ChASClear", 757: "3ChENClear",
  758: "3ChSSClear", 759: "3ChSMClear", 760: "3ChSTClear", 761: "3ChVAClear",
  762: "3ChS1Clear1", 763: "3ChS2Clear1", 764: "3ChS3Clear", 765: "3ChS1Clear2", 766: "3ChS2Clear2",

  // Synthetic ids (900+), NOT part of the ported AutoTracker map (which tops
  // out at 766) -- ref/aaa/boot.lua's own "whole game beaten" flag (WRAM
  // 0x7FFFCF, kept per-title in sessionSave.titleValue the same way
  // checks/checksSeen are) isn't a real bit in the 96-byte checks array at
  // all, so it can't get a real id. lua/share_info.lua's
  // checkForNewGameClear() reports it through the same `checks` event field
  // as real checks using these 3 ids, purely so it reuses the existing
  // check-name translation files and event-feed display with no new schema.
  900: "GameClearX1", 901: "GameClearX2", 902: "GameClearX3",
  // "All 3 titles cleared" -- ref/aaa/boot.lua's own allClear/"All Clear
  // Time" milestone. Carries a companion event.gameClearTime string
  // (H:MM:SS, from lua/share_logic.lua's ShareLogic.formatClearTime) that
  // event_feed.js substitutes into this id's name wherever "{time}" appears
  // -- see check_names_en.js etc.
  903: "GameClearAll",
};

// Which global check ids are "events" (stage clear / boss defeat) rather
// than plain randomized-item pickup "locations". Only event ids are ever
// reported to the event feed (see lua/share_info.lua's checkForNewChecks());
// locations aren't synced or announced at all -- after randomization they
// hold a different item, so their completion is just item ownership,
// already covered by the items merge. Mirrored 1:1 in
// lua/share_logic.lua's own EVENT_CHECK_IDS -- keep both in sync if this
// ever needs revisiting. Used by pages/tracker/check_audit.html to flag which
// rows are events when authoring names.
const EVENT_CHECK_IDS = new Set([
  240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251,
  493, 494, 495,
  496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508,
  750, 751,
  752, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766,
  900, 901, 902, 903,
]);
