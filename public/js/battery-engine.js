// '배터리 구조 SOS' — 원작 해상구조 SOS의 규칙을 배터리 테마로 옮긴 대결 모드.
// 왼쪽 내 폰 vs 오른쪽 방전봇이 각자 배터리 셀 탑 위에 서 있고, 두 탑은 계속 방전(침몰)된다.
// 서로 배터리를 뺏어가면서, 내 배터리가 줄어드는 걸 막는 게임이다.
//  · 방전봇 탑 꼭대기 셀의 낱말을 치면 0.5칸을 '뺏는다'(상대 −0.5, 나 +0.5).
//  · 방전봇(AI)도 내 탑의 낱말을 쳐서 똑같이 뺏어간다.
//  · 지나가는 아이템(셀 +0.5, 보조배터리 +1, 특수 효과)은 먼저 끝까지 친 쪽이 가져간다.
//  · 8칸(100%)에 닿으면 충전 드론이 구조 → 스테이지 클리어. 0칸이 되면 바다에 빠져 패배.
import { SCORING, MAX_MULTIPLIER } from './engine.js';
import { TargetGameEngine, ARCADE_RULES, randomBetween } from './target-game.js';

export const BATTERY_ITEMS = Object.freeze({
  cell: Object.freeze({ label: '배터리 셀', effect: '+0.5칸', gain: 0.5, weight: 0.5, bounty: 5 }),
  powerbank: Object.freeze({ label: '보조배터리 드론', effect: '+1칸', gain: 1, weight: 0.15, bounty: 10 }),
  eco: Object.freeze({ label: '저전력 모드', effect: '내 방전 4초 감속', gain: 0, weight: 0.12, bounty: 10 }),
  heat: Object.freeze({ label: '발열 폭탄', effect: '상대 방전 4초 가속', gain: 0, weight: 0.12, bounty: 10 }),
  blackout: Object.freeze({ label: '화면 꺼짐', effect: '상대 3초 정지', gain: 0, weight: 0.11, bounty: 10 })
});

export const BATTERY_RULES = Object.freeze({
  goalCells: 8,
  startCells: 3,
  stealCells: 0.5,
  drainBounty: 10,
  baseSinkPerSecond: 0.075,
  stageSinkStep: 0.1,
  ecoSeconds: 4,
  ecoFactor: 0.35,
  heatSeconds: 4,
  heatFactor: 2.2,
  blackoutSeconds: 3,
  itemInterval: [1.4, 2.4],
  itemSpeed: 0.11,
  itemBand: [0.2, 0.6],
  itemGap: 0.09,
  maxItems: 4,
  stageClearPause: 1.6,
  winBonus: Object.freeze({ charged: 300, sunk: 150 }),
  winBonusPerCharacterCap: 10,
  aiCharactersPerSecond: Object.freeze({ 1: 2.0, 2: 2.8, 3: 3.6, 4: 4.6 }),
  aiStageSpeedStep: 0.12,
  aiThinkSeconds: [0.35, 0.9],
  aiAttackChance: 0.35
});

// 서버 점수 검증용 상한: 글자당 최대 배율 타격 점수 + 최대 아이템 보너스/최소 길이 + 스테이지 보너스 상한
export const BATTERY_MAX_POINTS_PER_CHARACTER = SCORING.basePoints * MAX_MULTIPLIER
  + Math.max(BATTERY_RULES.drainBounty, ...Object.values(BATTERY_ITEMS).map(item => item.bounty)) / ARCADE_RULES.minTokenLength
  + BATTERY_RULES.winBonusPerCharacterCap;

function createSide() {
  return { cells: BATTERY_RULES.startCells, ecoUntil: 0, heatUntil: 0 };
}

export class BatteryEngine extends TargetGameEngine {
  constructor(options) {
    super({ ...options, mode: 'battery' });
    this.lives = 1;
    this.stage = 1;
    this.stagesCleared = 0;
    this.stageStartKeystrokes = 0;
    this.pauseUntil = 0;
    this.me = createSide();
    this.rival = createSide();
    this.items = [];
    this.nextItemAt = 0.6;
    this.rivalWord = { id: this.nextId++, kind: 'rival-cell', token: null };
    this.myWord = { id: this.nextId++, kind: 'my-cell', token: null };
    this.rivalWord.token = this.pickToken(this.rivalWord.id);
    this.myWord.token = this.drawWeightedToken();
    this.hiddenUntil = 0;
    this.ai = { targetId: null, progress: 0, thinkUntil: 1.2, pausedUntil: 0 };
    this.collected = { cell: 0, powerbank: 0, eco: 0, heat: 0, blackout: 0 };
    this.drains = 0;
    this.stolen = 0;
    this.outcome = null;
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

  sinkPerSecond() {
    return BATTERY_RULES.baseSinkPerSecond * this.difficulty.speed * (1 + (this.stage - 1) * BATTERY_RULES.stageSinkStep);
  }

  sideSinkFactor(side) {
    let factor = 1;
    if (this.gameTime < side.ecoUntil) factor *= BATTERY_RULES.ecoFactor;
    if (this.gameTime < side.heatUntil) factor *= BATTERY_RULES.heatFactor;
    return factor;
  }

  aiCharactersPerSecond() {
    return BATTERY_RULES.aiCharactersPerSecond[this.level] * (1 + (this.stage - 1) * BATTERY_RULES.aiStageSpeedStep);
  }

  // ---------- 진행 ----------
  step(frameSeconds) {
    if (this.gameTime < this.pauseUntil) return;
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

  checkOutcome() {
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
    this.stage++;
    this.stageStartKeystrokes = this.correctKeystrokes;
    this.me = createSide();
    this.rival = createSide();
    this.items = [];
    this.projectiles = [];
    this.clearBuffer();
    this.ai = { targetId: null, progress: 0, thinkUntil: this.gameTime + BATTERY_RULES.stageClearPause + 0.8, pausedUntil: 0 };
    this.hiddenUntil = 0;
    this.pauseUntil = this.gameTime + BATTERY_RULES.stageClearPause;
    this.nextItemAt = this.pauseUntil + 0.4;
    this.rivalWord.token = this.pickToken(this.rivalWord.id);
    this.myWord.token = this.drawWeightedToken();
    return how;
  }

  loseMatch(how) {
    this.outcome = how;
    this.me.cells = Math.max(0, this.me.cells);
    this.clearBuffer();
    this.loseLife({ how });
    return how;
  }

  // ---------- 아이템 ----------
  chooseItemType() {
    const entries = Object.entries(BATTERY_ITEMS);
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

  spawnIfDue() {
    if (this.gameTime < this.nextItemAt) return;
    this.nextItemAt = this.gameTime + randomBetween(this.random, BATTERY_RULES.itemInterval) / (1 + (this.stage - 1) * 0.08);
    if (this.items.filter(item => !item.consumed).length >= BATTERY_RULES.maxItems) return;
    const y = this.chooseItemY();
    if (y !== null) this.spawnItem(this.chooseItemType(), y);
  }

  spawnItem(itemType = 'cell', y = 0.4, direction = this.random() < 0.5 ? 1 : -1) {
    const item = {
      id: this.nextId++, kind: 'item', item: itemType, x: direction > 0 ? -0.08 : 1.08, y, direction,
      consumed: false, takenBy: null, spawnedAt: this.gameTime, token: null
    };
    item.token = this.pickToken(item.id);
    this.items.push(item);
    this.emit('item-spawn', { item });
    return item;
  }

  moveItems(frameSeconds) {
    const speed = BATTERY_RULES.itemSpeed * (1 + (this.stage - 1) * 0.05);
    for (const item of this.items) {
      if (item.consumed) continue;
      item.x += item.direction * speed * frameSeconds;
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

  applyItem(side, opponent, item) {
    const config = BATTERY_ITEMS[item.item];
    if (config.gain) side.cells = Math.min(BATTERY_RULES.goalCells, side.cells + config.gain);
    if (item.item === 'eco') side.ecoUntil = Math.max(side.ecoUntil, this.gameTime) + BATTERY_RULES.ecoSeconds;
    if (item.item === 'heat') opponent.heatUntil = Math.max(opponent.heatUntil, this.gameTime) + BATTERY_RULES.heatSeconds;
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
    const speed = BATTERY_RULES.itemSpeed;
    const reachable = this.items.filter(item => {
      if (item.consumed) return false;
      const remaining = item.direction > 0 ? 1.1 - item.x : item.x + 0.1;
      return remaining / speed > item.token.text.length / cps + 0.2;
    });
    const wantsAttack = this.random() < BATTERY_RULES.aiAttackChance || reachable.length === 0;
    if (wantsAttack) return this.myWord.id;
    // 셀 높이가 낮을수록 셀을, 높으면 공격형 아이템을 선호
    reachable.sort((first, second) => BATTERY_ITEMS[second.item].gain - BATTERY_ITEMS[first.item].gain || first.token.text.length - second.token.text.length);
    return reachable[0].id;
  }

  stepAi(frameSeconds) {
    if (this.gameTime < this.ai.pausedUntil) return;
    if (this.ai.targetId === null) {
      if (this.gameTime < this.ai.thinkUntil) return;
      this.ai.targetId = this.chooseAiTarget();
      this.ai.progress = 0;
      this.emit('rival-lock', { targetId: this.ai.targetId });
    }
    const target = this.findEntity(this.ai.targetId);
    if (!target || (target.kind === 'item' && target.consumed)) {
      this.resetAiTarget(0.25);
      return;
    }
    this.ai.progress += this.aiCharactersPerSecond() * frameSeconds;
    if (this.ai.progress < target.token.text.length) return;

    if (target.kind === 'item') {
      target.consumed = true;
      target.takenBy = 'rival';
      target.takenAt = this.gameTime;
      this.applyItem(this.rival, this.me, target);
      if (target.item === 'blackout') this.hiddenUntil = this.gameTime + BATTERY_RULES.blackoutSeconds;
      if (this.targetId === target.id) {
        this.stolen++;
        this.releaseTargetIf(target.id, 'stolen');
      }
      this.emit('rival-take', { item: target });
    } else {
      // 방전봇이 내 배터리를 뺏어간다
      const stolen = Math.min(BATTERY_RULES.stealCells, Math.max(0, this.me.cells));
      this.me.cells -= BATTERY_RULES.stealCells;
      this.rival.cells = Math.min(BATTERY_RULES.goalCells, this.rival.cells + stolen);
      this.myWord.token = this.drawWeightedToken();
      this.emit('rival-attack', { cells: this.me.cells, stolen });
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
      if (entity.item === 'blackout') this.ai.pausedUntil = this.gameTime + BATTERY_RULES.blackoutSeconds;
      this.emit('item', { item: entity });
    } else if (entity.kind === 'rival-cell') {
      // 방전봇의 배터리를 뺏어온다
      const stolen = Math.min(BATTERY_RULES.stealCells, Math.max(0, this.rival.cells));
      this.rival.cells -= BATTERY_RULES.stealCells;
      this.me.cells = Math.min(BATTERY_RULES.goalCells, this.me.cells + stolen);
      this.drains++;
      this.score += BATTERY_RULES.drainBounty;
      this.emit('drain', { cells: this.rival.cells, stolen });
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
      powerSeconds: BATTERY_RULES.ecoSeconds
    };
  }

  summaryExtras() {
    return {
      stage: this.stage,
      stagesCleared: this.stagesCleared,
      outcome: this.outcome,
      collected: { ...this.collected },
      drains: this.drains,
      stolen: this.stolen
    };
  }
}
