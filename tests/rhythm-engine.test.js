import test from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine, RHYTHM_RULES, RHYTHM_CHARTS, BeatClock, judgeTiming, chordAtBeat, laneOfCharacter, RHYTHM_MAX_POINTS_PER_CHARACTER } from '../public/js/rhythm-engine.js';
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

test('악보: 128 BPM, 낱말을 글자 노트로 나눠 반 박 격자에, 레인은 손가락 구역, 레벨이 낮을수록 느리다', () => {
  assert.equal(RHYTHM_RULES.bpm, 128);
  const perMinute = [];
  for (const level of [1, 2, 3, 4]) {
    const engine = create({ level });
    const chart = RHYTHM_CHARTS[level];
    assert.ok(engine.words.length > 10);
    assert.equal(engine.notes[0].beat, RHYTHM_RULES.leadInBeats);
    for (const note of engine.notes) {
      assert.equal(note.character.length, 1);
      assert.ok(Number.isInteger(note.beat * 2), '반 박 격자');
      assert.ok(note.lane >= 0 && note.lane < 4);
    }
    for (const word of engine.words) {
      assert.ok(word.token.text.length <= chart.maxLength);
      assert.equal(word.noteIds.map(id => engine.findEntity(id).character).join(''), word.token.text);
    }
    for (let index = 1; index < engine.notes.length; index++) assert.ok(engine.notes[index].hitTime > engine.notes[index - 1].hitTime, '시각순, 겹치지 않음');
    perMinute.push(engine.notes.length / (engine.endTime / 60));
  }
  assert.ok(perMinute[0] < 70 && perMinute[1] < 110, `사람이 칠 수 있는 속도: ${perMinute.map(Math.round)}`);
  assert.ok(perMinute.every((value, index) => index === 0 || value > perMinute[index - 1]));
  assert.equal(laneOfCharacter('a'), 0);
  assert.equal(laneOfCharacter('f'), 1);
  assert.equal(laneOfCharacter('j'), 2);
  assert.equal(laneOfCharacter(';'), 3);
  assert.equal(chordAtBeat(4).name, 'F');
  assert.equal(RHYTHM_MAX_POINTS_PER_CHARACTER, 260);
});

test('판정 창: ±50ms PERFECT, ±100 GREAT, ±150 GOOD, 그 밖 BAD', () => {
  assert.equal(judgeTiming(0), 'perfect');
  assert.equal(judgeTiming(-0.049), 'perfect');
  assert.equal(judgeTiming(0.08), 'great');
  assert.equal(judgeTiming(-0.14), 'good');
  assert.equal(judgeTiming(0.2), 'bad');
});

test('글자마다 타이밍 판정, 일찍 누른 키는 무시, 범위 안 다른 글자는 오타, 낱말 완성 이벤트', () => {
  const engine = create({ level: 2 });
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
  const engine = create({ level: 4 });
  const state = { ms: 0 };
  engine.input('a', state.ms);
  let finished = null;
  engine.onEvent = (type, payload) => { if (type === 'finish') finished = payload.summary; };
  advanceTo(engine, engine.notes[0].hitTime + RHYTHM_RULES.missAfter + 0.05, state);
  assert.equal(engine.notes[0].state, 'missed');
  advanceTo(engine, engine.endTime + 1, state);
  assert.equal(finished.outcome, 'failed');
  assert.equal(finished.rank, 'F');

  const perfectRun = create({ level: 2 });
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
