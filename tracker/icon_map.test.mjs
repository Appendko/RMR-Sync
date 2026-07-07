import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

// icon_map.js and item_id_map.js are classic (non-module) browser scripts
// loaded via two <script> tags sharing one global scope (see event_feed.html).
// We faithfully mirror that loading mechanism here using vm, rather than
// importing them as ES modules.
const dir = path.dirname(fileURLToPath(import.meta.url));
const context = {};
vm.createContext(context);
vm.runInContext(readFileSync(path.join(dir, "item_id_map.js"), "utf8"), context);
vm.runInContext(readFileSync(path.join(dir, "icon_map.js"), "utf8"), context);
const { getIconInfo, getIconInfoForId, getSpritePositionForId } = context;

test("maps generic categories regardless of game", () => {
  assert.equal(getIconInfo("1ItLifeUp1").file, "assets/heart.png");
  assert.equal(getIconInfo("2ItEnergyUp3").file, "assets/energy.png");
  assert.equal(getIconInfo("3ItSubtank2").file, "assets/etank.png");
  assert.equal(getIconInfo("MItLifeUp1").file, "assets/heart.png");
});

test("maps armor parts per game", () => {
  assert.equal(getIconInfo("1ItHeadPart").file, "assets/x1_x_head.png");
  assert.equal(getIconInfo("2ItArmChip").file, "assets/x2_x_arm.png");
  assert.equal(getIconInfo("3ItFootPart").file, "assets/x3_x_foot.png");
});

test("maps special abilities", () => {
  assert.equal(getIconInfo("1ItHadouken").file, "assets/x1_x_hadouken.png");
  assert.equal(getIconInfo("2ItShoryuken").file, "assets/x2_x_shoryuken.png");
  assert.equal(getIconInfo("3ItSaber").file, "assets/x3_x_saber.png");
});

test("maps X3 ride armor by letter", () => {
  assert.equal(getIconInfo("3ItRideArmorN").file, "assets/x3_ridearmor_n.png");
  assert.equal(getIconInfo("3ItRideArmorF").file, "assets/x3_ridearmor_f.png");
});

test("maps X1 weapon/key codes to the verified English-name asset codes", () => {
  // These two are the pair whose Japanese-derived id-map code diverges from
  // the English-name asset filename: BN -> Flame Mammoth (fm), IP -> Chill Penguin (cp).
  assert.equal(getIconInfo("1ItWeaponBN").file, "assets/x1_weapon_fm.png");
  assert.equal(getIconInfo("1ItKeyIP").file, "assets/x1_weapon_cp.png");
  assert.equal(getIconInfo("1ItWeaponLO").file, "assets/x1_weapon_lo.png");
});

test("maps X2 weapon codes to the verified asset codes", () => {
  assert.equal(getIconInfo("2ItWeaponWH").file, "assets/x2_weapon_ws.png");
  assert.equal(getIconInfo("2ItWeaponMH").file, "assets/x2_weapon_mc.png");
  assert.equal(getIconInfo("2ItWeaponCM").file, "assets/x2_weapon_cs.png");
  assert.equal(getIconInfo("2ItWeaponSO").file, "assets/x2_weapon_oo.png");
  assert.equal(getIconInfo("2ItWeaponWA").file, "assets/x2_weapon_wg.png");
});

test("maps X3 weapon codes to the verified asset codes", () => {
  assert.equal(getIconInfo("3ItWeaponEH").file, "assets/x3_weapon_bh.png");
  assert.equal(getIconInfo("3ItWeaponFB").file, "assets/x3_weapon_bb.png");
  assert.equal(getIconInfo("3ItWeaponAS").file, "assets/x3_weapon_ts.png");
  assert.equal(getIconInfo("3ItWeaponEN").file, "assets/x3_weapon_vc.png");
  assert.equal(getIconInfo("3ItWeaponSS").file, "assets/x3_weapon_cc.png");
  assert.equal(getIconInfo("3ItWeaponSM").file, "assets/x3_weapon_tr.png");
  assert.equal(getIconInfo("3ItWeaponST").file, "assets/x3_weapon_nt.png");
});

test("falls back to the generic icon for unmapped ids instead of throwing", () => {
  const result = getIconInfo("ItEmpty");
  assert.equal(result.file, "assets/x.png");
  assert.equal(typeof result.label, "string");
});

test("maps numbered Sigma stage-keys for every game", () => {
  assert.equal(getIconInfo("1ItKeyS11").file, "assets/sigma.png");
  assert.equal(getIconInfo("2ItKeyS11").file, "assets/sigma.png");
  assert.equal(getIconInfo("3ItKeyS11").file, "assets/sigma.png");
  assert.equal(getIconInfo("MItKeyS11").file, "assets/sigma.png");
  // Boundary numbers.
  assert.equal(getIconInfo("1ItKeyS1").file, "assets/sigma.png");
  assert.equal(getIconInfo("3ItKeyS14").file, "assets/sigma.png");
});

test("maps X3 special named keys to their purpose-built character icons", () => {
  assert.equal(getIconInfo("3ItKeyVavaStage").file, "assets/vava.png");
  assert.equal(getIconInfo("3ItKeyVajurila").file, "assets/bit.png");
  assert.equal(getIconInfo("3ItKeyMandarela").file, "assets/byte.png");
  assert.equal(getIconInfo("3ItKeyVava").file, "assets/vava.png");
});

test("maps M-prefixed boss/weapon codes via the game-1 fallback", () => {
  assert.equal(getIconInfo("MItWeaponLO").file, "assets/x1_weapon_lo.png");
  assert.equal(getIconInfo("MItKeyIP").file, "assets/x1_weapon_cp.png");
});

test("maps ItStageVaried codes to the matching boss weapon asset", () => {
  assert.equal(getIconInfo("1ItStageVariedSC").file, "assets/x1_weapon_sc.png");
  assert.equal(getIconInfo("3ItStageVariedEH").file, "assets/x3_weapon_bh.png");
  assert.equal(getIconInfo("MItStageVariedBN").file, "assets/x1_weapon_fm.png");
});

test("maps X2 Zero parts to the X armor-part icons", () => {
  assert.equal(getIconInfo("2ItZeroFoot").file, "assets/x2_x_foot.png");
  assert.equal(getIconInfo("2ItZeroFHead").file, "assets/x2_x_head.png");
  assert.equal(getIconInfo("2ItZeroBody").file, "assets/x2_x_body.png");
});

test("maps MItHadouken alongside the existing 1ItHadouken rule", () => {
  assert.equal(getIconInfo("MItHadouken").file, "assets/x1_x_hadouken.png");
});

test("derives a readable label from the id string", () => {
  assert.equal(getIconInfo("1ItLifeUp1").label, "LifeUp1");
  assert.equal(getIconInfo("2ItWeaponMM").label, "WeaponMM");
});

test("getIconInfoForId resolves a raw numeric item ID via ITEM_ID_MAP", () => {
  assert.equal(getIconInfoForId(0).file, "assets/heart.png"); // 0 = "1ItLifeUp1"
  assert.equal(getIconInfoForId(40).file, "assets/x1_weapon_lo.png"); // 40 = "1ItWeaponLO"
  assert.equal(getIconInfoForId(592).file, "assets/x3_x_saber.png"); // 592 = "3ItSaber"
});

test("getIconInfoForId falls back to the generic icon for an ID outside the map", () => {
  const result = getIconInfoForId(999);
  assert.equal(result.file, "assets/x.png");
  assert.equal(result.label, "999");
});

test("getSpritePositionForId computes the sprite-sheet slot for a regular (non-M) id", () => {
  // id 74 = "1ItKeyS11". 74 % 8 = 2 -> sx = 32.
  // floor(74/256) = 0, floor(74 % 256 / 8) = floor(74/8) = 9 -> sy = 0 + 9*16 + 128 = 272.
  const pos = getSpritePositionForId(74);
  assert.deepEqual({ sx: pos.sx, sy: pos.sy }, { sx: 32, sy: 272 });
});

test("getSpritePositionForId resolves an M-prefixed id to its 1-prefixed sprite equivalent", () => {
  // id 808 = "MItWeaponLO"; its "1"-prefixed equivalent is id 40 = "1ItWeaponLO".
  const mPos = getSpritePositionForId(808);
  const onePos = getSpritePositionForId(40);
  assert.deepEqual({ sx: mPos.sx, sy: mPos.sy }, { sx: onePos.sx, sy: onePos.sy });
});

test("getSpritePositionForId returns null for an id with no ITEM_ID_MAP entry", () => {
  assert.equal(getSpritePositionForId(99999), null);
});

test("getSpritePositionForId gives ItLifeS/ItLifeL/ItFullRecover their own distinct sprite slots, unlike the old shared heart.png bug", () => {
  // 120 = "ItLifeS", 121 = "ItLifeL", 124 = "ItFullRecover", 0 = "1ItLifeUp1".
  // The old getIconInfo rules wrongly pointed all four at assets/heart.png; sprite-slicing
  // uses each item's own numeric id, so they must land on different sheet positions.
  const lifeUp = getSpritePositionForId(0);
  const lifeS = getSpritePositionForId(120);
  const lifeL = getSpritePositionForId(121);
  const fullRecover = getSpritePositionForId(124);

  assert.notDeepEqual({ sx: lifeS.sx, sy: lifeS.sy }, { sx: lifeUp.sx, sy: lifeUp.sy });
  assert.notDeepEqual({ sx: lifeL.sx, sy: lifeL.sy }, { sx: lifeUp.sx, sy: lifeUp.sy });
  assert.notDeepEqual({ sx: fullRecover.sx, sy: fullRecover.sy }, { sx: lifeUp.sx, sy: lifeUp.sy });
});

test("getSpritePositionForId gives ItWeaponS/ItWeaponL their own distinct sprite slots, unlike the old shared energy.png bug", () => {
  // 122 = "ItWeaponS", 123 = "ItWeaponL", 16 = "1ItEnergyUp1".
  // The old getIconInfo rules wrongly pointed both at assets/energy.png; sprite-slicing
  // uses each item's own numeric id, so they must land on different sheet positions.
  const energyUp = getSpritePositionForId(16);
  const weaponS = getSpritePositionForId(122);
  const weaponL = getSpritePositionForId(123);

  assert.notDeepEqual({ sx: weaponS.sx, sy: weaponS.sy }, { sx: energyUp.sx, sy: energyUp.sy });
  assert.notDeepEqual({ sx: weaponL.sx, sy: weaponL.sy }, { sx: energyUp.sx, sy: energyUp.sy });
});
