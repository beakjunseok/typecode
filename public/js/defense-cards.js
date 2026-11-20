// 컴퓨터 디펜스 강화 카드(로그라이트 선택지): 몇 웨이브마다 몇 장 중 1장을 골라 이번 판에만 능력을 쌓는다.
// 규칙: 카드마다 건드리는 값(effect)이 하나씩이고 서로 겹치지 않는다(같은 값을 크기만 바꾼 카드 없음 — 시험으로 검사).
// apply = mods를 바꾸는 효과, instant = 고르는 순간 엔진에 바로 일어나는 효과. max = 이번 판에 고를 수 있는 최대 횟수

export const CARD_RULES = Object.freeze({
  every: 3,          // 이 웨이브 수마다(3, 6, 9, …) 웨이브를 막은 뒤 카드를 고른다
  choices: 3,
  rarityWeight: Object.freeze({ common: 56, rare: 28, epic: 12, legendary: 4 })
});

export const CARD_RARITIES = Object.freeze(['common', 'rare', 'epic', 'legendary']);
export const CARD_RARITY_LABELS = Object.freeze({ common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' });

// 이번 판 기본 값(카드가 없을 때). 카드 하나가 이 중 정확히 한 칸만 바꾼다
export function baseMods() {
  return {
    towerDamage: 1, towerCooldown: 1, towerRange: 0,
    typeDamage: { firewall: 1, honeypot: 1, antivirus: 1, emp: 1, interceptor: 1 },
    typeShots: { firewall: 0, honeypot: 0, antivirus: 0, emp: 0, interceptor: 0 },
    burn: 1, puddleSeconds: 1, splash: 1, airDamage: 1,
    wordCoins: 1, killCoins: 1, waveBonus: 1, interest: 0, comboBoost: 1, jackpot: 0, scoreBonus: 1,
    buildPrice: 1, upgradePrice: 1, repairPrice: 1, sellRefund: 0, freeBuilds: 0, extraTowers: 0,
    enemySpeed: 1, spawnInterval: 1, enemyHpMinus: 0, summonFactor: 1, bossDamage: 1, executeBelow: 0,
    critChance: 0, killBlast: 0, burnSpread: false, killChill: 0, counterHack: 0,
    guardShots: 0, regen: 0, shutters: 0, comboShield: false, lockImmune: false, backups: 0,
    guardianDamage: 1, extraBreak: 0, waveFreeze: 0,
    extraChoices: 0, luck: 0
  };
}

// effect: 이 카드가 바꾸는 값 이름(겹침 검사용). instant 카드는 'instant:무엇'
export const DEFENSE_CARDS = Object.freeze([
  // ---------- 일반 ----------
  { id: 'overclock', icon: '⏱', name: '과부하 클럭', rarity: 'common', max: 3, effect: 'towerCooldown', text: '모든 타워 공격 간격 -12%', apply: mods => { mods.towerCooldown *= 0.88; } },
  { id: 'antenna', icon: '📡', name: '광대역 안테나', rarity: 'common', max: 3, effect: 'towerRange', text: '모든 타워 사거리 +0.022', apply: mods => { mods.towerRange += 0.022; } },
  { id: 'miner', icon: '⛏', name: '코인 채굴기', rarity: 'common', max: 3, effect: 'wordCoins', text: '낱말로 버는 코인 +30%', apply: mods => { mods.wordCoins *= 1.3; } },
  { id: 'bounty', icon: '💰', name: '현상금 사냥', rarity: 'common', max: 3, effect: 'killCoins', text: '적 처치 코인 +70%', apply: mods => { mods.killCoins *= 1.7; } },
  { id: 'patch', icon: '🩹', name: '긴급 패치', rarity: 'common', max: 5, effect: 'instant:heal', text: '컴퓨터 체력 60 즉시 회복', instant: engine => engine.healComputer(60) },
  { id: 'heatsink', icon: '🧊', name: '방열판 증설', rarity: 'common', max: 3, effect: 'instant:maxHealth', text: '컴퓨터 최대 체력 +10 (그만큼 회복)', instant: engine => engine.raiseMaxHealth(10) },
  { id: 'bulk', icon: '🏷', name: '대량 구매', rarity: 'common', max: 3, effect: 'buildPrice', text: '새 타워 가격 -12%', apply: mods => { mods.buildPrice *= 0.88; } },
  { id: 'refactor', icon: '🧹', name: '리팩터링', rarity: 'common', max: 3, effect: 'upgradePrice', text: '타워·컴퓨터 강화 가격 -18%', apply: mods => { mods.upgradePrice *= 0.82; } },
  { id: 'wave-pay', icon: '🎁', name: '야근 수당', rarity: 'common', max: 3, effect: 'waveBonus', text: '웨이브 보너스 코인 +22%', apply: mods => { mods.waveBonus *= 1.22; } },
  { id: 'stash', icon: '🪙', name: '비상금', rarity: 'common', max: 3, effect: 'instant:coins', text: '코인 즉시(웨이브 × 60, 최소 200)', instant: engine => engine.gainCoins(Math.max(200, 60 * engine.wave), 'card') },
  { id: 'resale', icon: '♻', name: '중고 거래', rarity: 'common', max: 2, effect: 'sellRefund', text: '타워 판매 환급 +25%p', apply: mods => { mods.sellRefund += 0.25; } },
  { id: 'coffee', icon: '☕', name: '커피 타임', rarity: 'common', max: 3, effect: 'extraBreak', text: '웨이브 사이 쉬는 시간 +6초', apply: mods => { mods.extraBreak += 6; } },
  { id: 'kit', icon: '🧰', name: '수리 키트', rarity: 'common', max: 2, effect: 'repairPrice', text: '상점 수리(patch) 가격 -60%', apply: mods => { mods.repairPrice *= 0.4; } },
  { id: 'leaderboard', icon: '🏅', name: '랭킹 욕심', rarity: 'common', max: 3, effect: 'scoreBonus', text: '처치·웨이브 점수 +25%', apply: mods => { mods.scoreBonus *= 1.25; } },
  { id: 'throttle', icon: '🚦', name: '트래픽 제한', rarity: 'common', max: 2, effect: 'spawnInterval', text: '적이 나오는 간격 +10%', apply: mods => { mods.spawnInterval *= 1.1; } },
  // ---------- 희귀 ----------
  { id: 'napalm', icon: '🔥', name: '화염 강화', rarity: 'rare', max: 2, effect: 'burn', text: '방화벽 화상 피해 +150%', apply: mods => { mods.burn *= 2.5; } },
  { id: 'glue', icon: '🍯', name: '끈끈이 원액', rarity: 'rare', max: 2, effect: 'puddleSeconds', text: '허니팟 웅덩이 2.5배 오래', apply: mods => { mods.puddleSeconds *= 2.5; } },
  { id: 'voltage', icon: '⚡', name: '고전압', rarity: 'rare', max: 2, effect: 'splash', text: 'EMP 폭발 반경 +70%', apply: mods => { mods.splash *= 1.7; } },
  { id: 'vaccine', icon: '💉', name: '정밀 백신', rarity: 'rare', max: 2, effect: 'typeDamage.antivirus', text: '백신 피해 +90%', apply: mods => { mods.typeDamage.antivirus *= 1.9; } },
  { id: 'flak', icon: '🛩', name: '대공 레이더', rarity: 'rare', max: 2, effect: 'airDamage', text: '공중 적에게 주는 피해 +40%', apply: mods => { mods.airDamage *= 1.4; } },
  { id: 'interest', icon: '🏦', name: '이자 수익', rarity: 'rare', max: 2, effect: 'interest', text: '웨이브를 막을 때 가진 코인의 12% (최대 120)', apply: mods => { mods.interest += 0.12; } },
  { id: 'crit', icon: '🎯', name: '치명타 루틴', rarity: 'rare', max: 2, effect: 'critChance', text: '타워 공격 30% 확률로 피해 2배', apply: mods => { mods.critChance += 0.3; } },
  { id: 'profiler', icon: '🔍', name: '보스 분석', rarity: 'rare', max: 2, effect: 'bossDamage', text: '보스에게 주는 피해 +60%', apply: mods => { mods.bossDamage *= 1.6; } },
  { id: 'lag', icon: '🐌', name: '렉 유발', rarity: 'rare', max: 2, effect: 'enemySpeed', text: '모든 적 이동 속도 -15%', apply: mods => { mods.enemySpeed *= 0.85; } },
  { id: 'braces', icon: '{ }', name: '방어 프로토콜', rarity: 'rare', max: 2, effect: 'guardShots', text: "컴퓨터 대공 '{ }' 한 발 더", apply: mods => { mods.guardShots += 1; } },
  { id: 'selfheal', icon: '🌿', name: '자가 치유', rarity: 'rare', max: 2, effect: 'regen', text: '컴퓨터 초당 체력 +0.25 자동 회복', apply: mods => { mods.regen += 0.25; } },
  { id: 'shutter', icon: '🚪', name: '방화 셔터', rarity: 'rare', max: 2, effect: 'shutters', text: '웨이브마다 컴퓨터에 닿는 첫 공격을 막음', apply: mods => { mods.shutters += 1; } },
  { id: 'combo-guard', icon: '🔗', name: '콤보 보험', rarity: 'rare', max: 1, effect: 'comboShield', text: '컴퓨터가 맞아도 콤보가 끊기지 않음', apply: mods => { mods.comboShield = true; } },
  { id: 'momentum', icon: '📈', name: '탄력 타이핑', rarity: 'rare', max: 2, effect: 'comboBoost', text: '콤보 코인 배율에 3배 빨리 도달', apply: mods => { mods.comboBoost *= 3; } },
  { id: 'decrypt', icon: '🗝', name: '암호 해독기', rarity: 'rare', max: 1, effect: 'lockImmune', text: '보스가 타워를 잠그지 못함', apply: mods => { mods.lockImmune = true; } },
  { id: 'contagion', icon: '🦠', name: '화상 전염', rarity: 'rare', max: 1, effect: 'burnSpread', text: '불타던 적이 쓰러지면 옆 적에게 불이 옮음', apply: mods => { mods.burnSpread = true; } },
  { id: 'cryo', icon: '❄', name: '냉각 파동', rarity: 'rare', max: 2, effect: 'killChill', text: '적이 쓰러질 때 주변 적 4초 감속', apply: mods => { mods.killChill += 8 / 3; } },
  { id: 'servo', icon: '🦾', name: '서보 모터', rarity: 'rare', max: 2, effect: 'guardianDamage', text: '가디언 봇 공격력 +80%', apply: mods => { mods.guardianDamage *= 1.8; } },
  // ---------- 영웅 ----------
  { id: 'warhead', icon: '🚀', name: '다탄두', rarity: 'epic', max: 1, effect: 'typeShots.interceptor', text: '요격포가 표적 둘을 더 노림', apply: mods => { mods.typeShots.interceptor += 2; } },
  { id: 'awaken', icon: '🌟', name: '오버클럭 각성', rarity: 'epic', max: 1, effect: 'towerDamage', text: '모든 타워 피해 +50%', apply: mods => { mods.towerDamage *= 1.5; } },
  { id: 'backup', icon: '💾', name: '백업 서버', rarity: 'epic', max: 1, effect: 'backups', text: '체력이 0이 되면 한 번 50%로 되살아남', apply: mods => { mods.backups += 1; } },
  { id: 'gc', icon: '🗑', name: '가비지 컬렉터', rarity: 'epic', max: 1, effect: 'executeBelow', text: '체력 30% 아래 졸개는 맞는 즉시 처치', apply: mods => { mods.executeBelow = 0.3; } },
  { id: 'chain', icon: '💥', name: '연쇄 폭발', rarity: 'epic', max: 2, effect: 'killBlast', text: '지상 적이 쓰러지면 주변에 폭발 피해 2', apply: mods => { mods.killBlast += 2; } },
  { id: 'counter', icon: '↩', name: '역해킹', rarity: 'epic', max: 2, effect: 'counterHack', text: '컴퓨터가 맞으면 가까운 적 둘에게 피해 3', apply: mods => { mods.counterHack += 1.5; } },
  { id: 'downgrade', icon: '⬇', name: '다운그레이드', rarity: 'epic', max: 1, effect: 'enemyHpMinus', text: '졸개 체력 -1 (최소 1)', apply: mods => { mods.enemyHpMinus += 1; } },
  { id: 'firewall-rule', icon: '🧱', name: '포트 차단', rarity: 'epic', max: 1, effect: 'summonFactor', text: '보스가 부르는 졸개 -70%', apply: mods => { mods.summonFactor *= 0.3; } },
  { id: 'freebie', icon: '🎟', name: '무료 설치권', rarity: 'epic', max: 2, effect: 'freeBuilds', text: '다음 새 타워 두 개 공짜', apply: mods => { mods.freeBuilds += 2; } },
  { id: 'expansion', icon: '🧩', name: '랙 증설', rarity: 'epic', max: 1, effect: 'extraTowers', text: '타워 최대 개수 +6', apply: mods => { mods.extraTowers += 6; } },
  { id: 'early-bot', icon: '🤖', name: '조기 출동', rarity: 'legendary', max: 1, effect: 'instant:guardian', text: '가디언 봇이 지금 바로 출동', instant: engine => engine.deployGuardianEarly() },
  { id: 'wide-hand', icon: '🃏', name: '선택지 확장', rarity: 'epic', max: 1, effect: 'extraChoices', text: '앞으로 카드를 4장 중에서 고름', apply: mods => { mods.extraChoices += 1; } },
  // ---------- 전설 ----------
  { id: 'root-access', icon: '👑', name: '루트 권한', rarity: 'legendary', max: 1, effect: 'instant:computerLevel', text: '컴퓨터 강화 2단계 공짜', instant: engine => { engine.freeComputerUpgrade(); engine.freeComputerUpgrade(); } },
  { id: 'hotfix', icon: '🛠', name: '전체 핫픽스', rarity: 'epic', max: 1, effect: 'instant:towerLevels', text: '지금 있는 모든 타워 강화 +2 공짜', instant: engine => { engine.upgradeAllTowers(); engine.upgradeAllTowers(); } },
  { id: 'breakpoint', icon: '⏸', name: '브레이크포인트', rarity: 'legendary', max: 1, effect: 'waveFreeze', text: '웨이브마다 두 번(보스 웨이브는 한 번은 보스에게), 적이 길 절반 가까이 오면 모든 적 14초 멈춤(멈춘 적은 피해 2배)', apply: mods => { mods.waveFreeze += 14; } },
  { id: 'jackpot', icon: '🎰', name: '잭팟 커밋', rarity: 'legendary', max: 1, effect: 'jackpot', text: '낱말을 칠 때 25% 확률로 코인 8배', apply: mods => { mods.jackpot += 0.25; } },
  { id: 'lucky', icon: '🍀', name: '행운의 머지', rarity: 'legendary', max: 1, effect: 'luck', text: '앞으로 높은 등급 카드가 훨씬 잘 나옴', apply: mods => { mods.luck += 2; } }
]);

const CARD_BY_ID = Object.freeze(Object.fromEntries(DEFENSE_CARDS.map(card => [card.id, card])));
export const cardById = id => CARD_BY_ID[id] ?? null;

// 등급 가중치: 행운(luck)만큼 높은 등급을 키운다(희귀 ×(1+luck), 영웅 ×(1+2luck), 전설 ×(1+3luck))
export function rarityWeights(luck = 0) {
  const base = CARD_RULES.rarityWeight;
  return { common: base.common, rare: base.rare * (1 + luck), epic: base.epic * (1 + 2 * luck), legendary: base.legendary * (1 + 3 * luck) };
}

// 이번에 보여 줄 카드: 아직 최대 횟수에 안 닿은 카드 중 등급 가중치로 겹치지 않게 count장. O(카드 수 × count)
export function drawCards(picked, random = Math.random, count = CARD_RULES.choices, luck = 0) {
  const weightOf = rarityWeights(luck);
  const pickedCount = id => picked.filter(entry => entry === id).length;
  let pool = DEFENSE_CARDS.filter(card => pickedCount(card.id) < card.max);
  const hand = [];
  while (hand.length < count && pool.length) {
    const weights = pool.map(card => weightOf[card.rarity] ?? 1);
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < pool.length - 1 && roll >= weights[index]) roll -= weights[index++];
    hand.push(pool[index].id);
    pool = pool.filter((_, other) => other !== index);
  }
  return hand;
}
