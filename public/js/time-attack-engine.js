// 연습 모드의 '시간 연장(⏳)' 규칙: 짧은 시간으로 시작해, 토큰을 완성할 때마다 시간이 늘어난다.
// 입력·채점·콤보는 TypingEngine 그대로이고, 시간 규칙(마감 시각)만 바꾼다. 브라우저·서버 검증·테스트가 같은 상수를 쓴다.
import { TypingEngine, DURATIONS, SCORING } from './engine.js';

export const TIME_ATTACK_RULES = Object.freeze({
  startSeconds: 20,
  maxBankSeconds: 30,           // 남은 시간은 이보다 많이 쌓이지 않는다(타이머 막대 100%)
  baseBonusSeconds: 0.25,       // 토큰 하나당 기본 보너스(짧은 기호 토큰만 골라 쳐서 버티지 못하게 작게)
  bonusPerCharacter: 0.12,      // 글자당 추가 보너스 → 긴 토큰일수록 많이 늘어남
  dirtyFactor: 0.4,             // 오타가 있었던 토큰은 40%만
  tierBonus: Object.freeze([1, 1.15, 1.3]), // 콤보 배율 단계(×1 · ×1.5 · ×2.0)에 따른 시간 보너스 배율
  // 보너스 감쇠: 0~240초에 100% → 15%, 240~480초에 15% → 0%. 480초 뒤에는 시간이 늘지 않아 최대 510초면 반드시 끝난다
  decayFirstSeconds: 240,
  decayFloor: 0.15,
  decayEndSeconds: 480,
  maxSessionSeconds: 480 + 30
});

// 서버 검증용: 글자 하나가 벌 수 있는 최대 시간(1글자 토큰 · 최고 콤보 단계 · 감쇠 없음)
export const TIME_ATTACK_MAX_SECONDS_PER_CHARACTER =
  (TIME_ATTACK_RULES.baseBonusSeconds + TIME_ATTACK_RULES.bonusPerCharacter) * Math.max(...TIME_ATTACK_RULES.tierBonus);

// 점수 규칙은 연습과 같다(글자당 기본 점수 × 콤보 배율)
export const TIME_ATTACK_MAX_POINTS_PER_CHARACTER = SCORING.basePoints * SCORING.tiers[SCORING.tiers.length - 1].multiplier;

// 경과 시간에 따른 보너스 배율: 1 → decayFloor(첫 구간) → 0(둘째 구간), 구간마다 선형. O(1)
export function timeBonusDecay(elapsedSeconds) {
  const { decayFirstSeconds, decayFloor, decayEndSeconds } = TIME_ATTACK_RULES;
  const elapsed = Math.max(0, elapsedSeconds);
  if (elapsed <= decayFirstSeconds) return 1 - (1 - decayFloor) * (elapsed / decayFirstSeconds);
  if (elapsed >= decayEndSeconds) return 0;
  return decayFloor * (decayEndSeconds - elapsed) / (decayEndSeconds - decayFirstSeconds);
}

// 토큰 하나를 완성했을 때 늘어날 시간(남은 시간 상한 적용 전). O(1)
export function rawTimeBonus({ length, clean, tier, elapsedSeconds }) {
  const rules = TIME_ATTACK_RULES;
  const tierFactor = rules.tierBonus[Math.max(0, Math.min(tier, rules.tierBonus.length - 1))];
  return (rules.baseBonusSeconds + rules.bonusPerCharacter * length) * (clean ? 1 : rules.dirtyFactor) * tierFactor * timeBonusDecay(elapsedSeconds);
}

export class TimeAttackEngine extends TypingEngine {
  constructor(options) {
    // 기반 엔진은 고정 시간 목록을 요구하므로 아무 값이나 넘기고, 시간 규칙은 아래 훅으로 바꾼다
    super({ ...options, durationSeconds: DURATIONS[0], mode: 'timeattack' });
    this.deadline = TIME_ATTACK_RULES.startSeconds;
    this.timeBonusTotal = 0;
    this.lastUpdateMs = 0;
  }

  deadlineSeconds() {
    return this.deadline;
  }

  timeBarSeconds() {
    return TIME_ATTACK_RULES.maxBankSeconds;
  }

  maxTimelineSeconds() {
    return TIME_ATTACK_RULES.maxSessionSeconds;
  }

  playedSeconds() {
    if (this.status === 'ready') return 0;
    const end = this.status === 'finished' ? this.finishedAt : this.lastUpdateMs;
    return Math.min(this.deadline, Math.max(0, (end - this.startedAt) / 1000));
  }

  update(nowMs) {
    if (this.status === 'running') this.lastUpdateMs = nowMs;
    super.update(nowMs);
  }

  // 토큰 완성 → 마감 시각을 뒤로 민다. 남은 시간이 상한을 넘으면 넘는 만큼은 버린다
  onTokenComplete(payload, nowMs) {
    const elapsedSeconds = Math.max(0, (nowMs - this.startedAt) / 1000);
    const raw = rawTimeBonus({ length: payload.token.text.length, clean: payload.clean, tier: payload.tier, elapsedSeconds });
    const nextDeadline = Math.min(this.deadline + raw, elapsedSeconds + TIME_ATTACK_RULES.maxBankSeconds);
    const added = Math.max(0, nextDeadline - this.deadline);
    this.deadline += added;
    this.timeBonusTotal += added;
    return {
      timeBonus: Math.round(added * 100) / 100,
      timeCapped: added + 1e-9 < raw,
      remainingSeconds: Math.max(0, this.deadline - elapsedSeconds)
    };
  }

  summaryExtras() {
    return {
      survivedSeconds: Math.floor(this.playedSeconds()),
      timeBonusTotal: Math.round(this.timeBonusTotal * 10) / 10,
      startSeconds: TIME_ATTACK_RULES.startSeconds
    };
  }
}
