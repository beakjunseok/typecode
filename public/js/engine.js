// 게임 규칙만 담은 순수 엔진. DOM·오디오·시계에 의존하지 않고, 시각(ms)은 호출자가 넘긴다.
// 브라우저(main.js)와 서버 검증(api/_lib.js), 테스트가 같은 규칙과 상수를 공유한다.

export const DURATIONS = Object.freeze([30, 60, 120]);

export const SCORING = Object.freeze({
  basePoints: 10,
  milestoneEvery: 10,
  tiers: Object.freeze([
    Object.freeze({ minCombo: 0, multiplier: 1 }),
    Object.freeze({ minCombo: 10, multiplier: 1.5 }),
    Object.freeze({ minCombo: 30, multiplier: 2 })
  ])
});

export const MAX_MULTIPLIER = SCORING.tiers[SCORING.tiers.length - 1].multiplier;

const WARNING_SECONDS = 5;
const WPM_WINDOW_SECONDS = 5;
const WEAK_TOKEN_RETRY_CHANCE = 0.2;
const WEAK_TOKEN_REPORT_SIZE = 3;

export function getTierIndex(combo) {
  for (let index = SCORING.tiers.length - 1; index > 0; index--) {
    if (combo >= SCORING.tiers[index].minCombo) return index;
  }
  return 0;
}

export function getMultiplier(combo) {
  return SCORING.tiers[getTierIndex(combo)].multiplier;
}

// 다음 배율 단계까지의 진행률(0~1)과 남은 콤보 수. 최고 단계면 ratio=1, remaining=0.
export function getTierProgress(combo) {
  const index = getTierIndex(combo);
  const current = SCORING.tiers[index];
  const next = SCORING.tiers[index + 1];
  if (!next) return { index, ratio: 1, remaining: 0, nextMultiplier: null };
  return {
    index,
    ratio: (combo - current.minCombo) / (next.minCombo - current.minCombo),
    remaining: next.minCombo - combo,
    nextMultiplier: next.multiplier
  };
}

// 토큰의 weight(없으면 1)를 누적한 배열. 0 이하·비정상 값은 1로 취급한다. O(n)
function buildCumulativeWeights(tokenPool) {
  const cumulative = new Array(tokenPool.length);
  let total = 0;
  tokenPool.forEach((token, index) => {
    const weight = Number.isFinite(token.weight) && token.weight > 0 ? token.weight : 1;
    total += weight;
    cumulative[index] = total;
  });
  return cumulative;
}

export function calculateWordsPerMinute(correctKeystrokes, elapsedSeconds) {
  return Math.round(correctKeystrokes / 5 / (Math.max(elapsedSeconds, 1) / 60));
}

// 타수(분당 타자 수) — 한컴타자연습과 같은 기준. WPM = 타수 ÷ 5
export function calculateCharactersPerMinute(correctKeystrokes, elapsedSeconds) {
  return Math.round(correctKeystrokes / (Math.max(elapsedSeconds, 1) / 60));
}

export function calculateAccuracy(correctKeystrokes, wrongKeystrokes) {
  const total = correctKeystrokes + wrongKeystrokes;
  return total === 0 ? 100 : Math.round((correctKeystrokes / total) * 1000) / 10;
}

export class TypingEngine {
  constructor({ tokenPool, durationSeconds, random = Math.random, queueLength = 8, historyLength = 6, onEvent = () => {}, mode = 'practice' }) {
    if (!Array.isArray(tokenPool) || tokenPool.length === 0) throw new Error('tokenPool must be a non-empty array');
    if (!DURATIONS.includes(durationSeconds)) throw new Error(`unsupported duration: ${durationSeconds}`);
    this.mode = mode;
    this.tokenPool = tokenPool;
    this.cumulativeWeights = buildCumulativeWeights(tokenPool);
    this.durationSeconds = durationSeconds;
    this.random = random;
    this.queueLength = queueLength;
    this.historyLength = historyLength;
    this.onEvent = onEvent;

    this.status = 'ready';
    this.startedAt = 0;
    this.finishedAt = 0;
    this.correctKeystrokes = 0;
    this.wrongKeystrokes = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.cleanTokens = 0;
    this.completedTokens = 0;
    this.tokenNumber = 0;
    this.typed = [];
    this.wrongInBuffer = 0;
    this.tokenHasMistake = false;
    this.current = null;
    this.queue = [];
    this.history = [];
    this.weakTokens = new Map();
    this.correctPerSecond = [];
    this.lastWarnedSecond = null;
    this.advanceToken();
  }

  // 이벤트 구독자 오류가 게임 진행을 깨뜨리지 않도록 격리한다.
  emit(type, payload = {}) {
    try {
      this.onEvent(type, payload);
    } catch (error) {
      console.error(`[engine] listener failed on ${type}`, error);
    }
  }

  // 틀렸던 토큰을 일정 확률로 재출제하고, 그 외엔 직전 토큰과 겹치지 않게 무작위 선택. 평균 O(1)
  pickToken(excludedText) {
    const weakCandidates = [...this.weakTokens.values()].filter(entry => entry.token.text !== excludedText);
    if (weakCandidates.length > 0 && this.random() < WEAK_TOKEN_RETRY_CHANCE) {
      return weakCandidates[Math.floor(this.random() * weakCandidates.length)].token;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const token = this.drawWeightedToken();
      if (token.text !== excludedText || this.tokenPool.length === 1) return token;
    }
    return this.tokenPool.find(token => token.text !== excludedText) ?? this.tokenPool[0];
  }

  // 누적 가중치에서 이진 탐색으로 한 개를 뽑는다. O(log n)
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

  fillQueue() {
    while (this.queue.length < this.queueLength) {
      const lastText = this.queue.length ? this.queue[this.queue.length - 1].text : this.current?.text;
      this.queue.push(this.pickToken(lastText));
    }
  }

  advanceToken() {
    this.fillQueue();
    this.current = this.queue.shift();
    this.fillQueue();
    this.typed = [];
    this.wrongInBuffer = 0;
    this.tokenHasMistake = false;
    this.tokenNumber++;
  }

  // 현재 토큰에서 다음에 입력될 위치
  get cursor() {
    return this.typed.length;
  }

  // 위치별 입력 상태: 'correct' | 'wrong' | 'current' | 'pending'. 화면 렌더링용. O(L)
  getCharacterStates() {
    return [...this.current.text].map((expected, index) => {
      if (index < this.typed.length) return this.typed[index] === expected ? 'correct' : 'wrong';
      return index === this.typed.length ? 'current' : 'pending';
    });
  }

  start(nowMs) {
    if (this.status !== 'ready') return;
    this.status = 'running';
    this.startedAt = nowMs;
    this.emit('start', { durationSeconds: this.durationSeconds });
  }

  // 한 글자 입력. 틀린 글자도 버퍼에 들어가 빨갛게 표시되고, Backspace로 지울 수 있다.
  // 토큰은 버퍼가 꽉 차고 틀린 글자가 0개일 때만 완성된다. 첫 입력이 타이머를 시작한다.
  input(character, nowMs) {
    if (typeof character !== 'string' || character.length !== 1) return { accepted: false, reason: 'invalid_character' };
    if (this.status === 'finished') return { accepted: false, reason: 'finished' };
    if (this.status === 'ready') this.start(nowMs);
    this.update(nowMs);
    if (this.status === 'finished') return { accepted: false, reason: 'finished' };
    if (this.typed.length >= this.current.text.length) return { accepted: false, reason: 'token_full' };

    const expected = this.current.text[this.typed.length];
    this.typed.push(character);
    if (character !== expected) return this.acceptMistake(character, expected);

    this.correctKeystrokes++;
    const secondIndex = Math.min(this.maxTimelineSeconds() - 1, Math.max(0, Math.floor((nowMs - this.startedAt) / 1000)));
    this.correctPerSecond[secondIndex] = (this.correctPerSecond[secondIndex] ?? 0) + 1;
    if (this.typed.length === this.current.text.length && this.wrongInBuffer === 0) return this.completeToken(nowMs);
    this.emit('keystroke', { cursor: this.cursor });
    return { accepted: true, correct: true, tokenComplete: false };
  }

  // 마지막 글자(또는 토큰 전체)를 지운다. 지운 위치는 다시 '입력 전' 상태로 돌아간다.
  // 한 번이라도 틀린 토큰은 고쳐도 콤보에 들어가지 않는다(tokenHasMistake 유지).
  backspace(nowMs, { wholeToken = false } = {}) {
    if (this.status !== 'running' || this.typed.length === 0) return { accepted: false, reason: 'nothing_to_delete' };
    this.update(nowMs);
    if (this.status === 'finished') return { accepted: false, reason: 'finished' };

    const deleteCount = wholeToken ? this.typed.length : 1;
    for (let count = 0; count < deleteCount; count++) {
      const index = this.typed.length - 1;
      if (this.typed.pop() !== this.current.text[index]) this.wrongInBuffer--;
    }
    this.emit('backspace', { cursor: this.cursor, deleted: deleteCount });
    return { accepted: true, deleted: deleteCount };
  }

  // 점수는 토큰 완성 시점에 한 번만 준다(지우고 다시 쳐서 점수를 불리는 것 방지).
  completeToken(nowMs) {
    const clean = !this.tokenHasMistake;
    const previousTier = getTierIndex(this.combo);
    this.score += Math.round(this.current.text.length * SCORING.basePoints * getMultiplier(this.combo));
    if (clean) {
      this.combo++;
      this.cleanTokens++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    this.completedTokens++;
    const tier = getTierIndex(this.combo);
    const finishedToken = this.current;

    this.history.push({ ...finishedToken, clean });
    if (this.history.length > this.historyLength) this.history.shift();

    const payload = {
      token: finishedToken,
      clean,
      combo: this.combo,
      tier,
      tierUp: tier > previousTier,
      milestone: clean && this.combo % SCORING.milestoneEvery === 0
    };
    Object.assign(payload, this.onTokenComplete(payload, nowMs));
    this.advanceToken();
    this.emit('token', payload);
    return { accepted: true, correct: true, tokenComplete: true, ...payload };
  }

  acceptMistake(typed, expected) {
    this.wrongKeystrokes++;
    this.wrongInBuffer++;
    const comboLost = this.combo;
    this.combo = 0;
    this.tokenHasMistake = true;

    const entry = this.weakTokens.get(this.current.text) ?? { token: this.current, misses: 0 };
    entry.misses++;
    this.weakTokens.set(this.current.text, entry);

    const payload = { typed, expected, token: this.current, position: this.cursor - 1, comboLost, tokenNumber: this.tokenNumber };
    this.emit('mistake', payload);
    return { accepted: true, correct: false, ...payload };
  }

  // ---------- 하위 모드(시간 연장 등)가 바꾸는 시간 규칙. 기본은 고정 제한 시간 ----------
  // 시작부터 끝날 때까지의 총 시간(초). 시간 연장 모드는 토큰을 칠 때마다 늘어난다.
  deadlineSeconds() {
    return this.durationSeconds;
  }

  // 타이머 막대 100%에 해당하는 시간
  timeBarSeconds() {
    return this.durationSeconds;
  }

  // 초당 정타 기록 배열의 최대 길이
  maxTimelineSeconds() {
    return this.durationSeconds;
  }

  // WPM·타수를 계산할 실제 플레이 시간
  playedSeconds() {
    return this.durationSeconds;
  }

  // 토큰 완성 이벤트에 덧붙일 값(예: 늘어난 시간). 기본은 없음
  onTokenComplete() {
    return {};
  }

  summaryExtras() {
    return {};
  }

  // 주기적으로 호출. 마지막 5초 경고와 시간 종료를 처리한다.
  update(nowMs) {
    if (this.status !== 'running') return;
    const deadline = this.deadlineSeconds();
    const remaining = deadline - (nowMs - this.startedAt) / 1000;
    if (remaining <= 0) {
      this.finish(this.startedAt + deadline * 1000);
      return;
    }
    const wholeSeconds = Math.ceil(remaining);
    if (wholeSeconds <= WARNING_SECONDS && wholeSeconds !== this.lastWarnedSecond) {
      this.lastWarnedSecond = wholeSeconds;
      this.emit('warning', { remainingSeconds: wholeSeconds });
    }
  }

  finish(atMs) {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.finishedAt = atMs;
    this.emit('finish', { summary: this.summary() });
  }

  elapsedSeconds(nowMs) {
    if (this.status === 'ready') return 0;
    const end = this.status === 'finished' ? this.finishedAt : nowMs;
    return Math.min(Math.max((end - this.startedAt) / 1000, 0), this.deadlineSeconds());
  }

  snapshot(nowMs) {
    const elapsed = this.elapsedSeconds(nowMs);
    const remaining = Math.max(0, this.deadlineSeconds() - elapsed);
    return {
      status: this.status,
      mode: this.mode,
      remainingSeconds: Math.ceil(remaining),
      remainingExact: remaining,
      remainingRatio: remaining / this.timeBarSeconds(),
      wordsPerMinute: this.status === 'ready' ? 0 : calculateWordsPerMinute(this.correctKeystrokes, elapsed),
      charactersPerMinute: this.status === 'ready' ? 0 : calculateCharactersPerMinute(this.correctKeystrokes, elapsed),
      accuracy: calculateAccuracy(this.correctKeystrokes, this.wrongKeystrokes),
      combo: this.combo,
      multiplier: getMultiplier(this.combo),
      tierProgress: getTierProgress(this.combo),
      score: this.score,
      tokenNumber: this.tokenNumber
    };
  }

  // 초 단위 이동 창(5초)으로 계산한 WPM 추이. O(플레이 시간)
  wordsPerMinuteTimeline() {
    const timeline = [];
    let windowSum = 0;
    const seconds = Math.max(1, Math.ceil(this.playedSeconds()));
    for (let second = 0; second < seconds; second++) {
      windowSum += this.correctPerSecond[second] ?? 0;
      if (second >= WPM_WINDOW_SECONDS) windowSum -= this.correctPerSecond[second - WPM_WINDOW_SECONDS] ?? 0;
      const windowLength = Math.min(second + 1, WPM_WINDOW_SECONDS);
      timeline.push(Math.round(windowSum / 5 / (windowLength / 60)));
    }
    return timeline;
  }

  summary() {
    const weakTokens = [...this.weakTokens.values()]
      .sort((first, second) => second.misses - first.misses)
      .slice(0, WEAK_TOKEN_REPORT_SIZE)
      .map(entry => ({ text: entry.token.text, kind: entry.token.kind, misses: entry.misses }));
    const played = this.playedSeconds();
    return {
      mode: this.mode,
      durationSeconds: this.durationSeconds,
      score: this.score,
      wordsPerMinute: calculateWordsPerMinute(this.correctKeystrokes, played),
      charactersPerMinute: calculateCharactersPerMinute(this.correctKeystrokes, played),
      accuracy: calculateAccuracy(this.correctKeystrokes, this.wrongKeystrokes),
      maxCombo: this.maxCombo,
      cleanTokens: this.cleanTokens,
      completedTokens: this.completedTokens,
      correctKeystrokes: this.correctKeystrokes,
      wrongKeystrokes: this.wrongKeystrokes,
      weakTokens,
      wordsPerMinuteTimeline: this.wordsPerMinuteTimeline(),
      ...this.summaryExtras()
    };
  }
}
