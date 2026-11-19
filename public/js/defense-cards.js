// 컴퓨터 디펜스 강화 카드(로그라이트 선택지): 몇 웨이브마다 3장 중 1장을 골라 이번 판에만 능력을 쌓는다.
// 카드는 mods(배율·덧셈 값)를 바꾸거나(apply), 바로 효과를 낸다(instant). max = 이번 판에 고를 수 있는 최대 횟수

export const CARD_RULES = Object.freeze({
  every: 3,          // 이 웨이브 수마다(3, 6, 9, …) 웨이브를 막은 뒤 카드를 고른다
  choices: 3,
  rarityWeight: Object.freeze({ common: 60, rare: 30, epic: 10 })
});

export const CARD_RARITY_LABELS = Object.freeze({ common: '일반', rare: '희귀', epic: '영웅' });

// 이번 판 기본 배율(카드가 없을 때)
export function baseMods() {
  return {
    towerDamage: 1, towerCooldown: 1, towerRange: 0,
    typeDamage: { firewall: 1, honeypot: 1, antivirus: 1, emp: 1, interceptor: 1 },
    typeShots: { firewall: 0, honeypot: 0, antivirus: 0, emp: 0, interceptor: 0 },
    burn: 1, puddleSeconds: 1, puddleSlow: 1, splash: 1,
    wordCoins: 1, killCoins: 1, waveBonus: 1, interest: 0, priceFactor: 1,
    enemySpeed: 1, bossDamage: 1, critChance: 0, guardShots: 0, backups: 0
  };
}

export const DEFENSE_CARDS = Object.freeze([
  { id: 'overclock', icon: '⏱', name: '과부하 클럭', rarity: 'common', max: 3, text: '모든 타워 공격 간격 -12%', apply: mods => { mods.towerCooldown *= 0.88; } },
  { id: 'antenna', icon: '📡', name: '광대역 안테나', rarity: 'common', max: 3, text: '모든 타워 사거리 +0.025', apply: mods => { mods.towerRange += 0.025; } },
  { id: 'miner', icon: '⛏', name: '코인 채굴기', rarity: 'common', max: 3, text: '낱말로 버는 코인 +20%', apply: mods => { mods.wordCoins *= 1.2; } },
  { id: 'bounty', icon: '💰', name: '현상금 사냥', rarity: 'common', max: 3, text: '적 처치 코인 +30%', apply: mods => { mods.killCoins *= 1.3; } },
  { id: 'patch', icon: '🩹', name: '긴급 패치', rarity: 'common', max: 5, text: '컴퓨터 체력 40 즉시 회복', instant: engine => engine.healComputer(40) },
  { id: 'heatsink', icon: '🧊', name: '방열판 증설', rarity: 'common', max: 3, text: '컴퓨터 최대 체력 +20 (그만큼 회복)', instant: engine => engine.raiseMaxHealth(20) },
  { id: 'bulk', icon: '🏷', name: '대량 구매', rarity: 'common', max: 3, text: '타워·강화 가격 -10%', apply: mods => { mods.priceFactor *= 0.9; } },
  { id: 'wave-pay', icon: '🎁', name: '야근 수당', rarity: 'common', max: 3, text: '웨이브 보너스 코인 +40%', apply: mods => { mods.waveBonus *= 1.4; } },
  { id: 'napalm', icon: '🔥', name: '화염 강화', rarity: 'rare', max: 2, text: '방화벽 피해 +40%, 화상 +40%', apply: mods => { mods.typeDamage.firewall *= 1.4; mods.burn *= 1.4; } },
  { id: 'glue', icon: '🍯', name: '끈끈이 원액', rarity: 'rare', max: 2, text: '허니팟 웅덩이 +50% 오래, 더 느리게', apply: mods => { mods.puddleSeconds *= 1.5; mods.puddleSlow *= 0.85; } },
  { id: 'voltage', icon: '⚡', name: '고전압', rarity: 'rare', max: 2, text: 'EMP 폭발 반경 +25%', apply: mods => { mods.splash *= 1.25; } },
  { id: 'vaccine', icon: '💉', name: '정밀 백신', rarity: 'rare', max: 2, text: '백신 피해 +35%', apply: mods => { mods.typeDamage.antivirus *= 1.35; } },
  { id: 'interest', icon: '🏦', name: '이자 수익', rarity: 'rare', max: 2, text: '웨이브를 막을 때마다 가진 코인의 8% (최대 80)', apply: mods => { mods.interest += 0.08; } },
  { id: 'crit', icon: '🎯', name: '치명타 루틴', rarity: 'rare', max: 2, text: '타워 공격 12% 확률로 피해 2배', apply: mods => { mods.critChance += 0.12; } },
  { id: 'profiler', icon: '🔍', name: '보스 분석', rarity: 'rare', max: 2, text: '보스에게 주는 피해 +30%', apply: mods => { mods.bossDamage *= 1.3; } },
  { id: 'lag', icon: '🐌', name: '렉 유발', rarity: 'rare', max: 2, text: '모든 적 이동 속도 -8%', apply: mods => { mods.enemySpeed *= 0.92; } },
  { id: 'braces', icon: '{ }', name: '방어 프로토콜', rarity: 'rare', max: 2, text: "컴퓨터 대공 '{ }' 한 발 더", apply: mods => { mods.guardShots += 1; } },
  { id: 'warhead', icon: '🚀', name: '다탄두', rarity: 'epic', max: 1, text: '요격포가 표적 하나를 더 노린다', apply: mods => { mods.typeShots.interceptor += 1; } },
  { id: 'awaken', icon: '🌟', name: '오버클럭 각성', rarity: 'epic', max: 1, text: '모든 타워 피해 +25%', apply: mods => { mods.towerDamage *= 1.25; } },
  { id: 'backup', icon: '💾', name: '백업 서버', rarity: 'epic', max: 1, text: '체력이 0이 되면 한 번 50%로 되살아남', apply: mods => { mods.backups += 1; } }
]);

const CARD_BY_ID = Object.freeze(Object.fromEntries(DEFENSE_CARDS.map(card => [card.id, card])));
export const cardById = id => CARD_BY_ID[id] ?? null;

// 이번에 보여 줄 카드: 아직 최대 횟수에 안 닿은 카드 중 등급 가중치로 겹치지 않게 count장. O(카드 수 × count)
export function drawCards(picked, random = Math.random, count = CARD_RULES.choices) {
  const pickedCount = id => picked.filter(entry => entry === id).length;
  let pool = DEFENSE_CARDS.filter(card => pickedCount(card.id) < card.max);
  const hand = [];
  while (hand.length < count && pool.length) {
    const weights = pool.map(card => CARD_RULES.rarityWeight[card.rarity] ?? 1);
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < pool.length - 1 && roll >= weights[index]) roll -= weights[index++];
    hand.push(pool[index].id);
    pool = pool.filter((_, other) => other !== index);
  }
  return hand;
}
