import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, COLLECTIBLE_SKINS, RARITIES, RARITY_ORDER, DEFAULT_SKIN_ID, MATERIALS, unlockedLedModes, hexToHsl } from '../public/js/keyboard-skins.js';
import { AMBIENT, AMBIENT_NAMES, REACTIVE_NAMES, LED_LABELS, createLedState, paletteColor } from '../public/js/keyboard-led.js';
import { createGachaState, normalizeGachaState, draw, drawWithPoints, addPoints, pointsForGame, buy, equip, canDraw, legendaryChance, PITY, COSTS, EARNING } from '../public/js/gacha.js';

const seeded = seed => {
  let value = seed;
  return () => ((value = (value * 1664525 + 1013904223) % 4294967296) / 4294967296);
};
const day = index => `2026-01-${String(index).padStart(2, '0')}x${index}`;

test('스킨 50종: 등급별 개수, 고유 아이디, 색·소재·LED 값이 올바르다', () => {
  assert.equal(COLLECTIBLE_SKINS.length, 50);
  const counts = Object.fromEntries(RARITY_ORDER.map(rarity => [rarity, COLLECTIBLE_SKINS.filter(skin => skin.rarity === rarity).length]));
  assert.deepEqual(counts, { common: 18, uncommon: 14, rare: 9, epic: 5, legendary: 4 });
  assert.equal(new Set(SKINS.map(skin => skin.id)).size, SKINS.length);
  assert.equal(new Set(SKINS.map(skin => skin.name)).size, SKINS.length);
  for (const skin of SKINS) {
    for (const color of Object.values(skin.colors)) assert.match(color, /^#[0-9a-f]{6}$/i, `${skin.id} ${color}`);
    assert.ok(MATERIALS[skin.material], `${skin.id} 소재`);
    assert.ok(AMBIENT_NAMES.includes(skin.led.pattern), `${skin.id} 무늬 ${skin.led.pattern}`);
    assert.ok(REACTIVE_NAMES.includes(skin.led.reactive), `${skin.id} 반응 ${skin.led.reactive}`);
  }
  assert.ok(Math.abs(RARITY_ORDER.reduce((sum, rarity) => sum + RARITIES[rarity].rate, 0) - 1) < 1e-9, '확률 합 100%');
  assert.deepEqual(hexToHsl('#ff0000'), [0, 100, 50]);
});

test('모든 LED 무늬·터치 반응은 이름이 있고, 적어도 한 스킨에서 열린다', () => {
  const all = unlockedLedModes(SKINS.map(skin => skin.id));
  for (const name of AMBIENT_NAMES) {
    assert.ok(LED_LABELS[name], `${name} 이름`);
    assert.ok(all.patterns.has(name), `${name}를 주는 스킨이 없음`);
  }
  for (const name of REACTIVE_NAMES) {
    assert.ok(LED_LABELS[name], `${name} 이름`);
    assert.ok(all.reactives.has(name), `${name}를 주는 스킨이 없음`);
  }
  const starter = unlockedLedModes([DEFAULT_SKIN_ID]);
  assert.ok(starter.patterns.has('off') && starter.patterns.has('wave') && !starter.patterns.has('audio'));
});

test('LED: 모든 무늬가 모든 키·시각에서 올바른 색을 내고, 터치 반응은 누른 키를 밝힌다', () => {
  const keys = Array.from({ length: 30 }, (_, index) => ({ index, x: (index % 15) + 0.5, y: Math.floor(index / 15) * 2, mod: index % 7 === 0 }));
  const palettes = ['rainbow', [[200, 80, 55]], [[10, 90, 50], [120, 80, 60], [260, 70, 55]]];
  for (const name of AMBIENT_NAMES) {
    for (const palette of palettes) {
      for (const time of [0, 0.37, 5.2, 123.4]) {
        for (const key of keys) {
          const color = AMBIENT[name](key, time, { palette, bands: [0.2, 0.9, 0.5, 0], level: 0.6 });
          for (const channel of ['h', 's', 'l', 'a']) assert.ok(Number.isFinite(color[channel]), `${name} ${channel}`);
          assert.ok(color.a >= 0 && color.a <= 1, `${name} 세기 ${color.a}`);
        }
      }
    }
  }
  for (const reactive of REACTIVE_NAMES) {
    const led = createLedState(keys);
    const out = [];
    led.frame(0, { pattern: 'off', reactive, palette: 'rainbow' }, {}, out);
    led.hit(17, 1, true);
    led.frame(1.02, { pattern: 'off', reactive, palette: 'rainbow' }, {}, out);
    const brightest = Math.max(...out.map(color => color.a));
    if (reactive === 'none' || reactive === 'blackhole') assert.ok(brightest < 0.01, `${reactive}는 꺼진 배경에서 빛나지 않음`);
    else assert.ok(out[17].a > 0.3 || brightest > 0.3, `${reactive}: 눌러도 안 빛남`);
    led.frame(9, { pattern: 'off', reactive, palette: 'rainbow' }, {}, out);
    if (reactive !== 'paint') assert.ok(Math.max(...out.map(color => color.a)) < 0.05, `${reactive}: 시간이 지나도 안 꺼짐`);
  }
  assert.deepEqual(paletteColor([[350, 80, 50], [10, 80, 50]], 0.25).h, 0, '색상환을 짧은 쪽으로 섞는다');
});

test('뽑기: 하루 한 번, 첫 뽑기는 희귀 이상, 중복은 조각으로, 천장 안에 반드시 나온다', () => {
  const random = seeded(7);
  let state = createGachaState();
  const first = draw(state, { random, today: day(1) });
  assert.ok(first.ok);
  assert.ok(RARITY_ORDER.indexOf(first.rarity) >= RARITY_ORDER.indexOf('rare'), '첫 뽑기 희귀 이상');
  state = first.state;
  assert.equal(canDraw(state, day(1)), false);
  assert.equal(draw(state, { random, today: day(1) }).ok, false, '같은 날 두 번 안 됨');

  let sinceRare = 0;
  let sinceEpic = 0;
  let sinceLegendary = 0;
  let maxRare = 0;
  let maxEpic = 0;
  let maxLegendary = 0;
  let fragmentsFromDuplicates = 0;
  for (let index = 2; index < 400; index++) {
    const result = draw(state, { random, today: day(index) });
    assert.ok(result.ok);
    const rank = RARITY_ORDER.indexOf(result.rarity);
    sinceRare = rank >= 2 ? 0 : sinceRare + 1;
    sinceEpic = rank >= 3 ? 0 : sinceEpic + 1;
    sinceLegendary = rank === 4 ? 0 : sinceLegendary + 1;
    maxRare = Math.max(maxRare, sinceRare);
    maxEpic = Math.max(maxEpic, sinceEpic);
    maxLegendary = Math.max(maxLegendary, sinceLegendary);
    if (result.duplicate) {
      assert.equal(result.refund, RARITIES[result.rarity].refund);
      fragmentsFromDuplicates += result.refund;
    } else {
      assert.ok(!state.owned.includes(result.skin.id));
    }
    assert.notEqual(result.skin.id, DEFAULT_SKIN_ID, '기본 스킨은 뽑기에 안 나옴');
    state = result.state;
  }
  assert.ok(maxRare < PITY.rare, `희귀 천장 ${maxRare}`);
  assert.ok(maxEpic < PITY.epic, `영웅 천장 ${maxEpic}`);
  assert.ok(maxLegendary < PITY.legendary, `전설 천장 ${maxLegendary}`);
  assert.equal(state.fragments, fragmentsFromDuplicates);
  assert.ok(state.owned.length > 40, `400일이면 대부분 모인다: ${state.owned.length}`);
});

test('전설 소프트 천장: 45회째부터 확률이 오르고 60회째 확정', () => {
  const base = createGachaState();
  assert.equal(legendaryChance({ ...base, pity: { ...base.pity, legendary: 0 } }), RARITIES.legendary.rate);
  assert.ok(legendaryChance({ ...base, pity: { ...base.pity, legendary: PITY.softStart - 1 } }) > RARITIES.legendary.rate);
  assert.equal(legendaryChance({ ...base, pity: { ...base.pity, legendary: PITY.legendary - 1 } }), 1);
});

test('조각 상점·장착·저장값 검증', () => {
  let state = { ...createGachaState(), fragments: 100 };
  assert.equal(buy(state, 'aurora').reason, 'not_enough_fragments');
  const bought = buy(state, 'mocha');
  assert.ok(bought.ok);
  state = bought.state;
  assert.equal(state.fragments, 100 - RARITIES.common.price);
  assert.equal(buy(state, 'mocha').reason, 'already_owned');
  assert.equal(buy(state, DEFAULT_SKIN_ID).ok, false);
  assert.equal(equip(state, 'aurora').ok, false, '없는 스킨은 장착 못함');
  state = equip(state, 'mocha').state;
  assert.equal(state.equipped, 'mocha');

  const repaired = normalizeGachaState({ owned: ['mocha', 'nope', 'mocha'], equipped: 'nope', fragments: -5, draws: 'x', pity: { rare: 3.7 } });
  assert.deepEqual(repaired.owned, [DEFAULT_SKIN_ID, 'mocha']);
  assert.equal(repaired.equipped, DEFAULT_SKIN_ID);
  assert.equal(repaired.fragments, 0);
  assert.deepEqual(repaired.pity, { rare: 3, epic: 0, legendary: 0 });
  assert.deepEqual(normalizeGachaState(null), createGachaState());
});

test('게임 포인트: 판 결과로 적립, 1회 100P·10회 900P, 10회는 희귀 이상 1개 보장, 무료 뽑기와 별개', () => {
  assert.equal(pointsForGame({ correctKeystrokes: 10, accuracy: 100, maxCombo: 50 }), 0, '너무 짧은 판은 0P');
  assert.equal(pointsForGame({ correctKeystrokes: 300, accuracy: 100, maxCombo: 25 }), 30 + 4);
  assert.equal(pointsForGame({ correctKeystrokes: 300, accuracy: 50, maxCombo: 0 }), 7, '정확도² 반영');
  assert.equal(pointsForGame({ correctKeystrokes: 99999, accuracy: 100, maxCombo: 999 }), EARNING.maxPerGame);
  assert.equal(pointsForGame(null), 0);

  let state = addPoints(createGachaState(), 950);
  assert.equal(state.points, 950);
  assert.equal(drawWithPoints(state, 3).reason, 'bad_count');
  const free = draw(state, { random: seeded(1), today: day(1) });
  state = free.state;
  assert.equal(drawWithPoints({ ...state, points: 50 }, 1).reason, 'not_enough_points');

  for (let seed = 1; seed <= 200; seed++) {
    const multi = drawWithPoints({ ...state, points: COSTS.multi, pity: { rare: 0, epic: 0, legendary: 0 } }, 10, { random: seeded(seed) });
    assert.ok(multi.ok);
    assert.equal(multi.results.length, 10);
    assert.equal(multi.state.points, 0);
    assert.ok(multi.results.some(entry => ['rare', 'epic', 'legendary'].includes(entry.rarity)), `seed ${seed}: 희귀 이상 없음`);
    assert.equal(multi.state.lastDrawDay, state.lastDrawDay, '포인트 뽑기는 무료 뽑기 날짜를 건드리지 않음');
    assert.equal(multi.state.draws, state.draws + 10);
  }
  const single = drawWithPoints({ ...state, points: 100 }, 1, { random: seeded(3) });
  assert.ok(single.ok && single.results.length === 1 && single.state.points === 0);
  assert.equal(normalizeGachaState({ points: 120.9 }).points, 120);
});
