// 리듬 모드: 128 BPM 고정 4레인 낙하형 코드 타자.
// 코드 낱말(토큰)을 한 글자씩 나눠 큰 원 노트로 박에 맞춰 떨어뜨린다. 원이 판정선에 닿는 순간 그 글자를 치면
// 타이밍으로 PERFECT·GREAT·GOOD·BAD가 갈리고, 글자가 모두 판정되면 낱말 하나가 완성된다(화면 위에 표시).
// 레인 = 그 글자를 치는 손가락 구역(왼손 바깥 · 왼손 안쪽 · 오른손 안쪽 · 오른손 바깥).
// 시간은 오디오 시계(AudioContext.currentTime − 출력 지연)를 따라가서 들리는 박자와 판정선이 어긋나지 않는다.
import { TargetGameEngine } from './target-game.js';
import { getMultiplier, getTierProgress } from './engine.js';
import { describeKey } from './keyboard.js';
import { getSong, RHYTHM_DIFFICULTIES, CHORD_ACCENT_SONGS, audioTimeAtBeat } from './rhythm-songs.js';

export const RHYTHM_RULES = Object.freeze({
  // 기본 곡(beat-compiler.wav)의 템포. 곡마다 bpm·박자가 다르다(rhythm-songs.js)
  bpm: 128,
  // 판정 창(초, 정박 기준 ±). 그 밖이지만 missAfter 안에 치면 BAD, 지나가면 MISS
  windows: Object.freeze({ perfect: 0.05, great: 0.1, good: 0.15 }),
  missAfter: 0.25,
  // 곡 시작 유예: 첫 원이 이만큼보다 멀면 아무 키나 눌러도 감점하지 않는다(키보드 4구역 안내도 이때까지)
  startGrace: 0.6,
  // 글자 하나의 점수(× 콤보 배율). 낱말의 모든 글자를 GOOD 이상으로, 오타 없이 치면 글자당 wordBonus 추가
  points: Object.freeze({ perfect: 100, great: 70, good: 40, bad: 10 }),
  wordBonus: 30,
  // 노트가 끝나고 이만큼 지나면 스테이지 클리어
  outroSeconds: 1.6,
  // 피버(DJMAX식 자동 피버): GOOD 이상으로 게이지가 차고, 가득 차면 피버 레벨이 1 오른다(최대 5).
  // 피버 중 점수 × (1 + 0.1 × 레벨). BAD·MISS·오타가 나면 피버가 끝나고 레벨이 0으로
  fever: Object.freeze({ gain: Object.freeze({ perfect: 5, great: 3.5, good: 1.5 }), maxLevel: 5, bonusPerLevel: 0.1 }),
  // 롱노트(막대): 선율에서 길게 끄는 음(minBeats박 이상)이고 다음 노트까지 여유가 있으면 막대로 만든다.
  // 머리에서 키를 누르고 꼬리 근처까지 누르고 있으면 성공(콤보 +1, 꼬리 판정은 HOLD_RELEASE_WINDOWS). 너무 일찍 떼면 끊김.
  // 키를 떼는 신호가 없는 기기(휴대폰 화면 자판)는 꼬리에서 자동 성공
  hold: Object.freeze({ minBeats: 1.5, minSeconds: 0.45, maxSeconds: 2.4, gapAfter: 0.22, releaseGrace: 0.12, maxShare: 0.25 }),
  // 탭 전환·멈춤으로 시계가 크게 건너뛰면 한 프레임에 이만큼만 진행(그 사이는 멈춘 것으로 본다)
  maxFrameSeconds: 0.25
});

export const JUDGEMENTS = Object.freeze(['perfect', 'great', 'good', 'bad', 'miss']);

// 게이지(IIDX 그루브 게이지 참고). 0~100
// easy·normal: start에서 시작해 중간에 떨어져도 끝까지 간다(최저 floor). 곡이 끝날 때 clearAt 이상이면 클리어.
//   PERFECT·GREAT 하나가 recoveryTotal ÷ 판정 수만큼 채운다(GOOD은 절반) → 노트 수와 상관없이 다 맞히면 같은 양이 찬다
// hard: 100에서 시작해 0이 되면 바로 실패(회복은 작고 고정). 노페일이면 0이어도 계속
// empty: 공POOR(원이 오기 전·다른 글자) — 콤보는 그대로, 게이지만 조금
export const RHYTHM_GAUGES = Object.freeze({
  easy: Object.freeze({ label: 'EASY', color: '#39ff88', start: 22, floor: 2, clearAt: 60, survival: false, recoveryTotal: 200, bad: -1.2, miss: -3.6, empty: -0.6 }),
  normal: Object.freeze({ label: 'NORMAL', color: '#36e2ff', start: 22, floor: 2, clearAt: 75, survival: false, recoveryTotal: 160, bad: -2, miss: -6, empty: -1 }),
  hard: Object.freeze({ label: 'HARD', color: '#ff4d6d', start: 100, floor: 0, clearAt: 0, survival: true, perfect: 0.16, great: 0.16, good: 0, bad: -5, miss: -9, empty: -2 })
});
export const GAUGE_ORDER = Object.freeze(Object.keys(RHYTHM_GAUGES));

// 난이도별 판정 창 배율(쉬울수록 넓게). missAfter도 같이 늘고 준다
export const RHYTHM_WINDOW_SCALES = Object.freeze({ easy: 1.25, normal: 1, hard: 0.9, expert: 0.8 });
// 롱노트 꼬리(떼는 순간) 판정: 꼬리보다 이만큼 일찍 떼도 그 판정. 그보다 일찍이면 끊김. 끝까지 누르고 있으면 PERFECT
export const HOLD_RELEASE_WINDOWS = Object.freeze({ perfect: 0.1, great: 0.18, good: 0.26 });

// 클리어 램프(곡·난이도별로 가장 좋은 것을 남긴다). ASSIST = 노페일로 끝까지
export const CLEAR_LAMPS = Object.freeze(['FAILED', 'ASSIST', 'EASY', 'CLEAR', 'HARD', 'FC', 'AP']);
export const lampOrder = lamp => CLEAR_LAMPS.indexOf(lamp);

// EX 점수(IIDX식): PERFECT 2, GREAT 1. 롱노트 꼬리도 하나로 센다. 랭크는 EX 비율로(9등분: 8/9 이상 S …)
export const EX_POINTS = Object.freeze({ perfect: 2, great: 1 });
export const RANK_THRESHOLDS = Object.freeze([['S', 8 / 9], ['A', 7 / 9], ['B', 6 / 9], ['C', 5 / 9], ['D', 0]]);
export function rankFromExRate(rate) {
  return RANK_THRESHOLDS.find(([, minimum]) => rate >= minimum * 100 - 1e-9)?.[0] ?? 'D';
}
// 점수 상한 검증용(서버): 글자 하나 최고점 = (PERFECT + 낱말 보너스) × 최대 배율 2
// 점수 상한 검증용(서버): 글자 하나 최고점 = (PERFECT + 낱말 보너스) × 최대 콤보 배율 2 × 최대 피버 배율
export const RHYTHM_MAX_POINTS_PER_CHARACTER = Math.ceil((RHYTHM_RULES.points.perfect + RHYTHM_RULES.wordBonus) * 2 * (1 + RHYTHM_RULES.fever.maxLevel * RHYTHM_RULES.fever.bonusPerLevel));

// 게임 옵션(osu! 모드·DJMAX 옵션 참고). speed: 낙하 속도 배율, offsetMs: 입력 보정(+면 늦게 쳐도 맞게)
// gauge: easy|normal|hard(RHYTHM_GAUGES) · noFail: 게이지와 상관없이 끝까지(어시스트 클리어, 점수 ×0.5) · suddenDeath: MISS·BAD 하나면 실패 · perfectOnly: PERFECT가 아니면 실패
// hidden: 판정선 가까이에서 노트가 사라짐 · fadeIn: 판정선 가까이에서 나타남 · mirror: 레인 좌우 반전(화면만)
// autoPlay: 자동 연주(기록·포인트 없음)
export const RHYTHM_OPTION_DEFAULTS = Object.freeze({ speed: 1, offsetMs: 0, gauge: 'normal', noFail: false, suddenDeath: false, perfectOnly: false, hidden: false, fadeIn: false, mirror: false, autoPlay: false });
export const RHYTHM_SPEEDS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
export const NO_FAIL_SCORE_FACTOR = 0.5;

// 저장된 값이 깨져 있어도 안전한 옵션으로. 서로 맞지 않는 조합(노페일+서든데스 등)은 뒤쪽을 끈다
export function normalizeRhythmOptions(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const options = { ...RHYTHM_OPTION_DEFAULTS };
  for (const key of ['noFail', 'suddenDeath', 'perfectOnly', 'hidden', 'fadeIn', 'mirror', 'autoPlay']) options[key] = source[key] === true;
  options.speed = RHYTHM_SPEEDS.includes(source.speed) ? source.speed : 1;
  options.gauge = RHYTHM_GAUGES[source.gauge] ? source.gauge : 'normal';
  options.offsetMs = Number.isFinite(source.offsetMs) ? Math.max(-200, Math.min(200, Math.round(source.offsetMs / 5) * 5)) : 0;
  if (options.noFail) {
    options.suddenDeath = false;
    options.perfectOnly = false;
  }
  if (options.hidden && options.fadeIn) options.fadeIn = false;
  return Object.freeze(options);
}

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

// Shift로 치는 기호 → 같은 자리의 기본 키. 리듬 모드에서는 Shift 없이 그 자리만 눌러도 맞다(대문자도 소문자로 인정)
const SHIFTED_TO_BASE = Object.freeze({ '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/' });
export const matchesNote = (typed, expected) => typed === expected
  || (expected !== expected.toLowerCase() && typed === expected.toLowerCase())
  || SHIFTED_TO_BASE[expected] === typed;

// 타이밍 판정. scale = 난이도별 판정 창 배율(RHYTHM_WINDOW_SCALES)
export function judgeTiming(deltaSeconds, scale = 1) {
  const distance = Math.abs(deltaSeconds);
  const { windows } = RHYTHM_RULES;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (distance <= windows.perfect * safeScale) return 'perfect';
  if (distance <= windows.great * safeScale) return 'great';
  if (distance <= windows.good * safeScale) return 'good';
  return 'bad';
}

// 롱노트를 꼬리보다 earlySeconds 일찍 뗐을 때의 판정. 너무 일찍이면 null(끊김)
export function judgeRelease(earlySeconds) {
  const early = Math.max(0, earlySeconds);
  if (early <= HOLD_RELEASE_WINDOWS.perfect) return 'perfect';
  if (early <= HOLD_RELEASE_WINDOWS.great) return 'great';
  if (early <= HOLD_RELEASE_WINDOWS.good) return 'good';
  return null;
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
  constructor({ getAudioContext = () => null, songId, difficulty = 'normal', narrow = false, rhythmOptions = null, ...options }) {
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
    this.options = normalizeRhythmOptions(rhythmOptions);
    this.offset = this.options.offsetMs / 1000;
    this.fallSeconds = chart.fallSeconds / this.options.speed;
    this.fever = { gauge: 0, level: 0 };
    this.fastLate = { fast: 0, late: 0, deltaSum: 0, hits: 0 };
    this.windowScale = RHYTHM_WINDOW_SCALES[difficultyKey] ?? 1;
    this.missAfter = RHYTHM_RULES.missAfter * this.windowScale;
    this.gauge = RHYTHM_GAUGES[this.options.gauge];
    this.health = this.gauge.start;
    this.emptyPoors = 0;
    this.exScore = 0;
    this.counts = Object.fromEntries(JUDGEMENTS.map(name => [name, 0]));
    this.outcome = null;
    this.wordsCompleted = 0;
    this.cleanWords = 0;
    this.headIndex = 0;
    this.activeHold = null;
    this.holdStats = { done: 0, broken: 0, perfect: 0, great: 0, good: 0 };
    const { words, notes, autoNotes } = this.buildChart();
    this.words = words;
    this.notes = notes;
    this.autoNotes = autoNotes;
    // 반주가 연주하는 선율 전체: 글자를 얹은 음도 포함한다(곡은 그대로 흐르고, 맞히면 그 음이 작게 한 번 더 난다)
    this.melodyNotes = [...autoNotes, ...notes.filter(note => !note.chordPartner).map(note => ({ time: note.hitTime, dur: note.dur * this.beatSeconds, midi: note.midi }))]
      .filter(note => Number.isFinite(note.midi))
      .sort((first, second) => first.time - second.time);
    this.lastHitTime = notes.at(-1)?.hitTime ?? 0;
    this.endTime = this.timeOfSongBeat(song.totalBeats) + RHYTHM_RULES.outroSeconds;
    // 판정 수 = 노트 + 롱노트 꼬리. 그루브 게이지 회복량·EX 만점의 기준
    this.judgedTotal = Math.max(1, notes.length + this.holdCount);
    this.exMax = this.judgedTotal * EX_POINTS.perfect;
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
      const time = this.timeOfSongBeat(event.beat) + (event.nudge ?? 0);
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
        // 동시 입력: 강박이면 다음 글자를 같은 박에 붙인다(다음 글자가 오른쪽 레인일 때만 → 왼쪽부터 낱말 순서대로 읽힌다)
        const nextCharacter = characters[charIndex + 1];
        if (nextCharacter !== undefined && this.isChordBeat(event.beat) && this.canChord(character, nextCharacter)) {
          const partner = {
            id: this.nextId++, word, charIndex: charIndex + 1, character: nextCharacter, lane: laneOfCharacter(nextCharacter), midi: event.midi - 12, dur: event.dur,
            beat, hitTime: time, state: 'pending', judgement: null, delta: 0, resolvedAt: null, chord: true, chordPartner: true
          };
          note.chord = true;
          note.chordWith = partner;
          partner.chordWith = note;
          notes.push(partner);
          word.noteIds.push(partner.id);
        }
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
      for (const note of notes.filter(entry => unfinished.has(entry.id) && !entry.chordPartner)) autoNotes.push({ time: note.hitTime, dur: note.dur * this.beatSeconds, midi: note.midi });
      notes.splice(notes.length - word.noteIds.length);
      autoNotes.sort((first, second) => first.time - second.time);
    }
    this.markHolds(notes);
    return { words, notes, autoNotes };
  }

  // 곡 박(리드인 제외, 소수 가능) → 게임 시각(초). 음원 곡은 템포 지도를 따라가므로 곡 중간에 템포가 바뀌어도 밀리지 않는다. O(1)
  timeOfSongBeat(songBeat) {
    const leadInSeconds = this.leadInBeats * this.beatSeconds;
    const beatTimes = this.song.audio?.beatTimes;
    if (!beatTimes?.length) return leadInSeconds + songBeat * this.beatSeconds;
    return leadInSeconds + audioTimeAtBeat(beatTimes, songBeat) - beatTimes[0];
  }

  // 화면의 박·마디 선 시각들(from~to초). 리드인은 고정 박, 곡은 timeOfSongBeat. O(선 수)
  beatLines(fromSeconds, toSeconds) {
    const lines = [];
    const leadInSeconds = this.leadInBeats * this.beatSeconds;
    let songBeat = Math.floor((fromSeconds - leadInSeconds) / this.beatSeconds) - 2;
    for (let guard = 0; guard < 400; guard++, songBeat++) {
      const time = this.timeOfSongBeat(songBeat);
      if (time > toSeconds) break;
      if (time >= fromSeconds) lines.push({ time, bar: ((songBeat % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0 });
    }
    return lines;
  }

  // 동시 노트를 놓을 박인가: 마디 첫 박(강세 곡은 반 마디 강박도) + 난이도별 확률
  isChordBeat(songBeat) {
    const accent = CHORD_ACCENT_SONGS.has(this.song.id);
    const unit = accent && this.beatsPerBar % 2 === 0 ? this.beatsPerBar / 2 : this.beatsPerBar;
    const onAccent = Math.abs(songBeat / unit - Math.round(songBeat / unit)) < 1e-6;
    const chance = Math.min(0.95, (this.chart.chordChance ?? 0) * (accent ? 1.4 : 1));
    return onAccent && chance > 0 && this.random() < chance;
  }

  // 두 글자를 동시에 칠 수 있나: 공백이 아니고, 뒤 글자가 앞 글자보다 오른쪽 레인
  canChord(leftCharacter, rightCharacter) {
    if (leftCharacter === ' ' || rightCharacter === ' ') return false;
    return laneOfCharacter(rightCharacter) > laneOfCharacter(leftCharacter);
  }

  // 길게 끄는 음을 롱노트로: 꼬리 = min(음 길이, 다음 노트 - gapAfter, maxSeconds). minSeconds보다 짧으면 일반 노트. O(노트 수)
  markHolds(notes) {
    const { minBeats, minSeconds, maxSeconds, gapAfter } = RHYTHM_RULES.hold;
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index];
      note.holdEnd = null;
      note.holdState = null;
      if (!(note.dur >= minBeats) || note.character === ' ' || note.chord) continue;
      const next = notes[index + 1];
      const room = (next ? next.hitTime : Infinity) - gapAfter;
      const end = Math.min(note.hitTime + note.dur * this.beatSeconds, room, note.hitTime + maxSeconds);
      if (end - note.hitTime >= minSeconds) note.holdEnd = end;
    }
    // 막대가 너무 많으면 지루하다: 전체의 maxShare까지, 긴 것부터 남긴다
    const holds = notes.filter(note => note.holdEnd !== null).sort((first, second) => (second.holdEnd - second.hitTime) - (first.holdEnd - first.hitTime));
    for (const note of holds.slice(Math.ceil(notes.length * RHYTHM_RULES.hold.maxShare))) note.holdEnd = null;
    this.holdCount = notes.filter(note => note.holdEnd !== null).length;
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
    if (this.activeHold && this.gameTime - this.offset >= this.activeHold.holdEnd) this.finishHold('perfect');
    let head = this.headNote();
    if (this.options.autoPlay) {
      while (head && this.gameTime >= head.hitTime) {
        this.hit(head, 0);
        if (this.status !== 'running') return;
        head = this.headNote();
      }
    }
    while (head && this.gameTime - this.offset - head.hitTime > this.missAfter) {
      this.resolveMiss(head);
      if (this.status !== 'running') return;
      head = this.headNote();
    }
    if (this.gameTime >= this.endTime) this.finishSong();
  }

  // 곡 끝: 하드는 살아남았으면 클리어, 그루브 게이지는 기준선 이상이어야 클리어. 노페일은 무조건 끝까지(어시스트)
  finishSong() {
    const passed = this.gauge.survival || this.health >= this.gauge.clearAt || this.options.noFail;
    this.finish(passed ? 'cleared' : 'failed');
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
    this.breakFever();
    this.noteWeak(note.word);
    this.changeHealth(this.gaugeDelta('miss'));
    this.emit('miss', { note });
    this.checkStrict('miss');
    if (this.status !== 'running') return;
    this.checkWord(note.word);
  }

  noteWeak(word) {
    const entry = this.weakTokens.get(word.token.text) ?? { token: word.token, misses: 0 };
    entry.misses++;
    this.weakTokens.set(word.token.text, entry);
  }

  // 판정 하나가 게이지에 주는 양. 그루브 게이지의 회복은 판정 수로 나눠 곡 길이와 상관없게 한다
  gaugeDelta(judgement) {
    const gauge = this.gauge;
    if (gauge.survival) return gauge[judgement] ?? 0;
    if (judgement === 'perfect' || judgement === 'great') return gauge.recoveryTotal / this.judgedTotal;
    if (judgement === 'good') return gauge.recoveryTotal / this.judgedTotal / 2;
    return gauge[judgement] ?? 0;
  }

  changeHealth(amount) {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.health = Math.max(this.gauge.floor, Math.min(100, this.health + amount));
    if (this.gauge.survival && this.health <= 0 && !this.options.noFail) this.finish('failed');
  }

  // 서든데스·퍼펙트 온리: 조건을 어기면 바로 실패(공POOR는 해당 없음)
  checkStrict(judgement) {
    if (this.options.suddenDeath && (judgement === 'miss' || judgement === 'bad')) this.finish('failed');
    else if (this.options.perfectOnly && judgement !== 'perfect') this.finish('failed');
  }

  // ---------- 피버 ----------
  feverMultiplier() {
    return 1 + this.fever.level * RHYTHM_RULES.fever.bonusPerLevel;
  }

  chargeFever(judgement) {
    const gain = RHYTHM_RULES.fever.gain[judgement] ?? 0;
    if (!gain) return;
    this.fever.gauge += gain;
    if (this.fever.gauge >= 100) {
      this.fever.gauge -= 100;
      if (this.fever.level < RHYTHM_RULES.fever.maxLevel) {
        this.fever.level++;
        this.emit('fever', { level: this.fever.level });
      } else {
        this.fever.gauge = 100;
      }
    }
  }

  breakFever() {
    if (this.fever.level > 0) this.emit('fever-end', { level: this.fever.level });
    this.fever.level = 0;
    this.fever.gauge = Math.min(this.fever.gauge, 50);
  }

  // 점수 배율(콤보 × 피버 × 노페일)
  scoreFactor() {
    return getMultiplier(this.combo) * this.feverMultiplier() * (this.options.noFail ? NO_FAIL_SCORE_FACTOR : 1);
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
      bonus = Math.round(RHYTHM_RULES.wordBonus * notes.length * this.scoreFactor());
      this.score += bonus;
    }
    this.emit('word', { word, clean: word.clean, bonus, judgements: notes.map(note => note.judgement), lane: notes.at(-1).lane, beat: notes.at(-1).beat });
  }

  // ---------- 목표 ----------
  targetables() {
    const head = this.headNote();
    if (!head || head.hitTime - this.fallSeconds > this.gameTime) return [];
    return head.chordWith?.state === 'pending' ? [head, head.chordWith] : [head];
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
      const holdVisible = note.holdEnd && (note.holdState === 'holding' || (note.state === 'missed' && this.gameTime < note.holdEnd + 0.2)
        || (note.holdResolvedAt !== undefined && this.gameTime - note.holdResolvedAt < 0.4));
      if (note.state === 'pending' || this.gameTime - note.resolvedAt < 0.4 || holdVisible) visible.push(note);
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
    if (this.options.autoPlay) return { accepted: false, reason: 'auto_play' };
    // 막대를 누르고 있는 동안 키 자동 반복으로 들어오는 같은 글자는 무시
    if (this.activeHold && matchesNote(character, this.activeHold.character)) return { accepted: false, reason: 'holding' };
    if (!head) return { accepted: false, reason: 'too_early' };
    const ahead = head.hitTime - (this.gameTime - this.offset);
    // 곡 시작 전(첫 원이 아직 멀 때)에는 어떤 키도 감점하지 않는다
    const beforeFirstNote = head === this.notes[0] && ahead > RHYTHM_RULES.startGrace;
    if (beforeFirstNote) return { accepted: false, reason: 'too_early' };
    // 원이 판정 범위(±missAfter) 밖에 있을 때 누르면, 다음 글자든 아니든 공POOR. 범위 안에서는 다음 글자만 맞다
    // 동시 노트는 두 글자 중 아무거나 먼저 쳐도 된다
    const target = [head, head.chordWith].find(note => note && note.state === 'pending' && matchesNote(character, note.character));
    if (ahead > this.missAfter || !target) return this.wrongKey(head, character);
    return this.hit(target);
  }

  // 공POOR(IIDX): 원이 오기 전에 누르거나 다른 글자. 콤보·피버·점수·풀콤보는 그대로, 게이지만 조금 준다.
  // 노트는 그대로 남는다(제때 치면 된다)
  wrongKey(head, character) {
    this.wrongKeystrokes++;
    this.emptyPoors++;
    const payload = { typed: character, expected: head.character, target: head.word, note: head, comboLost: 0, position: head.charIndex, emptyPoor: true };
    this.emit('mistake', payload);
    this.changeHealth(this.gaugeDelta('empty'));
    return { accepted: true, correct: false, ...payload };
  }

  hit(note, fixedDelta = null, forcedJudgement = null) {
    const delta = fixedDelta ?? this.gameTime - this.offset - note.hitTime;
    const judgement = forcedJudgement ?? judgeTiming(delta, this.windowScale);
    this.fastLate.hits++;
    this.fastLate.deltaSum += delta;
    if (judgement !== 'perfect') this.fastLate[delta < 0 ? 'fast' : 'late']++;
    this.correctKeystrokes++;
    const second = Math.floor(this.gameTime);
    this.correctPerSecond[second] = (this.correctPerSecond[second] ?? 0) + 1;
    if (judgement === 'bad') {
      if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
      this.combo = 0;
      this.breakFever();
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.chargeFever(judgement);
    }
    this.score += Math.round(RHYTHM_RULES.points[judgement] * this.scoreFactor());
    this.counts[judgement]++;
    this.exScore += EX_POINTS[judgement] ?? 0;
    note.state = 'hit';
    note.judgement = judgement;
    note.delta = delta;
    note.resolvedAt = this.gameTime;
    if (note.holdEnd !== null && note.holdEnd !== undefined) {
      // 막대 머리를 쳤으면 꼬리까지 누르고 있어야 한다(이전 막대는 이 시점에 끝난 것으로 본다)
      if (this.activeHold) this.finishHold('perfect');
      note.holdState = 'holding';
      this.activeHold = note;
    }
    this.changeHealth(this.gaugeDelta(judgement));
    const payload = { note, judgement, delta, combo: this.combo, lane: note.lane, beat: note.beat, character: note.character, tier: getTierProgress(this.combo).index };
    this.emit('judge', payload);
    this.checkStrict(judgement);
    if (this.status !== 'running') return { accepted: true, correct: true, ...payload };
    this.checkWord(note.word);
    return { accepted: true, correct: true, ...payload };
  }

  // 키를 뗐다: 누르고 있던 막대의 글자면 꼬리 전에 뗐는지 본다. characters = 그 키로 칠 수 있는 글자 후보들
  release(characters, nowMs) {
    if (this.status !== 'running' || !this.activeHold) return { accepted: false, reason: 'no_hold' };
    this.update(nowMs);
    const note = this.activeHold;
    if (!note || !characters.some(character => matchesNote(character, note.character) || character.toLowerCase() === note.character.toLowerCase())) {
      return { accepted: false, reason: 'other_key' };
    }
    const tail = judgeRelease(note.holdEnd - (this.gameTime - this.offset));
    this.finishHold(tail);
    return { accepted: true, held: tail !== null, judgement: tail };
  }

  // 막대 끝: tailJudgement(perfect|great|good)면 콤보 +1·EX·게이지(점수는 머리에서만), null이면 끊김 = 콤보·피버가 끊긴다
  finishHold(tailJudgement) {
    const note = this.activeHold;
    if (!note) return;
    this.activeHold = null;
    const success = typeof tailJudgement === 'string' && tailJudgement in HOLD_RELEASE_WINDOWS;
    note.holdState = success ? 'done' : 'broken';
    note.holdJudgement = success ? tailJudgement : null;
    note.holdResolvedAt = this.gameTime;
    if (success) {
      this.holdStats.done++;
      this.holdStats[tailJudgement]++;
      this.exScore += EX_POINTS[tailJudgement] ?? 0;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.changeHealth(this.gaugeDelta(tailJudgement));
      this.emit('hold', { note, success: true, judgement: tailJudgement, lane: note.lane, combo: this.combo });
      if (this.options.perfectOnly && tailJudgement !== 'perfect') this.finish('failed');
      return;
    }
    this.holdStats.broken++;
    if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
    this.combo = 0;
    this.breakFever();
    this.changeHealth(this.gaugeDelta('bad'));
    this.emit('hold', { note, success: false, judgement: null, lane: note.lane, combo: 0 });
    this.checkStrict('bad');
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

  // 풀 콤보: 클리어 + MISS·BAD·끊긴 막대 없음(공POOR는 상관없음) / 올 퍼펙트: 풀 콤보 + 머리·꼬리 전부 PERFECT
  clearMark() {
    if (this.outcome !== 'cleared' || this.options.autoPlay || this.options.noFail) return null;
    if (this.counts.miss || this.counts.bad || this.holdStats.broken) return null;
    const imperfect = this.counts.great + this.counts.good + this.holdStats.great + this.holdStats.good;
    return imperfect ? 'FC' : 'AP';
  }

  // 클리어 램프: FAILED < ASSIST(노페일) < EASY < CLEAR < HARD < FC < AP. 자동 연주는 없음
  clearLamp() {
    if (this.options.autoPlay || !this.outcome) return null;
    if (this.outcome !== 'cleared') return 'FAILED';
    if (this.options.noFail) return 'ASSIST';
    return this.clearMark() ?? { easy: 'EASY', normal: 'CLEAR', hard: 'HARD' }[this.options.gauge];
  }

  // EX 비율(%): 지금까지의 EX 점수 ÷ 곡 전체 만점
  exRate() {
    return Math.round(this.exScore / this.exMax * 10000) / 100;
  }

  // 평균 타이밍(ms, +면 늦게 침). 오프셋 보정 추천값 = 지금 오프셋 + 평균
  averageDeltaMs() {
    return this.fastLate.hits ? Math.round(this.fastLate.deltaSum / this.fastLate.hits * 1000) : 0;
  }

  rank() {
    if (this.outcome === 'failed') return 'F';
    return rankFromExRate(this.exRate());
  }

  snapshotExtras() {
    return {
      health: this.health,
      lives: this.health <= 25 ? 1 : 3,
      gauge: this.options.gauge,
      exScore: this.exScore,
      exRate: this.exRate(),
      emptyPoors: this.emptyPoors,
      progress: Math.min(1, this.gameTime / this.endTime),
      counts: { ...this.counts },
      timingAccuracy: this.timingAccuracy(),
      wordsCompleted: this.wordsCompleted,
      bpm: this.bpm,
      fever: { ...this.fever }
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
      difficulty: this.difficultyKey,
      clearMark: this.clearMark(),
      clearLamp: this.clearLamp(),
      assist: Boolean(this.options.noFail),
      autoPlay: Boolean(this.options.autoPlay),
      gaugeClearAt: this.gauge.clearAt,
      songProgress: Math.round(Math.max(0, Math.min(1, (this.gameTime - this.leadInBeats * this.beatSeconds) / Math.max(1, this.endTime - this.leadInBeats * this.beatSeconds))) * 1000) / 1000,
      gauge: this.options.gauge,
      gaugeEnd: Math.round(this.health * 10) / 10,
      exScore: this.exScore,
      exMax: this.exMax,
      exRate: this.exRate(),
      emptyPoors: this.emptyPoors,
      fast: this.fastLate.fast,
      late: this.fastLate.late,
      averageDeltaMs: this.averageDeltaMs(),
      offsetMs: this.options.offsetMs,
      modifiers: Object.entries(this.options).filter(([key, value]) => value === true).map(([key]) => key),
      speed: this.options.speed,
      autoPlay: this.options.autoPlay,
      holds: { ...this.holdStats, total: this.holdCount },
      chords: this.notes.filter(note => note.chordPartner).length
    };
  }
}
