import test from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine, RHYTHM_RULES, BeatClock, judgeTiming, laneOfCharacter, matchesNote, RHYTHM_MAX_POINTS_PER_CHARACTER } from '../public/js/rhythm-engine.js';
import { RHYTHM_SONGS, RHYTHM_DIFFICULTIES, DIFFICULTY_ORDER, getSong, noteToMidi, parseMelody } from '../public/js/rhythm-songs.js';
import { stepSong, stepDifficulty, songLength } from '../public/js/song-select.js';
import { getTokenPool } from '../public/js/tokens.js';

const seeded = seed => {
  let value = seed;
  return () => ((value = (value * 1664525 + 1013904223) % 4294967296) / 4294967296);
};
const create = (options = {}) => new RhythmEngine({ tokenPool: getTokenPool('javascript'), random: seeded(5), ...options });

// 게임 시간을 seconds까지 성능 시계로 진행(오디오 없음)
function advanceTo(engine, seconds, state) {
  while (engine.status === 'running' && engine.gameTime < seconds - 1e-9) {
    state.ms += Math.min(16, (seconds - engine.gameTime) * 1000);
    engine.update(state.ms);
  }
}

// 노트를 정박에서 offsetSeconds만큼 어긋나게 친다
function playNote(engine, note, offsetSeconds, state) {
  advanceTo(engine, note.hitTime + offsetSeconds, state);
  return engine.input(note.character, state.ms);
}

test('곡 목록: 선율·화음이 있고, 곡을 모르면 기본 곡, 음 이름 해석', () => {
  assert.ok(RHYTHM_SONGS.length >= 7);
  assert.equal(new Set(RHYTHM_SONGS.map(song => song.id)).size, RHYTHM_SONGS.length);
  for (const song of RHYTHM_SONGS) {
    assert.ok(song.melody.length > 20, song.id);
    assert.ok(song.chords.length > 0, song.id);
    assert.ok(song.totalBeats > 0 && song.bpm >= 90 && song.bpm <= 180, song.id);
    for (let index = 1; index < song.melody.length; index++) assert.ok(song.melody[index].beat >= song.melody[index - 1].beat, `${song.id} 선율 시각순`);
  }
  assert.equal(getSong('없는곡').id, 'ode-to-joy');
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(parseMelody('E4 D4').events.length, 2);
  assert.match(songLength(getSong('twinkle')), /^\d+:\d\d$/);
});

test('곡 선택: ↑↓는 끝에서 돌고, ←→ 난이도는 끝에서 멈춘다', () => {
  const first = RHYTHM_SONGS[0].id;
  const last = RHYTHM_SONGS.at(-1).id;
  assert.equal(stepSong(first, -1), last);
  assert.equal(stepSong(last, 1), first);
  assert.equal(stepDifficulty('easy', -1), 'easy');
  assert.equal(stepDifficulty('expert', 1), 'expert');
  assert.equal(stepDifficulty('normal', 1), 'hard');
});

test('악보: 곡 선율 위에 글자를 얹고, 난이도가 높을수록 촘촘하며 EASY는 사람이 칠 수 있는 속도', () => {
  for (const song of RHYTHM_SONGS) {
    const perMinute = [];
    const levels = [];
    for (const difficulty of DIFFICULTY_ORDER) {
      const engine = create({ songId: song.id, difficulty });
      const chart = RHYTHM_DIFFICULTIES[difficulty];
      assert.equal(engine.bpm, song.bpm);
      assert.ok(engine.words.length >= 3, `${song.id}/${difficulty} 낱말 수`);
      assert.ok(engine.notes[0].beat >= engine.leadInBeats, '카운트 뒤에 시작');
      for (const note of engine.notes) {
        assert.equal(note.character.length, 1);
        assert.ok(note.lane >= 0 && note.lane < 4);
        assert.ok(Number.isFinite(note.midi));
      }
      for (const word of engine.words) {
        assert.ok(word.token.text.length <= chart.maxLength);
        assert.equal(word.noteIds.map(id => engine.findEntity(id).character).join(''), word.token.text);
      }
      for (let index = 1; index < engine.notes.length; index++) {
        const gap = engine.notes[index].hitTime - engine.notes[index - 1].hitTime;
        assert.ok(gap >= chart.minGap - 1e-6, `${song.id}/${difficulty} 노트 간격 ${gap}`);
      }
      assert.ok(engine.autoNotes.length > 0, '글자 없는 선율 음은 자동 연주');
      perMinute.push(engine.notes.length / ((engine.endTime - engine.leadInBeats * engine.beatSeconds) / 60));
      levels.push(engine.levelNumber());
    }
    assert.ok(perMinute[0] < 80, `${song.id} EASY 속도 ${Math.round(perMinute[0])}`);
    assert.ok(perMinute.every((value, index) => index === 0 || value >= perMinute[index - 1] - 1), `${song.id} 난이도 순 ${perMinute.map(Math.round)}`);
    assert.ok(levels.every(level => level >= 1 && level <= 15));
  }
  assert.equal(laneOfCharacter('a'), 0);
  assert.equal(laneOfCharacter('f'), 1);
  assert.equal(laneOfCharacter('j'), 2);
  assert.equal(laneOfCharacter(';'), 3);
  assert.equal(RHYTHM_MAX_POINTS_PER_CHARACTER, 260);
  const engine = create({ songId: 'ode-to-joy', difficulty: 'nope' });
  assert.equal(engine.difficultyKey, 'normal', '모르는 난이도는 NORMAL');
  assert.ok(engine.chordAtBeat(engine.leadInBeats), '첫 박 화음');
});

test('판정 창: ±50ms PERFECT, ±100 GREAT, ±150 GOOD, 그 밖 BAD', () => {
  assert.equal(judgeTiming(0), 'perfect');
  assert.equal(judgeTiming(-0.049), 'perfect');
  assert.equal(judgeTiming(0.08), 'great');
  assert.equal(judgeTiming(-0.14), 'good');
  assert.equal(judgeTiming(0.2), 'bad');
});

test('글자마다 타이밍 판정, 일찍 누른 키는 무시, 범위 안 다른 글자는 오타, 낱말 완성 이벤트', () => {
  const engine = create({ songId: 'ode-to-joy', difficulty: 'normal' });
  const events = [];
  engine.onEvent = (type, payload) => events.push([type, payload]);
  const state = { ms: 1000 };
  assert.ok(engine.input('x', state.ms).started);
  assert.equal(engine.wrongKeystrokes, 0, '시작 키는 오타가 아님');
  assert.equal(engine.input(engine.notes[0].character, state.ms).reason, 'too_early', '리드인 중 키는 무시');

  const offsets = [0, 0.02, -0.08, 0.13, 0.2];
  const expected = ['perfect', 'perfect', 'great', 'good', 'bad'];
  offsets.forEach((offset, index) => {
    const result = playNote(engine, engine.notes[index], offset, state);
    assert.equal(result.judgement, expected[index], `노트 ${index}`);
  });
  assert.equal(engine.combo, 0, 'BAD는 콤보를 끊는다');
  assert.deepEqual(engine.counts, { perfect: 2, great: 1, good: 1, bad: 1, miss: 0 });

  const next = engine.headNote();
  advanceTo(engine, next.hitTime - 0.05, state);
  const wrong = next.character === 'z' ? 'q' : 'z';
  const mistake = engine.input(wrong, state.ms);
  assert.equal(mistake.correct, false);
  assert.equal(engine.wrongKeystrokes, 1);
  assert.equal(next.state, 'pending', '오타는 노트를 소모하지 않는다');

  const firstWord = engine.words[0];
  const wordEvent = events.find(([type, payload]) => type === 'word' && payload.word === firstWord);
  if (firstWord.noteIds.length <= 5) assert.ok(wordEvent, '첫 낱말 완성');
});

test('지나간 노트는 MISS, HP가 0이면 실패, 모두 PERFECT면 클리어 S·깨끗한 낱말 보너스', () => {
  const engine = create({ songId: 'can-can', difficulty: 'expert' });
  const state = { ms: 0 };
  engine.input('a', state.ms);
  let finished = null;
  engine.onEvent = (type, payload) => { if (type === 'finish') finished = payload.summary; };
  advanceTo(engine, engine.notes[0].hitTime + RHYTHM_RULES.missAfter + 0.05, state);
  assert.equal(engine.notes[0].state, 'missed');
  advanceTo(engine, engine.endTime + 1, state);
  assert.equal(finished.outcome, 'failed');
  assert.equal(finished.rank, 'F');

  const perfectRun = create({ songId: 'ode-to-joy', difficulty: 'normal' });
  const runState = { ms: 0 };
  perfectRun.input('a', runState.ms);
  let summary = null;
  perfectRun.onEvent = (type, payload) => { if (type === 'finish') summary = payload.summary; };
  for (const note of perfectRun.notes) playNote(perfectRun, note, 0, runState);
  advanceTo(perfectRun, perfectRun.endTime + 0.1, runState);
  assert.equal(summary.outcome, 'cleared');
  assert.equal(summary.rank, 'S');
  assert.equal(summary.judgements.perfect, perfectRun.notes.length);
  assert.equal(summary.cleanTokens, perfectRun.words.length);
  assert.ok(summary.score <= summary.correctKeystrokes * RHYTHM_MAX_POINTS_PER_CHARACTER, '서버 점수 상한 안');
});

test('오디오 시계: 돌고 있으면 오디오 증가분, 멈추면 성능 시계, 큰 공백은 0.25초로 자른다', () => {
  const context = { state: 'running', currentTime: 10, outputLatency: 0.02 };
  const clock = new BeatClock(() => context);
  clock.reset(0);
  context.currentTime = 10.1;
  assert.ok(Math.abs(clock.advance(5000, 0) - 0.1) < 1e-9, '성능 시계(5초)가 아니라 오디오 0.1초');
  assert.ok(Math.abs(clock.audioOffset - (10.08 - 0.1)) < 1e-9, '게임 시간 t의 소리는 offset + t에 예약');
  context.currentTime = 30;
  assert.equal(clock.advance(5016, 0.1), RHYTHM_RULES.maxFrameSeconds);
  context.state = 'suspended';
  assert.ok(Math.abs(clock.advance(5066, 0.35) - 0.05) < 1e-9);
  assert.equal(clock.audioOffset, null);
});

test('대문자 노트는 소문자로 쳐도 맞고, 소문자 노트에 대문자는 오타', () => {
  assert.ok(matchesNote('n', 'N'));
  assert.ok(matchesNote('N', 'N'));
  assert.ok(!matchesNote('N', 'n'));
  assert.ok(!matchesNote('m', 'N'));
  assert.ok(!matchesNote('1', '!'), '기호는 그대로');
  const engine = create({ songId: 'ode-to-joy', difficulty: 'normal' });
  const state = { ms: 0 };
  engine.input('x', state.ms);
  const note = engine.notes[0];
  note.character = 'S';
  advanceTo(engine, note.hitTime, state);
  const result = engine.input('s', state.ms);
  assert.equal(result.correct, true);
  assert.equal(result.judgement, 'perfect');
});
