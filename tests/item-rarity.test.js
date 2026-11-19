import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_RARITIES, RARITY_ORDER, rollRarity, tierValue } from '../public/js/item-rarity.js';
import { ITEM_TIERS as BATTERY_TIERS, itemEffectText } from '../public/js/battery-engine.js';
import { ITEM_TIERS as THROW_TIERS } from '../public/js/throw-engine.js';

function seeded(seed = 7) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 2 ** 32; return state / 2 ** 32; };
}

test('등급 뽑기: 비율이 56/28/12/4에 가깝고, 행운이 높으면 높은 등급이 잘 나온다', () => {
  const random = seeded(3);
  const count = Object.fromEntries(RARITY_ORDER.map(rarity => [rarity, 0]));
  for (let index = 0; index < 20000; index++) count[rollRarity(random)]++;
  for (const rarity of RARITY_ORDER) assert.ok(Math.abs(count[rarity] / 20000 * 100 - ITEM_RARITIES[rarity].weight) < 1.5, rarity);
  let lucky = 0;
  for (let index = 0; index < 20000; index++) if (rollRarity(random, 1) === 'legendary') lucky++;
  assert.ok(lucky / 20000 > 0.08, '행운 1이면 전설 약 10%');
});

test('등급별 효과 크기: 모든 아이템이 등급이 오를수록 커지고, 전설은 일반의 3배 이상', () => {
  const growth = values => values.every((value, index) => index === 0 || value >= values[index - 1]);
  for (const [item, tiers] of Object.entries(BATTERY_TIERS)) {
    const main = tiers.gain ?? tiers.seconds ?? tiers.count ?? tiers.factor;
    assert.ok(growth(main), item);
    if (item === 'trap') assert.ok(tiers.count[3] * tiers.loss[3] >= 3 * tiers.count[0] * tiers.loss[0], item);
    else if (item !== 'reflect') assert.ok(main[3] >= 3 * main[0], item);
    for (const rarity of RARITY_ORDER) assert.ok(itemEffectText(item, rarity).length > 0, `${item} ${rarity}`);
  }
  const laptopValue = rarity => tierValue(THROW_TIERS.laptop.seconds, rarity) * (tierValue(THROW_TIERS.laptop.shots, rarity) - 1);
  assert.ok(RARITY_ORDER.every((rarity, index) => index === 0 || laptopValue(rarity) > laptopValue(RARITY_ORDER[index - 1])));
  assert.ok(laptopValue('legendary') >= 3.5 * laptopValue('common'));
  assert.ok(growth(THROW_TIERS.battery.heal));
});
