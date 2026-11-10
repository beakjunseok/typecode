// 아케이드 모드(휴대폰 던지기 · 에러 구조 SOS) 공통 엔진.
// 화면에 뜬 목표들 중 첫 글자로 하나를 조준하고, 토큰을 다 맞게 치면 '발사'하는 규칙과
// 입력 버퍼·오타·Backspace·콤보·생명·게임 시간·요약을 담당한다. 모드별 규칙은 하위 클래스의 훅으로 넣는다.
import { SCORING, getMultiplier, getTierProgress, calculateWordsPerMinute, calculateAccuracy } from './engine.js';

export const ARCADE_RULES = Object.freeze({
  minTokenLength: 2,
  maxTokenLength: 22,
  startLives: 3,
  maxFrameSeconds: 0.25,
  projectileSeconds: 0.24
});

export function filterArcadeTokens(tokenPool) {
  return (tokenPool ?? []).filter(token =>
    token.text.length >= ARCADE_RULES.minTokenLength && token.text.length <= ARCADE_RULES.maxTokenLength);
}

export const randomBetween = (random, [min, max]) => min + random() * (max - min);

// 난이도 1~4: 적 속도(가라앉는 속도)와 등장 간격 배율. 원작처럼 시작 전에 고른다.
export const DIFFICULTY_LEVELS = Object.freeze({
  1: Object.freeze({ label: 'Lv.1 입문', speed: 0.75, spawn: 1.3 }),
  2: Object.freeze({ label: 'Lv.2 보통', speed: 1, spawn: 1 }),
  3: Object.freeze({ label: 'Lv.3 숙련', speed: 1.25, spawn: 0.82 }),
  4: Object.freeze({ label: 'Lv.4 장애 대응', speed: 1.55, spawn: 0.68 })
});

export class TargetGameEngine {
  constructor({ tokenPool, random = Math.random, onEvent = () => {}, mode, level = 2 }) {
    const pool = filterArcadeTokens(tokenPool);
    if (pool.length < 4) throw new Error(`${mode} mode needs at least 4 usable tokens`);
    this.mode = mode;
    this.level = DIFFICULTY_LEVELS[level] ? Number(level) : 2;
    this.difficulty = DIFFICULTY_LEVELS[this.level];
    this.tokenPool = pool;
    this.cumulativeWeights = [];
    let total = 0;
    for (const token of pool) {
      total += Number.isFinite(token.weight) && token.weight > 0 ? token.weight : 1;
      this.cumulativeWeights.push(total);
    }
    this.random = random;
    this.onEvent = onEvent;

    this.status = 'ready';
    this.gameTime = 0;
    this.lastRealMs = null;
    this.nextId = 1;
    this.projectiles = [];
    this.lives = ARCADE_RULES.startLives;

    this.targetId = null;
    this.typed = [];
    this.wrongInBuffer = 0;
    this.targetHadMistake = false;

    this.correctKeystrokes = 0;
    this.wrongKeystrokes = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.throws = 0;
    this.cleanThrows = 0;
    this.itemsCollected = 0;
    this.correctPerSecond = [];
    this.weakTokens = new Map();
  }

  // ---------- 하위 클래스 훅 ----------
  /** 조준 가능한 목표 목록(각각 {id, token, ...}) */
  targetables() { return []; }
  /** 모든 엔티티 중 id로 찾기 */
  findEntity() { return null; }
  /** 조준 우선순위: 작을수록 먼저(예: 책상에 가까운 로봇, 많이 가라앉은 프로세스) */
  targetPriority() { return 0; }
  /** 게임 시간 진행(이동·스폰 등) */
  step() {}
  /** 발사 직후 모드별 처리(피해 예약·아이템 소비 등) */
  onFire() {}
  /** 투사체가 목표에 닿았을 때 */
  onProjectileLanded() {}
  /** 요약에 붙일 모드별 값 */
  summaryExtras() { return {}; }
  /** 스냅샷에 붙일 모드별 값 */
  snapshotExtras() { return {}; }
  /** 발사 시 무기 이름 */
  currentWeapon() { return 'default'; }

  emit(type, payload = {}) {
    try {
      this.onEvent(type, payload);
    } catch (error) {
      console.error(`[${this.mode}] listener failed on ${type}`, error);
    }
  }

  // ---------- 시간 ----------
  start(nowMs) {
    if (this.status !== 'ready') return;
    this.status = 'running';
    this.lastRealMs = nowMs;
    this.emit('start', {});
  }

  // 실제 경과 시간을 게임 시간으로 옮긴다. 탭 전환 등으로 프레임이 멈췄다 돌아와도 한 번에 0.25초만 진행.
  update(nowMs) {
    if (this.status !== 'running') return;
    const frameSeconds = Math.min(Math.max((nowMs - this.lastRealMs) / 1000, 0), ARCADE_RULES.maxFrameSeconds);
    this.lastRealMs = nowMs;
    if (frameSeconds === 0) return;
    this.gameTime += frameSeconds;
    this.resolveProjectiles();
    if (this.status === 'running') this.step(frameSeconds);
  }

  resolveProjectiles() {
    const landed = this.projectiles.filter(projectile => this.gameTime - projectile.launchedAt >= ARCADE_RULES.projectileSeconds);
    if (!landed.length) return;
    this.projectiles = this.projectiles.filter(projectile => !landed.includes(projectile));
    for (const projectile of landed) {
      const entity = this.findEntity(projectile.targetId);
      if (entity) this.onProjectileLanded(entity, projectile);
    }
  }

  // ---------- 토큰 ----------
  drawWeightedToken() {
    const weights = this.cumulativeWeights;
    const target = this.random() * weights[weights.length - 1];
    let low = 0;
    let high = weights.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (weights[middle] > target) high = middle;
      else low = middle + 1;
    }
    return this.tokenPool[low];
  }

  // 화면의 다른 목표와 첫 글자가 겹치지 않는 토큰을 고른다(첫 글자로 조준이 확정되도록). 최대 24회 시도.
  pickToken(excludeId = null) {
    const used = new Set(this.targetables().filter(entity => entity.id !== excludeId).map(entity => entity.token.text[0]));
    let fallback = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const token = this.drawWeightedToken();
      fallback ??= token;
      if (!used.has(token.text[0])) return token;
    }
    return fallback;
  }

  get target() {
    return this.targetId == null ? null : this.findEntity(this.targetId);
  }

  // ---------- 입력 ----------
  // 조준 전: 첫 글자로 시작하는 목표 중 우선순위가 가장 높은 것을 잠근다. 없으면 오타.
  // 조준 후: 연습 모드와 같은 규칙(틀린 글자는 남고 Backspace로 지움, 다 맞으면 발사).
  input(character, nowMs) {
    if (typeof character !== 'string' || character.length !== 1) return { accepted: false, reason: 'invalid_character' };
    if (this.status === 'finished') return { accepted: false, reason: 'finished' };
    if (this.status === 'ready') this.start(nowMs);
    this.update(nowMs);
    if (this.status !== 'running') return { accepted: false, reason: 'finished' };

    let target = this.target;
    if (!target) {
      target = this.targetables()
        .filter(entity => entity.token.text[0] === character)
        .sort((first, second) => this.targetPriority(first) - this.targetPriority(second))[0];
      if (!target) return this.registerMistake(character, null, null);
      this.targetId = target.id;
      this.emit('lock', { target });
    }
    const text = target.token.text;
    if (this.typed.length >= text.length) return { accepted: false, reason: 'token_full' };

    const expected = text[this.typed.length];
    this.typed.push(character);
    if (character !== expected) {
      this.wrongInBuffer++;
      this.targetHadMistake = true;
      return this.registerMistake(character, expected, target);
    }
    this.correctKeystrokes++;
    const second = Math.floor(this.gameTime);
    this.correctPerSecond[second] = (this.correctPerSecond[second] ?? 0) + 1;
    if (this.typed.length === text.length && this.wrongInBuffer === 0) return this.fire(target);
    this.emit('keystroke', { target });
    return { accepted: true, correct: true };
  }

  registerMistake(typed, expected, target) {
    this.wrongKeystrokes++;
    const comboLost = this.combo;
    this.combo = 0;
    if (target) {
      const entry = this.weakTokens.get(target.token.text) ?? { token: target.token, misses: 0 };
      entry.misses++;
      this.weakTokens.set(target.token.text, entry);
    }
    const payload = { typed, expected, target, comboLost, position: this.typed.length - 1 };
    this.emit('mistake', payload);
    return { accepted: true, correct: false, ...payload };
  }

  backspace(nowMs, { wholeToken = false } = {}) {
    if (this.status !== 'running' || this.typed.length === 0) return { accepted: false, reason: 'nothing_to_delete' };
    this.update(nowMs);
    const target = this.target;
    if (this.status !== 'running' || !target) return { accepted: false, reason: 'no_target' };
    const deleteCount = wholeToken ? this.typed.length : 1;
    for (let count = 0; count < deleteCount; count++) {
      const index = this.typed.length - 1;
      if (this.typed.pop() !== target.token.text[index]) this.wrongInBuffer--;
    }
    if (this.typed.length === 0) {
      this.targetId = null;
      this.targetHadMistake = false;
      this.emit('unlock', { target });
    }
    this.emit('backspace', { deleted: deleteCount });
    return { accepted: true, deleted: deleteCount };
  }

  // 발사: 타격 점수는 지금 지급, 효과는 투사체가 닿을 때(onProjectileLanded) 적용한다.
  fire(target) {
    const weapon = this.currentWeapon();
    const clean = !this.targetHadMistake;
    this.score += Math.round(target.token.text.length * SCORING.basePoints * getMultiplier(this.combo));
    if (clean) {
      this.combo++;
      this.cleanThrows++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    this.throws++;
    const thrownToken = target.token;
    const projectile = { id: this.nextId++, targetId: target.id, weapon, launchedAt: this.gameTime };
    this.projectiles.push(projectile);
    this.onFire(target, projectile);
    this.clearBuffer();
    const payload = { target, weapon, clean, combo: this.combo, token: thrownToken, tier: getTierProgress(this.combo).index };
    this.emit('throw', payload);
    return { accepted: true, correct: true, fired: true, ...payload };
  }

  clearBuffer() {
    this.targetId = null;
    this.typed = [];
    this.wrongInBuffer = 0;
    this.targetHadMistake = false;
  }

  releaseTargetIf(id, reason) {
    if (this.targetId !== id) return;
    this.clearBuffer();
    this.emit('target-lost', { reason });
  }

  loseLife(cause) {
    this.lives = Math.max(0, this.lives - 1);
    if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
    this.combo = 0;
    this.emit('damage', { cause, lives: this.lives });
    if (this.lives === 0) this.finish();
  }

  // 위치별 입력 상태(조준 중인 목표 기준). 렌더링용. O(L)
  getCharacterStates(entity) {
    const text = entity.token.text;
    const active = entity.id === this.targetId;
    return [...text].map((expected, index) => {
      if (!active) return 'pending';
      if (index < this.typed.length) return this.typed[index] === expected ? 'correct' : 'wrong';
      return index === this.typed.length ? 'current' : 'pending';
    });
  }

  finish() {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.clearBuffer();
    this.emit('finish', { summary: this.summary() });
  }

  snapshot() {
    return {
      status: this.status,
      elapsedSeconds: this.gameTime,
      wordsPerMinute: this.status === 'ready' ? 0 : calculateWordsPerMinute(this.correctKeystrokes, this.gameTime),
      accuracy: calculateAccuracy(this.correctKeystrokes, this.wrongKeystrokes),
      combo: this.combo,
      multiplier: getMultiplier(this.combo),
      tierProgress: getTierProgress(this.combo),
      score: this.score,
      lives: this.lives,
      ...this.snapshotExtras()
    };
  }

  // 5초 이동 평균 WPM 추이(생존 시간 길이). O(seconds)
  wordsPerMinuteTimeline() {
    const seconds = Math.max(1, Math.ceil(this.gameTime));
    const timeline = [];
    let windowSum = 0;
    for (let second = 0; second < seconds; second++) {
      windowSum += this.correctPerSecond[second] ?? 0;
      if (second >= 5) windowSum -= this.correctPerSecond[second - 5] ?? 0;
      timeline.push(Math.round(windowSum / 5 / (Math.min(second + 1, 5) / 60)));
    }
    return timeline;
  }

  summary() {
    const survivedSeconds = Math.max(1, Math.round(this.gameTime));
    return {
      mode: this.mode,
      level: this.level,
      durationSeconds: survivedSeconds,
      survivedSeconds,
      score: this.score,
      wordsPerMinute: calculateWordsPerMinute(this.correctKeystrokes, this.gameTime),
      accuracy: calculateAccuracy(this.correctKeystrokes, this.wrongKeystrokes),
      maxCombo: this.maxCombo,
      itemsCollected: this.itemsCollected,
      completedTokens: this.throws,
      cleanTokens: this.cleanThrows,
      correctKeystrokes: this.correctKeystrokes,
      wrongKeystrokes: this.wrongKeystrokes,
      weakTokens: [...this.weakTokens.values()]
        .sort((first, second) => second.misses - first.misses)
        .slice(0, 3)
        .map(entry => ({ text: entry.token.text, kind: entry.token.kind, misses: entry.misses })),
      wordsPerMinuteTimeline: this.wordsPerMinuteTimeline(),
      ...this.summaryExtras()
    };
  }
}
