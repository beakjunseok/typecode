// 모든 게임이 함께 쓰는 아이템 등급(일반·희귀·영웅·전설): 이름·색·나오는 비율·성능 단계.
// 같은 아이템이라도 등급이 높을수록 효과가 크다. 단계 값은 각 게임이 [일반, 희귀, 영웅, 전설] 배열로 적는다.
// 성능 목표(대략): 일반 1 : 희귀 1.6 : 영웅 2.5 : 전설 4 — 한 단계마다 체감될 만큼(약 1.5배) 벌어지게 한다.

export const RARITY_ORDER = Object.freeze(['common', 'rare', 'epic', 'legendary']);

export const ITEM_RARITIES = Object.freeze({
  common: Object.freeze({ label: '일반', color: '#9fb3c8', weight: 56, power: 1 }),
  rare: Object.freeze({ label: '희귀', color: '#36e2ff', weight: 28, power: 1.6 }),
  epic: Object.freeze({ label: '영웅', color: '#c77dff', weight: 12, power: 2.5 }),
  legendary: Object.freeze({ label: '전설', color: '#ffc94d', weight: 4, power: 4 })
});

export const rarityIndex = rarity => Math.max(0, RARITY_ORDER.indexOf(rarity));
export const isRarity = rarity => RARITY_ORDER.includes(rarity);

// 등급 뽑기: 기본 비율 56/28/12/4. luck만큼 높은 등급을 키운다(희귀 ×(1+luck), 영웅 ×(1+2luck), 전설 ×(1+3luck)). O(1)
export function rollRarity(random = Math.random, luck = 0) {
  const weights = RARITY_ORDER.map((rarity, index) => ITEM_RARITIES[rarity].weight * (1 + index * Math.max(0, luck)));
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < RARITY_ORDER.length; index++) {
    roll -= weights[index];
    if (roll < 0) return RARITY_ORDER[index];
  }
  return 'common';
}

// 등급별 값 배열에서 그 등급 값 꺼내기(없는 등급이면 일반 값)
export function tierValue(values, rarity) {
  if (!Array.isArray(values)) return values;
  return values[rarityIndex(rarity)] ?? values[0];
}
