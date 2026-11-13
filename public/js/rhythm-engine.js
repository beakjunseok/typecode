// 리듬 모드: 128 BPM 고정 4레인 낙하형 코드 타자.
// 코드 낱말(토큰)을 한 글자씩 나눠 큰 원 노트로 박에 맞춰 떨어뜨린다. 원이 판정선에 닿는 순간 그 글자를 치면
// 타이밍으로 PERFECT·GREAT·GOOD·BAD가 갈리고, 글자가 모두 판정되면 낱말 하나가 완성된다(화면 위에 표시).
// 레인 = 그 글자를 치는 손가락 구역(왼손 바깥 · 왼손 안쪽 · 오른손 안쪽 · 오른손 바깥).
// 시간은 오디오 시계(AudioContext.currentTime − 출력 지연)를 따라가서 들리는 박자와 판정선이 어긋나지 않는다.
import { TargetGameEngine } from './target-game.js';
import { getMultiplier, getTierProgress } from './engine.js';
import { describeKey } from './keyboard.js';
import { getSong, RHYTHM_DIFFICULTIES } from './rhythm-songs.js';

export const RHYTHM_RULES = Object.freeze({
  // 기본 곡(beat-compiler.wav)의 템포. 곡마다 bpm·박자가 다르다(rhythm-songs.js)
  bpm: 128,
  // 판정 창(초, 정박 기준 ±). 그 밖이지만 missAfter 안에 치면 BAD, 지나가면 MISS
  windows: Object.freeze({ perfect: 0.05, great: 0.1, good: 0.15 }),
  missAfter: 0.25,
  // 글자 하나의 점수(× 콤보 배율). 낱말의 모든 글자를 GOOD 이상으로, 오타 없이 치면 글자당 wordBonus 추가
  points: Object.freeze({ perfect: 100, great: 70, good: 40, bad: 10 }),
  wordBonus: 30,
  // 체력 0~100: 0이 되면 스테이지 실패
  health: Object.freeze({ start: 100, perfect: 1, great: 0.8, good: 0.3, bad: -3, miss: -8, wrong: -2 }),
  // 노트가 끝나고 이만큼 지나면 스테이지 클리어
  outroSeconds: 1.6,
  // 탭 전환·멈춤으로 시계가 크게 건너뛰면 한 프레임에 이만큼만 진행(그 사이는 멈춘 것으로 본다)
  maxFrameSeconds: 0.25
});

export const JUDGEMENTS = Object.freeze(['perfect', 'great', 'good', 'bad', 'miss']);
// 점수 상한 검증용(서버): 글자 하나 최고점 = (PERFECT + 낱말 보너스) × 최대 배율 2
export const RHYTHM_MAX_POINTS_PER_CHARACTER = (RHYTHM_RULES.points.perfect + RHYTHM_RULES.wordBonus) * 2;

// 레인 = 손가락 구역
export const RHYTHM_LANES = Object.freeze([
  Object.freeze({ label: '왼손 바깥', fingers: Object.freeze(['LP', 'LR']), color: '#ff5c8a' }),
  Object.freeze({ label: '왼손 안쪽', fingers: Object.freeze(['LM', 'LI', 'TH']), color: '#c3e88d' }),
  Object.freeze({ label: '오른손 안쪽', fingers: Object.freeze(['RI', 'RM']), color: '#36e2ff' }),
  Object.freeze({ label: '오른손 바깥', fingers: Object.freeze(['RR', 'RP']), color: '#ffb547' })
]);
export function laneOfCharacter(character) {
  const finger = describeKey(character)?.finger;
  const lane = RHYTHM_LANES.findIndex(entry => entry.fingers.includes(finger));
  return lane === -1 ? RHYTHM_LANES.length - 1 : lane;
}

export const matchesNote = (typed, expected) => typed === expected || (expected !== expected.toLowerCase() && typed === expected.toLowerCase());

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
  constructor({ getAudioContext = () => null, songId, difficulty = 'normal', narrow = false, ...options }) {
    const song = getSong(songId);
    const difficultyKey = RHYTHM_DIFFICULTIES[difficulty] ? difficulty : 'normal';
    const chart = RHYTHM_DIFFICULTIES[difficultyKey];
    super({ ...options, level: 2, mode: 'rhythm', maxTokenLength: chart.maxLength });
    this.song = song;
    this.difficultyKey = difficultyKey;
    this.chart = chart;
    this.bpm = song.bpm;
    this.beatSeconds = 60 / song.bpm;
    this.beatsPerBar = song.beatsPerBar;
    this.leadInBeats = song.beatsPerBar * Math.ceil(8 / song.beatsPerBar);
    this.lanes = RHYTHM_LANES.length;
    this.clock = new BeatClock(getAudioContext);
    this.fallSeconds = chart.fallSeconds;
    this.health = RHYTHM_RULES.health.start;
    this.counts = Object.fromEntries(JUDGEMENTS.map(name => [name, 0]));
    this.outcome = null;
    this.wordsCompleted = 0;
    this.cleanWords = 0;
    this.headIndex = 0;
    const { words, notes, autoNotes } = this.buildChart();
    this.words = words;
    this.notes = notes;
    this.autoNotes = autoNotes;
    this.lastHitTime = notes.at(-1)?.hitTime ?? 0;
    this.endTime = (this.leadInBeats + song.totalBeats) * this.beatSeconds + RHYTHM_RULES.outroSeconds;
  }

  // 악보: 곡 선율의 음 중 난이도 격자(정박·반 박…)에 있고 앞 노트와 minGap초 이상 떨어진 음에 글자를 하나씩 얹는다.
  // 낱말이 끝나면 wordRest초 쉬고 다음 낱말. 글자를 얹지 않은 음은 반주가 자동으로 연주한다. O(선율 음 수)
  buildChart() {
    const words = [];
    const notes = [];
    const autoNotes = [];
    const { minGap, wordRest, grid } = this.chart;
    let word = null;
    let characters = [];
    let lastKeyed = -Infinity;
    let previousText = null;
    for (const event of this.song.melody) {
      const beat = event.beat + this.leadInBeats;
      const time = beat * this.beatSeconds;
      const onGrid = Math.abs(event.beat / grid - Math.round(event.beat / grid)) < 1e-6;
      if (!word) {
        if (onGrid && time - lastKeyed >= (words.length ? Math.max(minGap, wordRest) : 0)) {
          let token = this.drawWeightedToken();
          for (let attempt = 0; attempt < 6 && token.text === previousText; attempt++) token = this.drawWeightedToken();
          previousText = token.text;
          word = { id: this.nextId++, index: words.length, token, noteIds: [], mistakes: 0, done: false, clean: false };
          characters = [...token.text];
        }
      }
      if (word && onGrid && time - lastKeyed >= minGap) {
        const charIndex = word.noteIds.length;
        const character = characters[charIndex];
        const note = {
          id: this.nextId++, word, charIndex, character, lane: laneOfCharacter(character), midi: event.midi, dur: event.dur,
          beat, hitTime: time, state: 'pending', judgement: null, delta: 0, resolvedAt: null
        };
        notes.push(note);
        word.noteIds.push(note.id);
        lastKeyed = time;
        if (word.noteIds.length === characters.length) {
          words.push(word);
          word = null;
        }
      } else {
        autoNotes.push({ time, dur: event.dur * this.beatSeconds, midi: event.midi });
      }
    }
    // 곡이 끝나 다 못 놓은 낱말은 버리고 그 음은 반주가 연주한다
    if (word) {
      const unfinished = new Set(word.noteIds);
      for (const note of notes.filter(entry => unfinished.has(entry.id))) autoNotes.push({ time: note.hitTime, dur: note.dur * this.beatSeconds, midi: note.midi });
      notes.splice(notes.length - word.noteIds.length);
      autoNotes.sort((first, second) => first.time - second.time);
    }
    return { words, notes, autoNotes };
  }

  // 이 박의 화음(곡의 화음 진행). 리드인 동안은 첫 화음
  chordAtBeat(beat) {
    const songBeat = beat - this.leadInBeats;
    let chord = this.song.chords[0]?.chord;
    for (const entry of this.song.chords) {
      if (entry.beat > songBeat + 1e-6) break;
      chord = entry.chord;
    }
    return chord;
  }

  // 분당 칠 글자 수 → 1~15 난이도 숫자(곡 목록 표시용)
  levelNumber() {
    const minutes = Math.max(0.1, (this.endTime - this.leadInBeats * this.beatSeconds) / 60);
    return Math.max(1, Math.min(15, Math.round(this.notes.length / minutes / 16)));
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
    return this.gameTime / this.beatSeconds;
  }

  // 놓친 노트 처리 + 끝 판정
  step() {
    let head = this.headNote();
    while (head && this.gameTime - head.hitTime > RHYTHM_RULES.missAfter) {
      this.resolveMiss(head);
      if (this.status !== 'running') return;
      head = this.headNote();
    }
    if (this.gameTime >= this.endTime) this.finish('cleared');
  }

  // 다음에 칠 노트(시각순 첫 미판정). O(1) 분할상환
  headNote() {
    while (this.headIndex < this.notes.length && this.notes[this.headIndex].state !== 'pending') this.headIndex++;
    return this.notes[this.headIndex] ?? null;
  }

  // 지금 치는 낱말(다음 노트의 낱말). 키보드 힌트·입력창용
  get currentWord() {
    return this.headNote()?.word ?? null;
  }

  nextCharacter() {
    const head = this.headNote();
    return head && head.hitTime - this.fallSeconds <= this.gameTime ? head.character : null;
  }

  resolveMiss(note) {
    note.state = 'missed';
    note.judgement = 'miss';
    note.resolvedAt = this.gameTime;
    this.counts.miss++;
    if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
    this.combo = 0;
    this.noteWeak(note.word);
    this.changeHealth(RHYTHM_RULES.health.miss);
    this.emit('miss', { note });
    this.checkWord(note.word);
  }

  noteWeak(word) {
    const entry = this.weakTokens.get(word.token.text) ?? { token: word.token, misses: 0 };
    entry.misses++;
    this.weakTokens.set(word.token.text, entry);
  }

  changeHealth(amount) {
    this.health = Math.max(0, Math.min(100, this.health + amount));
    if (this.health === 0) this.finish('failed');
  }

  // 낱말의 모든 글자가 판정되면 완성. 모두 GOOD 이상이고 오타가 없으면 깨끗한 완성(보너스)
  checkWord(word) {
    if (word.done || this.status === 'finished') return;
    const notes = word.noteIds.map(id => this.findEntity(id));
    if (notes.some(note => note.state === 'pending')) return;
    word.done = true;
    word.clean = word.mistakes === 0 && notes.every(note => ['perfect', 'great', 'good'].includes(note.judgement));
    this.wordsCompleted++;
    let bonus = 0;
    if (word.clean) {
      this.cleanWords++;
      bonus = Math.round(RHYTHM_RULES.wordBonus * notes.length * getMultiplier(this.combo));
      this.score += bonus;
    }
    this.emit('word', { word, clean: word.clean, bonus, judgements: notes.map(note => note.judgement), lane: notes.at(-1).lane, beat: notes.at(-1).beat });
  }

  // ---------- 목표 ----------
  targetables() {
    const head = this.headNote();
    return head && head.hitTime - this.fallSeconds <= this.gameTime ? [head] : [];
  }

  findEntity(id) {
    return this.notes.find(note => note.id === id) ?? null;
  }

  // 화면에 보이는 노트(떨어지는 중 + 방금 판정된 것)
  visibleNotes() {
    const visible = [];
    for (let index = Math.max(0, this.headIndex - 12); index < this.notes.length; index++) {
      const note = this.notes[index];
      if (note.hitTime - this.fallSeconds > this.gameTime) break;
      if (note.state === 'pending' || this.gameTime - note.resolvedAt < 0.4) visible.push(note);
    }
    return visible;
  }

  // ---------- 입력 ----------
  // 첫 키는 시작 신호. 그 뒤로는 다음 노트가 판정 범위(±0.25초) 안에 있을 때만 판정한다.
  // 범위 밖에서 누른 키는 무시(벌점 없음), 범위 안에서 다른 글자를 누르면 오타
  input(character, nowMs) {
    if (typeof character !== 'string' || character.length !== 1) return { accepted: false, reason: 'invalid_character' };
    if (this.status === 'finished') return { accepted: false, reason: 'finished' };
    if (this.status === 'ready') {
      this.start(nowMs);
      return { accepted: true, correct: true, started: true };
    }
    this.update(nowMs);
    if (this.status !== 'running') return { accepted: false, reason: 'finished' };
    const head = this.headNote();
    if (!head || head.hitTime - this.gameTime > RHYTHM_RULES.missAfter) return { accepted: false, reason: 'too_early' };
    if (!matchesNote(character, head.character)) {
      head.word.mistakes++;
      this.wrongKeystrokes++;
      const comboLost = this.combo;
      this.combo = 0;
      this.noteWeak(head.word);
      const payload = { typed: character, expected: head.character, target: head.word, note: head, comboLost, position: head.charIndex };
      this.emit('mistake', payload);
      this.changeHealth(RHYTHM_RULES.health.wrong);
      return { accepted: true, correct: false, ...payload };
    }
    return this.hit(head);
  }

  hit(note) {
    const delta = this.gameTime - note.hitTime;
    const judgement = judgeTiming(delta);
    this.correctKeystrokes++;
    const second = Math.floor(this.gameTime);
    this.correctPerSecond[second] = (this.correctPerSecond[second] ?? 0) + 1;
    if (judgement === 'bad') {
      if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    this.score += Math.round(RHYTHM_RULES.points[judgement] * getMultiplier(this.combo));
    this.counts[judgement]++;
    note.state = 'hit';
    note.judgement = judgement;
    note.delta = delta;
    note.resolvedAt = this.gameTime;
    this.changeHealth(RHYTHM_RULES.health[judgement]);
    const payload = { note, judgement, delta, combo: this.combo, lane: note.lane, beat: note.beat, character: note.character, tier: getTierProgress(this.combo).index };
    this.emit('judge', payload);
    this.checkWord(note.word);
    return { accepted: true, correct: true, ...payload };
  }

  backspace() {
    return { accepted: false, reason: 'not_used' };
  }

  clearInput() {
    return { accepted: false, reason: 'not_used' };
  }

  finish(outcome = 'failed') {
    if (this.status === 'finished') return;
    this.outcome = outcome;
    super.finish();
  }

  // ---------- 결과 ----------
  // 판정 정확도: PERFECT 100%, GREAT 70%, GOOD 40%, BAD 10%, MISS 0%의 평균
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
      wordsCompleted: this.wordsCompleted,
      bpm: this.bpm
    };
  }

  summaryExtras() {
    return {
      outcome: this.outcome,
      rank: this.rank(),
      judgements: { ...this.counts },
      timingAccuracy: this.timingAccuracy(),
      totalNotes: this.notes.length,
      totalWords: this.words.length,
      completedTokens: this.wordsCompleted,
      cleanTokens: this.cleanWords,
      bpm: this.bpm,
      songId: this.song.id,
      songTitle: this.song.title,
      difficulty: this.difficultyKey
    };
  }
}
