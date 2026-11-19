// '배터리 구조 SOS' — 원작 해상구조 SOS의 규칙을 배터리 테마로 옮긴 대결 모드.
// 왼쪽 내 폰 vs 오른쪽 방전봇이 각자 배터리 셀 탑 위에 서 있고, 두 탑은 계속 방전(침몰)된다.
// 서로 배터리를 뺏어가면서, 내 배터리가 줄어드는 걸 막는 게임이다.
//  · 방전봇 탑 꼭대기 셀의 낱말을 치면 0.5칸을 '뺏는다'(상대 −0.5, 나 +0.5).
//  · 방전봇(AI)도 내 탑의 낱말을 쳐서 똑같이 뺏어간다.
//  · 지나가는 아이템(셀 +0.5, 보조배터리 +1, 특수 효과)은 먼저 끝까지 친 쪽이 가져간다.
//  · 8칸(100%)에 닿으면 충전 드론이 구조 → 스테이지 클리어. 0칸이 되면 바다에 빠져 패배.
import { SCORING, MAX_MULTIPLIER } from './engine.js';
import { TargetGameEngine, ARCADE_RULES, randomBetween } from './target-game.js';
import { PERSONAS, WEATHERS, DECK_SIZE, BASE_ITEM, mirrorProfile } from './battery-modes.js';
import { ITEM_RARITIES, rollRarity, tierValue, isRarity } from './item-rarity.js';

export const BATTERY_ITEMS = Object.freeze({
  cell: Object.freeze({ label: '배터리 셀', effect: '+0.5칸', gain: 0.5, weight: 0.5, bounty: 5 }),
  powerbank: Object.freeze({ label: '보조배터리 드론', effect: '+1칸', gain: 1, weight: 0.15, bounty: 10 }),
  eco: Object.freeze({ label: '저전력 모드', effect: '내 방전 4초 감속', gain: 0, weight: 0.12, bounty: 10 }),
  heat: Object.freeze({ label: '발열 폭탄', effect: '상대 방전 4초 가속', gain: 0, weight: 0.12, bounty: 10 }),
  blackout: Object.freeze({ label: '화면 꺼짐', effect: '상대 3초 정지', gain: 0, weight: 0.11, bounty: 10 }),
  // ---------- 덱 전용 새 아이템(덱에 넣어야 나온다) ----------
  reflect: Object.freeze({ label: '반사 방패', effect: '다음에 뺏기는 걸 막고(희귀부터 되돌림)', gain: 0, weight: 0.12, bounty: 10 }),
  obfuscate: Object.freeze({ label: '난독화', effect: '상대 낱말 6초 길게', gain: 0, weight: 0.12, bounty: 10 }),
  magnet: Object.freeze({ label: '셀 자석', effect: '다음에 화면에 들어오는 셀 몇 개 자동 획득', gain: 0, weight: 0.1, bounty: 10 }),
  overclock: Object.freeze({ label: '오버클럭', effect: '6초간 뺏는 양 2배', gain: 0, weight: 0.11, bounty: 10 }),
  cleanse: Object.freeze({ label: '백신 패치', effect: '나쁜 효과 지우고 잠깐 뺏기·방해 면역', gain: 0, weight: 0.1, bounty: 10 }),
  trap: Object.freeze({ label: '함정 셀', effect: '가짜 셀을 띄움(상대가 먹으면 손해)', gain: 0, weight: 0.11, bounty: 10 }),
  lucky: Object.freeze({ label: '행운 낚시', effect: '잠깐 동안 내가 잡는 셀 2배', gain: 0, weight: 0.1, bounty: 10 })
});
// 원래 다섯 종(덱을 안 고르면, 그리고 대전 모드는 이것만)
export const CLASSIC_ITEMS = Object.freeze(['cell', 'powerbank', 'eco', 'heat', 'blackout']);
export const ITEM_EFFECTS = Object.freeze({
  obfuscateFactor: 2.5, obfuscateMinLength: 8,
  overclockFactor: 2, trapFoolChance: 1, luckyCellFactor: 3,
  ecoFactor: -1.6, heatFactor: 3.6
});
// 등급별 효과 크기 [일반, 희귀, 영웅, 전설]. 배터리 셀(기본 아이템)은 등급 없이 늘 +0.5칸.
// 값은 scripts/balance/battery-sim.mjs로 잰 '판세 변화(내 칸 − 상대 칸)'가 일반 등급끼리 비슷하고(≈0.8칸),
// 등급이 오를 때마다 약 1.6배씩(일반 1 : 희귀 1.6 : 영웅 2.5 : 전설 4) 커지도록 맞췄다
export const ITEM_TIERS = Object.freeze({
  powerbank: Object.freeze({ unit: '칸', gain: [0.8, 1.3, 2, 3.2] }),
  eco: Object.freeze({ unit: '초', seconds: [6, 9.6, 15, 24] }),
  heat: Object.freeze({ unit: '초', seconds: [6, 9.6, 15, 24] }),
  blackout: Object.freeze({ unit: '초', seconds: [4.4, 6.4, 11, 17.5] }),
  reflect: Object.freeze({ unit: '배', factor: [0, 0.3, 1, 2.2] }),
  obfuscate: Object.freeze({ unit: '초', seconds: [6, 10.5, 17, 27] }),
  magnet: Object.freeze({ unit: '개', count: [2, 3, 4, 7] }),
  overclock: Object.freeze({ unit: '초', seconds: [8, 13, 20, 32] }),
  cleanse: Object.freeze({ unit: '초', seconds: [11, 17.5, 27, 44] }),
  trap: Object.freeze({ unit: '개', count: [1, 2, 3, 4], loss: [1, 0.7, 0.75, 0.95] }),
  lucky: Object.freeze({ unit: '초', seconds: [5.7, 9, 14, 23] })
});

// 화면·기록에 쓰는 효과 설명(등급 반영). 예: itemEffectText('eco', 'epic') → '15초간 방전 대신 충전'
export function itemEffectText(itemKey, rarity = 'common') {
  const number = value => String(Math.round(value * 10) / 10);
  const seconds = number(itemTier(itemKey, rarity, 'seconds'));
  switch (itemKey) {
    case 'cell': return '+0.5칸';
    case 'powerbank': return `+${number(itemTier(itemKey, rarity, 'gain'))}칸`;
    case 'eco': return `${seconds}초간 방전 대신 충전`;
    case 'heat': return `상대 ${seconds}초간 급방전`;
    case 'blackout': return `상대 ${seconds}초 멈춤`;
    case 'reflect': {
      const factor = itemTier(itemKey, rarity, 'factor');
      return factor > 0 ? `다음 뺏기를 막고 ${number(factor)}배 되돌림` : '다음 뺏기 1번 막기';
    }
    case 'obfuscate': return `상대 낱말 ${seconds}초간 길게`;
    case 'magnet': return `다음 셀 ${itemTier(itemKey, rarity, 'count')}개 자동 획득`;
    case 'overclock': return `${seconds}초간 뺏는 양 2배`;
    case 'cleanse': return `나쁜 효과 지우고 ${seconds}초 면역`;
    case 'trap': return `가짜 셀 ${itemTier(itemKey, rarity, 'count')}개(먹으면 −${number(itemTier(itemKey, rarity, 'loss'))}칸)`;
    case 'lucky': return `${seconds}초간 잡는 셀 3배`;
    default: return BATTERY_ITEMS[itemKey]?.effect ?? '';
  }
}

// 이 아이템(등급 포함)의 효과 크기 하나. 표에 없으면 fallback
export function itemTier(itemKey, rarity, field, fallback = 0) {
  const values = ITEM_TIERS[itemKey]?.[field];
  return values ? tierValue(values, rarity) : fallback;
}

export const BATTERY_RULES = Object.freeze({
  goalCells: 8,
  startCells: 4,
  stealCells: 0.5,
  drainBounty: 10,
  baseSinkPerSecond: 0.05,
  stageSinkStep: 0.1,
  blackoutSeconds: 3,
  itemInterval: [1.4, 2.4],
  itemSpeed: 0.11,
  itemBand: [0.2, 0.6],
  itemGap: 0.09,
  maxItems: 4,
  stageClearPause: 1.6,
  winBonus: Object.freeze({ charged: 300, sunk: 150 }),
  winBonusPerCharacterCap: 10,
  // 방전봇 타자 속도(글자/초, 레벨별). Lv.2 1.8 ≈ 분당 108타(생각하는 시간 포함 실제로는 더 느림)
  aiCharactersPerSecond: Object.freeze({ 1: 1.3, 2: 1.8, 3: 2.5, 4: 3.3 }),
  aiStageSpeedStep: 0.12,
  aiThinkSeconds: [0.6, 1.4],
  aiAttackChance: 0.25,
  // 따라잡기 도움: 내 탑이 mercyCells 이하면 방전봇이 mercyFactor배로 느려진다
  mercyCells: 2,
  mercyFactor: 0.65
});

// 서버 점수 검증용 상한: 글자당 최대 배율 타격 점수 + 최대 아이템 보너스/최소 길이 + 스테이지 보너스 상한
export const BATTERY_MAX_POINTS_PER_CHARACTER = SCORING.basePoints * MAX_MULTIPLIER
  + Math.max(BATTERY_RULES.drainBounty, ...Object.values(BATTERY_ITEMS).map(item => item.bounty)) / ARCADE_RULES.minTokenLength
  + BATTERY_RULES.winBonusPerCharacterCap;

const RIVAL_NAMES = Object.freeze({ 1: '꾸벅봇', 2: '방전봇', 3: '과열봇', 4: '블랙아웃봇' });

function createSide(cells = BATTERY_RULES.startCells) {
  return { cells, ecoUntil: 0, heatUntil: 0, reflect: -1, obfuscatedUntil: 0, magnetCharges: 0, overclockUntil: 0, immuneUntil: 0, luckyUntil: 0, pendingTraps: [] };
}

export class BatteryEngine extends TargetGameEngine {
  constructor(options) {
    super({ ...options, mode: 'battery' });
    // 혼자 하기 판 꾸미기(없으면 예전 그대로): persona = 방전봇 성격, deck = 셀 말고 나올 아이템, weather = 바다 날씨
    this.persona = PERSONAS[options.persona] ? options.persona : null;
    this.personaAi = this.persona ? PERSONAS[this.persona].ai : null;
    this.mirror = this.personaAi?.mirror ? (options.mirrorProfile ?? mirrorProfile(null)) : null;
    const deck = Array.isArray(options.deck) ? options.deck.filter(key => BATTERY_ITEMS[key] && key !== BASE_ITEM).slice(0, DECK_SIZE) : null;
    this.itemPool = deck?.length ? [BASE_ITEM, ...deck] : [...CLASSIC_ITEMS];
    this.weather = WEATHERS[options.weather] ? options.weather : 'calm';
    this.nextWaveAt = this.weather === 'waves' ? WEATHERS.waves.every : Infinity;
    this.waveUntil = 0;
    this.luckyUntil = 0;
    this.lives = 1;
    this.stage = 1;
    this.stagesCleared = 0;
    this.stageStartKeystrokes = 0;
    this.pauseUntil = 0;
    this.me = createSide();
    this.rival = createSide(this.personaAi?.startCells ?? BATTERY_RULES.startCells);
    this.items = [];
    this.nextItemAt = 0.6;
    this.rivalWord = { id: this.nextId++, kind: 'rival-cell', token: null };
    this.myWord = { id: this.nextId++, kind: 'my-cell', token: null };
    this.rivalWord.token = this.pickToken(this.rivalWord.id);
    this.myWord.token = this.drawWeightedToken();
    this.hiddenUntil = 0;
    this.ai = { targetId: null, progress: 0, thinkUntil: 1.2, pausedUntil: 0 };
    this.collected = Object.fromEntries(Object.keys(BATTERY_ITEMS).map(key => [key, 0]));
    this.drains = 0;
    this.stolen = 0;
    this.outcome = null;
    this.winAt = null;
  }

  // ---------- 목표 ----------
  targetables() {
    const list = this.items.filter(item => !item.consumed);
    if (this.gameTime >= this.hiddenUntil && this.rivalWord.token) list.push(this.rivalWord);
    return list;
  }

  findEntity(id) {
    if (id === this.rivalWord.id) return this.rivalWord;
    if (id === this.myWord.id) return this.myWord;
    return this.items.find(item => item.id === id) ?? null;
  }

  // 곧 화면 밖으로 나갈 아이템부터, 상대 탑 낱말은 그 사이 중간 우선순위
  targetPriority(entity) {
    if (entity.kind !== 'item') return 0.5;
    return entity.direction > 0 ? 1 - entity.x : entity.x;
  }

  currentWeapon() {
    return 'bolt';
  }

  // 혼자 하기 상대 이름: 레벨마다 다른 방전봇 캐릭터(battery-characters.js의 DRAIN_BOTS와 같은 이름)
  get rivalName() {
    if (this.persona) return PERSONAS[this.persona].name;
    return RIVAL_NAMES[this.level] ?? RIVAL_NAMES[2];
  }

  sinkPerSecond() {
    const weather = this.weather === 'ebb' ? WEATHERS.ebb.sink : 1;
    const wave = this.gameTime < this.waveUntil ? WEATHERS.waves.sink / WEATHERS.waves.seconds / BATTERY_RULES.baseSinkPerSecond : 0;
    return BATTERY_RULES.baseSinkPerSecond * this.difficulty.speed * (1 + (this.stage - 1) * BATTERY_RULES.stageSinkStep) * weather
      + BATTERY_RULES.baseSinkPerSecond * wave;
  }

  // 파도 날씨: every초마다 큰 파도(seconds초 동안 두 탑이 sink칸 더 가라앉음)
  stepWeather() {
    if (this.gameTime < this.nextWaveAt) return;
    this.nextWaveAt = this.gameTime + WEATHERS.waves.every;
    this.waveUntil = this.gameTime + WEATHERS.waves.seconds;
    this.emit('big-wave', { seconds: WEATHERS.waves.seconds });
  }

  itemSpeed() {
    const weather = WEATHERS[this.weather]?.itemSpeed ?? 1;
    return BATTERY_RULES.itemSpeed * (1 + (this.stage - 1) * 0.05) * weather;
  }

  sideSinkFactor(side) {
    let factor = 1;
    if (this.gameTime < side.ecoUntil) factor *= ITEM_EFFECTS.ecoFactor;
    if (this.gameTime < side.heatUntil) factor *= ITEM_EFFECTS.heatFactor;
    return factor;
  }

  aiCharactersPerSecond() {
    const mercy = this.me.cells <= BATTERY_RULES.mercyCells ? BATTERY_RULES.mercyFactor : 1;
    const base = this.mirror ? this.mirror.cps : BATTERY_RULES.aiCharactersPerSecond[this.level] * (this.personaAi?.speed ?? 1);
    return base * (1 + (this.stage - 1) * BATTERY_RULES.aiStageSpeedStep) * mercy * (this.ai.burst ?? 1);
  }

  // ---------- 진행 ----------
  step(frameSeconds) {
    if (this.winAt != null) {
      if (this.gameTime >= this.winAt) this.finish();
      return;
    }
    if (this.gameTime < this.pauseUntil) return;
    if (!this.greeted && this.persona) {
      this.greeted = true;
      this.taunt('start');
    }
    this.stepWeather();
    this.drainTowers(frameSeconds);
    if (this.status !== 'running' || this.gameTime < this.pauseUntil) return;
    this.moveItems(frameSeconds);
    this.stepAi(frameSeconds);
    if (this.status !== 'running' || this.gameTime < this.pauseUntil) return;
    this.spawnIfDue();
  }

  drainTowers(frameSeconds) {
    const sink = this.sinkPerSecond() * frameSeconds;
    this.me.cells -= sink * this.sideSinkFactor(this.me);
    this.rival.cells -= sink * this.sideSinkFactor(this.rival);
    this.checkOutcome();
  }

  // 승리 연출 중에는 입력을 받지 않는다(판이 이미 끝남)
  input(character, nowMs) {
    if (this.winAt != null) return { accepted: false, reason: 'finished' };
    return super.input(character, nowMs);
  }

  checkOutcome() {
    if (this.winAt != null) return null;
    this.peakCells = Math.max(this.peakCells ?? 0, this.me.cells);
    if (this.me.cells >= BATTERY_RULES.goalCells) return this.clearStage('charged');
    if (this.rival.cells <= 0) return this.clearStage('sunk');
    if (this.me.cells <= 0) return this.loseMatch('sunk');
    if (this.rival.cells >= BATTERY_RULES.goalCells) return this.loseMatch('rival-charged');
    return null;
  }

  // 스테이지 보너스는 이번 스테이지에 친 글자 수에 비례하는 상한을 둔다(가만히 있다 상대가 침몰해도 점수 폭증 없음).
  clearStage(how) {
    const typedThisStage = this.correctKeystrokes - this.stageStartKeystrokes;
    const bonus = Math.min(BATTERY_RULES.winBonus[how] * (1 + (this.stage - 1) * 0.25), typedThisStage * BATTERY_RULES.winBonusPerCharacterCap);
    this.score += Math.round(bonus);
    this.stagesCleared++;
    this.emit('stage-clear', { stage: this.stage, how, bonus: Math.round(bonus) });
    this.taunt('lose');
    // 혼자 하기는 구조되거나 방전봇이 가라앉으면 그 판 승리로 끝난다. 클리어 연출을 잠깐 보여 준 뒤 finish
    this.outcome = how === 'charged' ? 'rescued' : 'rival-sunk';
    this.winAt = this.gameTime + BATTERY_RULES.stageClearPause;
    this.clearBuffer();
    return how;
  }

  loseMatch(how) {
    this.taunt('win');
    this.outcome = how;
    this.me.cells = Math.max(0, this.me.cells);
    this.clearBuffer();
    this.loseLife({ how });
    return how;
  }

  // ---------- 아이템 ----------
  chooseItemType() {
    const entries = this.itemPool.map(key => [key, BATTERY_ITEMS[key]]);
    let roll = this.random() * entries.reduce((sum, [, item]) => sum + item.weight, 0);
    for (const [key, item] of entries) {
      roll -= item.weight;
      if (roll <= 0) return key;
    }
    return 'cell';
  }

  chooseItemY() {
    const [min, max] = BATTERY_RULES.itemBand;
    const occupied = this.items.filter(item => !item.consumed).map(item => item.y);
    for (let attempt = 0; attempt < 10; attempt++) {
      const y = min + this.random() * (max - min);
      if (occupied.every(other => Math.abs(other - y) >= BATTERY_RULES.itemGap)) return y;
    }
    return null;
  }

  // 줄 서 있는 함정 셀을 0.8초 간격으로 하나씩 띄운다(자리·개수 제한은 일반 아이템과 같다)
  spawnTraps() {
    if (!(this.gameTime >= (this.nextTrapAt ?? Infinity))) return;
    const side = this.me.pendingTraps.length ? this.me : this.rival.pendingTraps.length ? this.rival : null;
    if (!side) {
      this.nextTrapAt = Infinity;
      return;
    }
    this.nextTrapAt = this.gameTime + 0.8;
    if (this.items.filter(item => !item.consumed).length >= BATTERY_RULES.maxItems) return;
    const y = this.chooseItemY();
    if (y === null) return;
    const trap = side.pendingTraps.shift();
    this.spawnItem('cell', y, trap.owner === 'me' ? -1 : 1, trap.owner, trap.rarity);
  }

  spawnIfDue() {
    this.spawnTraps();
    if (this.gameTime < this.nextItemAt) return;
    const rate = WEATHERS[this.weather]?.itemRate ?? 1;
    this.nextItemAt = this.gameTime + randomBetween(this.random, BATTERY_RULES.itemInterval) / (1 + (this.stage - 1) * 0.08) / rate;
    if (this.items.filter(item => !item.consumed).length >= BATTERY_RULES.maxItems) return;
    const y = this.chooseItemY();
    if (y !== null) this.spawnItem(this.chooseItemType(), y);
  }

  // rarity: 정하지 않으면 등급을 뽑는다(배터리 셀은 늘 일반). 함정 셀은 놓은 함정의 등급·손해량을 물려받는다
  spawnItem(itemType = 'cell', y = 0.4, direction = this.random() < 0.5 ? 1 : -1, trapOwner = null, rarity = null) {
    if (WEATHERS[this.weather]?.direction) direction = WEATHERS[this.weather].direction;
    const item = {
      id: this.nextId++, kind: 'item', item: itemType, x: direction > 0 ? -0.08 : 1.08, y, direction,
      consumed: false, takenBy: null, spawnedAt: this.gameTime, token: null,
      rarity: isRarity(rarity) ? rarity : itemType === BASE_ITEM ? 'common' : rollRarity(this.random)
    };
    // 함정 셀: 겉보기엔 셀. 놓은 쪽이 아닌 쪽이 먹으면 손해. 방전봇은 내 함정에 반쯤 속는다
    if (trapOwner) {
      item.trapOwner = trapOwner;
      item.trapLoss = itemTier('trap', item.rarity, 'loss', 1);
      item.aiFooled = this.random() < ITEM_EFFECTS.trapFoolChance;
    }
    item.token = this.pickToken(item.id);
    this.items.push(item);
    this.emit('item-spawn', { item });
    return item;
  }

  moveItems(frameSeconds) {
    const speed = this.itemSpeed();
    for (const item of this.items) {
      if (item.consumed) continue;
      item.x += item.direction * speed * frameSeconds;
      if (this.magnetPull(item)) continue;
      if (item.x < -0.12 || item.x > 1.12) {
        item.consumed = true;
        item.missed = true;
        this.releaseTargetIf(item.id, 'item-missed');
        if (this.ai.targetId === item.id) this.resetAiTarget(0.2);
      }
    }
    // 먹힌 아이템은 날아가는 연출(투사체 비행·흡수 0.6초) 동안만 남긴다
    this.items = this.items.filter(item => !item.consumed
      || this.projectiles.some(projectile => projectile.targetId === item.id)
      || (item.takenAt !== undefined && this.gameTime - item.takenAt < 0.6));
  }

  // 셀 자석: 화면 안에 들어온 셀·보조배터리(함정 제외)를 자석을 켠 쪽이 바로 가져간다. 가져갔으면 true
  magnetPull(item) {
    if (item.trapOwner || !['cell', 'powerbank'].includes(item.item) || item.x < 0 || item.x > 1) return false;
    const owner = this.me.magnetCharges > 0 ? 'me' : this.rival.magnetCharges > 0 ? 'rival' : null;
    if (!owner) return false;
    this[owner].magnetCharges--;
    item.consumed = true;
    item.takenBy = owner;
    item.takenAt = this.gameTime;
    this.releaseTargetIf(item.id, owner === 'me' ? 'magnet' : 'stolen');
    if (this.ai.targetId === item.id) this.resetAiTarget(0.2);
    if (owner === 'me') {
      this.itemsCollected++;
      this.collected[item.item]++;
    }
    this.applyItem(owner === 'me' ? this.me : this.rival, owner === 'me' ? this.rival : this.me, item);
    this.emit('magnet-take', { item, owner });
    this.checkOutcome();
    return true;
  }

  // 아이템 효과: side = 가져간 쪽, opponent = 상대. 상대에게 거는 나쁜 효과는 면역(백신 패치) 중이면 막힌다
  applyItem(side, opponent, item) {
    const config = BATTERY_ITEMS[item.item];
    const now = this.gameTime;
    const sideKey = side === this.me ? 'me' : 'rival';
    // 함정 셀: 놓은 쪽이 먹으면 아무 일 없고, 상대가 먹으면 손해
    if (item.trapOwner) {
      if (item.trapOwner !== sideKey) {
        side.cells -= item.trapLoss ?? itemTier('trap', item.rarity, 'loss', 1);
        this.emit('trap-sprung', { item, victim: sideKey });
      }
      return;
    }
    const opponentImmune = now < opponent.immuneUntil;
    const rarity = item.rarity ?? 'common';
    const seconds = itemTier(item.item, rarity, 'seconds');
    const lucky = item.item === BASE_ITEM && now < (side.luckyUntil ?? 0) ? ITEM_EFFECTS.luckyCellFactor : 1;
    const gain = (item.item === 'powerbank' ? itemTier('powerbank', rarity, 'gain') : config.gain) * lucky;
    if (gain) side.cells = Math.min(BATTERY_RULES.goalCells, side.cells + gain);
    if (item.item === 'eco') {
      side.ecoUntil = Math.max(side.ecoUntil, now) + seconds;
      side.ecoSpan = side.ecoUntil - now;
    }
    if (item.item === 'heat' && !opponentImmune) opponent.heatUntil = Math.max(opponent.heatUntil, now) + seconds;
    // 반사 방패: 일반은 막기만(배율 0), 희귀부터 뺏으려던 양 × 배율만큼 되돌린다. -1 = 방패 없음
    if (item.item === 'reflect') side.reflect = Math.max(side.reflect, itemTier('reflect', rarity, 'factor', 0));
    if (item.item === 'blackout') {
      // 화면 꺼짐: 상대가 seconds초 동안 아무것도 못 함(방전봇은 멈춤, 내가 당하면 방전봇 탑 낱말이 안 보임)
      if (side === this.me) this.ai.pausedUntil = Math.max(this.ai.pausedUntil, now + seconds);
      else this.hiddenUntil = Math.max(this.hiddenUntil, now + seconds);
    }
    if (item.item === 'obfuscate' && !opponentImmune) {
      opponent.obfuscatedUntil = Math.max(opponent.obfuscatedUntil, now) + seconds;
      // 내가 당했으면 상대 탑 낱말을 바로 긴 낱말로 바꾼다
      if (opponent === this.me && this.targetId !== this.rivalWord.id) this.rivalWord.token = this.pickToken(this.rivalWord.id);
    }
    if (item.item === 'magnet') side.magnetCharges += itemTier('magnet', rarity, 'count', 1);
    if (item.item === 'overclock') side.overclockUntil = Math.max(side.overclockUntil, now) + seconds;
    if (item.item === 'cleanse') {
      side.heatUntil = 0;
      side.obfuscatedUntil = 0;
      side.immuneUntil = Math.max(side.immuneUntil, now) + seconds;
    }
    if (item.item === 'lucky') side.luckyUntil = Math.max(side.luckyUntil ?? 0, now) + seconds;
    // 함정: 등급만큼 가짜 셀을 줄 세워 두고 자리가 날 때마다 하나씩 띄운다(spawnTraps)
    if (item.item === 'trap') {
      const count = itemTier('trap', rarity, 'count', 1);
      for (let index = 0; index < count; index++) side.pendingTraps.push({ rarity, owner: sideKey });
      this.nextTrapAt = Math.min(this.nextTrapAt ?? Infinity, now);
    }
  }

  // 뺏기: attacker가 victim의 셀을 가져온다(오버클럭이면 2배). victim에게 반사 방패가 있으면 거꾸로 attacker가 뺏긴다
  steal(attacker, victim) {
    const amount = BATTERY_RULES.stealCells * (this.gameTime < attacker.overclockUntil ? ITEM_EFFECTS.overclockFactor : 1);
    // 백신 패치 면역 중이면 뺏기 자체가 막힌다
    if (this.gameTime < victim.immuneUntil) {
      this.emit('immune-block', { attacker: attacker === this.me ? 'me' : 'rival' });
      return { stolen: 0, reflected: false, blocked: true };
    }
    if (victim.reflect >= 0) {
      // 반사 방패: 뺏으려던 양 × 방패 등급 배율만큼 거꾸로 뺏어 온다(일반 = 0배 = 막기만)
      const reflected = amount * victim.reflect;
      victim.reflect = -1;
      const taken = Math.min(reflected, Math.max(0, attacker.cells));
      attacker.cells -= reflected;
      victim.cells = Math.min(BATTERY_RULES.goalCells, victim.cells + taken);
      this.emit('reflect', { attacker: attacker === this.me ? 'me' : 'rival', amount: reflected });
      return { stolen: -taken, reflected: true };
    }
    const stolen = Math.min(amount, Math.max(0, victim.cells));
    victim.cells -= amount;
    attacker.cells = Math.min(BATTERY_RULES.goalCells, attacker.cells + stolen);
    return { stolen, reflected: false };
  }

  // 난독화에 걸린 쪽이 칠 낱말은 길게: 첫 글자가 겹치지 않는 낱말 중 가장 긴 것(되도록 obfuscateMinLength 이상)
  pickToken(excludeId = null) {
    if (!(this.gameTime < this.me?.obfuscatedUntil)) return super.pickToken(excludeId);
    const used = new Set(this.targetables().filter(entity => entity.id !== excludeId).map(entity => entity.token.text[0]));
    let best = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const token = this.drawWeightedToken();
      if (used.has(token.text[0])) continue;
      if (!best || token.text.length > best.text.length) best = token;
      if (best.text.length >= ITEM_EFFECTS.obfuscateMinLength) break;
    }
    return best ?? super.pickToken(excludeId);
  }

  // 상황별 도발 대사(성격이 있을 때만). chance 확률로만 말해 너무 수다스럽지 않게
  taunt(kind, chance = 1) {
    const lines = this.persona ? PERSONAS[this.persona].taunts[kind] : null;
    if (!lines?.length || this.random() >= chance) return;
    this.emit('taunt', { kind, text: lines[Math.floor(this.random() * lines.length)] });
  }

  // ---------- 상대 AI ----------
  resetAiTarget(thinkSeconds = randomBetween(this.random, BATTERY_RULES.aiThinkSeconds)) {
    this.ai.targetId = null;
    this.ai.progress = 0;
    this.ai.thinkUntil = this.gameTime + thinkSeconds;
  }

  // 남은 시간 안에 칠 수 있는 아이템을 고르거나, 일정 확률로 내 탑을 공격한다.
  chooseAiTarget() {
    const cps = this.aiCharactersPerSecond();
    const speed = this.itemSpeed();
    const reachable = this.items.filter(item => {
      if (item.consumed) return false;
      // 자기 함정은 안 먹고, 내 함정은 반쯤 속는다
      if (item.trapOwner === 'rival' || (item.trapOwner === 'me' && !item.aiFooled)) return false;
      const remaining = item.direction > 0 ? 1.1 - item.x : item.x + 0.1;
      return remaining / speed > item.token.text.length / cps + 0.2;
    });
    // 얌체: 내가 치던 아이템이 닿을 만하면 그걸 가로챈다
    if (this.personaAi?.snipe) {
      const mine = reachable.find(item => item.id === this.targetId);
      if (mine) {
        this.ai.sniping = true;
        return mine.id;
      }
    }
    const attackChance = this.mirror ? this.mirror.attack : this.personaAi?.attack ?? BATTERY_RULES.aiAttackChance;
    const wantsAttack = this.random() < attackChance || reachable.length === 0;
    if (wantsAttack) return this.myWord.id;
    // 셀 높이가 낮을수록 셀을, 높으면 공격형 아이템을 선호
    reachable.sort((first, second) => BATTERY_ITEMS[second.item].gain - BATTERY_ITEMS[first.item].gain || first.token.text.length - second.token.text.length);
    return reachable[0].id;
  }

  stepAi(frameSeconds) {
    if (this.gameTime < this.ai.pausedUntil) return;
    if (this.ai.targetId === null) {
      if (this.gameTime < this.ai.thinkUntil) return;
      this.ai.sniping = false;
      this.ai.burst = 1;
      this.ai.targetId = this.chooseAiTarget();
      this.ai.progress = 0;
      // 도박꾼: 가끔 이번 낱말만 아주 빠르게
      const burst = this.personaAi?.burst;
      if (burst && this.random() < burst.chance) {
        this.ai.burst = burst.factor;
        this.taunt('burst', 0.7);
      }
      this.emit('rival-lock', { targetId: this.ai.targetId, burst: this.ai.burst > 1, snipe: this.ai.sniping });
    }
    const target = this.findEntity(this.ai.targetId);
    if (!target || (target.kind === 'item' && target.consumed)) {
      this.resetAiTarget(0.25);
      return;
    }
    this.ai.progress += this.aiCharactersPerSecond() * frameSeconds;
    // 난독화에 걸린 방전봇은 낱말이 길어진 셈(더 오래 쳐야 한다)
    const obfuscated = this.gameTime < this.rival.obfuscatedUntil ? ITEM_EFFECTS.obfuscateFactor : 1;
    if (this.ai.progress < target.token.text.length * obfuscated) return;

    if (target.kind === 'item') {
      target.consumed = true;
      target.takenBy = 'rival';
      target.takenAt = this.gameTime;
      this.applyItem(this.rival, this.me, target);
      if (this.targetId === target.id) {
        this.stolen++;
        this.releaseTargetIf(target.id, 'stolen');
      }
      this.emit('rival-take', { item: target });
      if (this.ai.sniping) this.taunt('steal', 0.8);
      else this.taunt('take', 0.35);
    } else {
      // 방전봇이 내 배터리를 뺏어간다(반사 방패가 있으면 되돌아간다)
      const { stolen, reflected } = this.steal(this.rival, this.me);
      this.myWord.token = this.drawWeightedToken();
      this.emit('rival-attack', { cells: this.me.cells, stolen, reflected });
      if (!reflected) this.taunt('attack', 0.3);
    }
    this.resetAiTarget();
    this.checkOutcome();
  }

  // ---------- 발사 ----------
  onFire(target) {
    if (target.kind === 'item') {
      target.consumed = true;
      target.takenBy = 'me';
      if (this.ai.targetId === target.id) this.resetAiTarget(0.3);
    }
  }

  onProjectileLanded(entity) {
    if (this.status !== 'running') return;
    if (entity.kind === 'item') {
      entity.takenAt = this.gameTime;
      this.itemsCollected++;
      this.collected[entity.item]++;
      this.score += BATTERY_ITEMS[entity.item].bounty;
      this.applyItem(this.me, this.rival, entity);
      this.emit('item', { item: entity });
    } else if (entity.kind === 'rival-cell') {
      // 방전봇의 배터리를 뺏어온다(상대에게 반사 방패가 있으면 내가 뺏긴다)
      const { stolen, reflected } = this.steal(this.me, this.rival);
      this.drains++;
      if (!reflected) this.score += BATTERY_RULES.drainBounty;
      this.emit('drain', { cells: this.rival.cells, stolen, reflected });
      if (!reflected) this.taunt('hurt', 0.25);
    }
    this.checkOutcome();
  }

  // 상대 탑 낱말은 발사 즉시 새 낱말로 바꿔 연속 공격할 수 있게 한다.
  fire(target) {
    const result = super.fire(target);
    if (target.kind === 'rival-cell') target.token = this.pickToken(target.id);
    return result;
  }

  // 렌더링용: AI가 지금 치고 있는 낱말과 진행 글자 수
  aiProgressFor(entityId) {
    return this.ai.targetId === entityId ? Math.floor(this.ai.progress) : 0;
  }

  snapshotExtras() {
    const eco = Math.max(0, this.me.ecoUntil - this.gameTime);
    return {
      stage: this.stage,
      myCells: Math.max(0, this.me.cells),
      rivalCells: Math.max(0, this.rival.cells),
      powerRemaining: eco,
      powerSeconds: Math.max(eco, this.me.ecoSpan ?? 1),
      persona: this.persona,
      weather: this.weather
    };
  }

  summaryExtras() {
    return {
      stage: this.stage,
      stagesCleared: this.stagesCleared,
      peakCells: Math.max(this.peakCells ?? 0, this.me.cells),
      goalCells: BATTERY_RULES.goalCells,
      outcome: this.outcome,
      collected: { ...this.collected },
      drains: this.drains,
      stolen: this.stolen,
      persona: this.persona,
      weather: this.weather,
      deck: this.itemPool.filter(key => key !== BASE_ITEM)
    };
  }
}
