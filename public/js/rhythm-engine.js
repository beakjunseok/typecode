// 리듬 모드: 128 BPM 고정 4레인 낙하형 코드 타자.
// 낱말(토큰)이 박자에 맞춰 판정선으로 떨어진다. 앞 글자들은 미리 쳐 두고, 마지막 글자를 판정선에 닿는 순간 누르면
// 그 타이밍으로 PERFECT·GREAT·GOOD·BAD가 갈린다. 레인 = 토큰 종류(키워드 / 타입·내장 / 값·지시자 / 연산자).
// 시간은 오디오 시계(AudioContext.currentTime − 출력 지연)를 따라가서 들리는 박자와 판정선이 어긋나지 않는다.
import { TargetGameEngine } from './target-game.js';
import { getMultiplier, getTierProgress } from './engine.js';

export const RHYTHM_RULES = Object.freeze({
  bpm: 128,
  beatsPerBar: 4,
  bars: 40,
  leadInBeats: 8,
  // 판정 창(초, 정박 기준 ±). 그 밖이지만 missAfter 안에 치면 BAD, 지나가면 MISS
  windows: Object.freeze({ perfect: 0.05, great: 0.1, good: 0.15 }),
  missAfter: 0.25,
  points: Object.freeze({ perfect: 300, great: 200, good: 100, bad: 30 }),
  // 체력 0~100: 0이 되면 스테이지 실패
  health: Object.freeze({ start: 100, perfect: 2, great: 1.5, good: 0.5, bad: -4, miss: -10, wrong: -1 }),
  // 노트가 끝나고 이만큼 지나면 스테이지 클리어
  outroSeconds: 1.6,
  // 탭 전환·멈춤으로 시계가 크게 건너뛰면 한 프레임에 이만큼만 진행(그 사이는 멈춘 것으로 본다)
  maxFrameSeconds: 0.25
});

export const BEAT_SECONDS = 60 / RHYTHM_RULES.bpm;
export const JUDGEMENTS = Object.freeze(['perfect', 'great', 'good', 'bad', 'miss']);
// 점수 상한 검증용(서버): 노트 1개 최고점 × 최대 배율 ÷ 최소 토큰 길이
export const RHYTHM_MAX_POINTS_PER_CHARACTER = RHYTHM_RULES.points.perfect * 2 / 2;

// 레인 = 토큰 종류 묶음
export const RHYTHM_LANES = Object.freeze([
  Object.freeze({ label: '키워드', kinds: Object.freeze(['keyword']), color: '#c792ea' }),
  Object.freeze({ label: '타입·내장', kinds: Object.freeze(['type', 'builtin']), color: '#82aaff' }),
  Object.freeze({ label: '값·지시자', kinds: Object.freeze(['literal', 'decorator', 'directive']), color: '#f78c6c' }),
  Object.freeze({ label: '연산자', kinds: Object.freeze(['operator']), color: '#ffcb6b' })
]);
const laneOfKind = kind => Math.max(0, RHYTHM_LANES.findIndex(lane => lane.kinds.includes(kind)));

// 난이도별 노트 간격(박 단위, 순환), 떨어지는 시간(박), 최대 토큰 길이
export const RHYTHM_CHARTS = Object.freeze({
  1: Object.freeze({ pattern: Object.freeze([4]), fallBeats: 6, maxLength: 8 }),
  2: Object.freeze({ pattern: Object.freeze([2]), fallBeats: 5, maxLength: 6 }),
  3: Object.freeze({ pattern: Object.freeze([2, 2, 1]), fallBeats: 4, maxLength: 5 }),
  4: Object.freeze({ pattern: Object.freeze([1, 1, 2]), fallBeats: 3.5, maxLength: 5 })
});

// 화음 진행(마디마다, 4마디 순환): 레인별 타격음과 반주가 같은 화음을 쓴다. MIDI 음 번호
export const RHYTHM_CHORDS = Object.freeze([
  Object.freeze({ name: 'Am', root: 45, tones: Object.freeze([57, 60, 64, 69]) }),
  Object.freeze({ name: 'F', root: 41, tones: Object.freeze([57, 60, 65, 69]) }),
  Object.freeze({ name: 'C', root: 48, tones: Object.freeze([55, 60, 64, 67]) }),
  Object.freeze({ name: 'G', root: 43, tones: Object.freeze([55, 59, 62, 67]) })
]);
export const chordAtBeat = beat => RHYTHM_CHORDS[Math.floor(Math.max(0, beat) / RHYTHM_RULES.beatsPerBar) % RHYTHM_CHORDS.length];

export function judgeTiming(deltaSeconds) {
  const distance = Math.abs(deltaSeconds);
  const { windows } = RHYTHM_RULES;
  if (distance <= windows.perfect) return 'perfect';
  if (distance <= windows.great) return 'great';
  if (distance <= windows.good) return 'good';
  return 'bad';
}

// 박자 시계: 오디오가 돌고 있으면 오디오 시계로, 아니면(무음·자동재생 차단·미지원) 성능 시계로 진행한다.
// 프레임마다 두 시계의 '증가분'만 쓰므로 소리를 중간에 켜거나 꺼도 게임 시간이 튀지 않는다.
// audioOffset: 게임 시간 t의 소리가 '들리게' 하려면 audioContext 시간 audioOffset + t에 예약하면 된다.
export class BeatClock {
  constructor(getAudioContext = () => null) {
    this.getAudioContext = getAudioContext;
    this.lastAudio = null;
    this.lastPerf = null;
    this.audioOffset = null;
  }

  // 출력 지연을 뺀 '지금 들리는' 오디오 시각. 오디오가 안 돌면 null
  audioNow() {
    const context = this.getAudioContext();
    if (!context || context.state !== 'running') return null;
    const latency = Number.isFinite(context.outputLatency) && context.outputLatency > 0 ? context.outputLatency : (context.baseLatency || 0);
    return context.currentTime - latency;
  }

  reset(nowMs) {
    this.lastPerf = nowMs;
    this.lastAudio = this.audioNow();
    this.audioOffset = null;
  }

  // 지난 읽기 이후 흐른 초. gameTime은 부르는 쪽이 들고 있다
  advance(nowMs, gameTime) {
    const audio = this.audioNow();
    let delta;
    if (audio !== null && this.lastAudio !== null) delta = audio - this.lastAudio;
    else delta = (nowMs - (this.lastPerf ?? nowMs)) / 1000;
    this.lastAudio = audio;
    this.lastPerf = nowMs;
    const step = Math.min(Math.max(delta, 0), RHYTHM_RULES.maxFrameSeconds);
    // context 시각 s에 예약한 소리는 audioNow()가 s일 때 들린다 → 게임 시간 t의 소리는 audioOffset + t에 예약
    this.audioOffset = audio === null ? null : audio - (gameTime + step);
    return step;
  }
}

export class RhythmEngine extends TargetGameEngine {
  constructor({ getAudioContext = () => null, narrow = false, ...options }) {
    const level = RHYTHM_CHARTS[options.level] ? Number(options.level) : 2;
    const chart = RHYTHM_CHARTS[level];
    super({ ...options, level, mode: 'rhythm', maxTokenLength: Math.min(chart.maxLength, narrow ? 7 : chart.maxLength) });
    this.chart = chart;
    this.lanes = RHYTHM_LANES.length;
    this.clock = new BeatClock(getAudioContext);
    this.fallSeconds = chart.fallBeats * BEAT_SECONDS;
    this.health = RHYTHM_RULES.health.start;
    this.counts = Object.fromEntries(JUDGEMENTS.map(name => [name, 0]));
    this.outcome = null;
    this.notes = this.buildChart();
    this.lastHitTime = this.notes.at(-1)?.hitTime ?? 0;
    this.endTime = this.lastHitTime + RHYTHM_RULES.outroSeconds;
  }

  // 악보: 리드인(2마디) 뒤부터 패턴 간격으로 노트를 깐다. 같은 토큰이 연달아 나오지 않게 한다. O(노트 수)
  buildChart() {
    const notes = [];
    const totalBeats = RHYTHM_RULES.bars * RHYTHM_RULES.beatsPerBar;
    let beat = RHYTHM_RULES.leadInBeats;
    let step = 0;
    let previous = null;
    while (beat < RHYTHM_RULES.leadInBeats + totalBeats) {
      let token = this.drawWeightedToken();
      for (let attempt = 0; attempt < 6 && token.text === previous; attempt++) token = this.drawWeightedToken();
      previous = token.text;
      notes.push({ id: this.nextId++, token, lane: laneOfKind(token.kind), beat, hitTime: beat * BEAT_SECONDS, state: 'pending', judgement: null, delta: 0, resolvedAt: null });
      beat += this.chart.pattern[step % this.chart.pattern.length];
      step++;
    }
    return notes;
  }

  // ---------- 시간 ----------
  start(nowMs) {
    if (this.status !== 'ready') return;
    this.clock.reset(nowMs);
    super.start(nowMs);
  }

  update(nowMs) {
    if (this.status !== 'running') return;
    const step = this.clock.advance(nowMs, this.gameTime);
    this.lastRealMs = nowMs;
    if (step === 0) return;
    this.gameTime += step;
    this.step(step);
  }

  get beat() {
    return this.gameTime / BEAT_SECONDS;
  }

  // 놓친 노트 처리 + 끝 판정
  step() {
    for (const note of this.notes) {
      if (note.state !== 'pending') continue;
      if (this.gameTime - note.hitTime <= RHYTHM_RULES.missAfter) break;
      this.resolveMiss(note);
      if (this.status !== 'running') return;
    }
    if (this.gameTime >= this.endTime) this.finish('cleared');
  }

  resolveMiss(note) {
    note.state = 'missed';
    note.judgement = 'miss';
    note.resolvedAt = this.gameTime;
    this.counts.miss++;
    if (this.targetId === note.id) {
      this.clearBuffer();
      this.emit('target-lost', { reason: 'missed' });
    }
    if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
    this.combo = 0;
    const entry = this.weakTokens.get(note.token.text) ?? { token: note.token, misses: 0 };
    entry.misses++;
    this.weakTokens.set(note.token.text, entry);
    this.changeHealth(RHYTHM_RULES.health.miss);
    this.emit('miss', { note });
  }

  changeHealth(amount) {
    this.health = Math.max(0, Math.min(100, this.health + amount));
    if (this.health === 0) this.finish('failed');
  }

  // ---------- 목표 ----------
  // 순서대로만 친다: 화면에 들어온 노트 중 가장 먼저 판정선에 닿는 것 하나
  targetables() {
    const head = this.notes.find(note => note.state === 'pending');
    return head && head.hitTime - this.fallSeconds <= this.gameTime ? [head] : [];
  }

  findEntity(id) {
    return this.notes.find(note => note.id === id) ?? null;
  }

  // 화면에 보이는 노트(떨어지는 중 + 방금 판정된 것)
  visibleNotes() {
    return this.notes.filter(note => note.hitTime - this.fallSeconds <= this.gameTime
      && (note.state === 'pending' || this.gameTime - note.resolvedAt < 0.4));
  }

  // ---------- 입력 ----------
  // 첫 키는 시작 신호(오타로 세지 않는다). 리드인 동안 노트가 없으면 아무 일도 없다
  input(character, nowMs) {
    if (this.status === 'ready') {
      if (typeof character !== 'string' || character.length !== 1) return { accepted: false, reason: 'invalid_character' };
      this.start(nowMs);
      return { accepted: true, correct: true, started: true };
    }
    if (this.status === 'running' && !this.target && !this.targetables().length) {
      this.update(nowMs);
      if (!this.targetables().length) return { accepted: false, reason: 'no_note' };
    }
    return super.input(character, nowMs);
  }

  registerMistake(typed, expected, target) {
    const result = super.registerMistake(typed, expected, target);
    this.changeHealth(RHYTHM_RULES.health.wrong);
    return result;
  }

  // 마지막 글자를 친 순간 = 판정. 앞 글자에 오타가 있었으면 판정이 좋아도 콤보는 끊긴다
  fire(note) {
    const delta = this.gameTime - note.hitTime;
    const judgement = delta < -RHYTHM_RULES.missAfter ? 'bad' : judgeTiming(delta);
    const clean = !this.targetHadMistake && judgement !== 'bad';
    if (clean) {
      this.combo++;
      this.cleanThrows++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    } else {
      if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
      this.combo = 0;
    }
    this.score += Math.round(RHYTHM_RULES.points[judgement] * getMultiplier(this.combo));
    this.throws++;
    this.counts[judgement]++;
    note.state = 'hit';
    note.judgement = judgement;
    note.delta = delta;
    note.resolvedAt = this.gameTime;
    this.clearBuffer();
    this.changeHealth(RHYTHM_RULES.health[judgement]);
    const payload = { note, target: note, judgement, delta, clean, combo: this.combo, lane: note.lane, beat: note.beat, token: note.token, tier: getTierProgress(this.combo).index };
    this.emit('judge', payload);
    return { accepted: true, correct: true, fired: true, ...payload };
  }

  finish(outcome = 'failed') {
    if (this.status === 'finished') return;
    this.outcome = outcome;
    super.finish();
  }

  // ---------- 결과 ----------
  // 판정 정확도: PERFECT 100%, GREAT 70%, GOOD 40%, BAD 10%, MISS 0%의 평균. 아직 안 나온 노트는 빼고 센다
  timingAccuracy() {
    const judged = JUDGEMENTS.reduce((sum, name) => sum + this.counts[name], 0);
    if (!judged) return 100;
    const weighted = this.counts.perfect + this.counts.great * 0.7 + this.counts.good * 0.4 + this.counts.bad * 0.1;
    return Math.round(weighted / judged * 1000) / 10;
  }

  rank() {
    if (this.outcome === 'failed') return 'F';
    const accuracy = this.timingAccuracy();
    if (accuracy >= 95 && this.counts.miss === 0) return 'S';
    if (accuracy >= 90) return 'A';
    if (accuracy >= 80) return 'B';
    if (accuracy >= 65) return 'C';
    return 'D';
  }

  snapshotExtras() {
    return {
      health: this.health,
      lives: this.health <= 25 ? 1 : 3,
      progress: Math.min(1, this.gameTime / this.endTime),
      counts: { ...this.counts },
      timingAccuracy: this.timingAccuracy(),
      bpm: RHYTHM_RULES.bpm
    };
  }

  summaryExtras() {
    return {
      outcome: this.outcome,
      rank: this.rank(),
      judgements: { ...this.counts },
      timingAccuracy: this.timingAccuracy(),
      totalNotes: this.notes.length,
      bpm: RHYTHM_RULES.bpm
    };
  }
}
