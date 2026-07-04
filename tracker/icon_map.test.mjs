import { test } from "node:test";
import assert from "node:assert/strict";
import { getIconInfo, getIconInfoForId } from "./icon_map.mjs";

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
  const result = getIconInfo("1ItStageVariedSC");
  assert.equal(result.file, "assets/x.png");
  assert.equal(typeof result.label, "string");
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
