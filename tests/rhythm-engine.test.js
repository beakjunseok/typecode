import test from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine, RHYTHM_RULES, BEAT_SECONDS, RHYTHM_CHARTS, BeatClock, judgeTiming, chordAtBeat, RHYTHM_MAX_POINTS_PER_CHARACTER } from '../public/js/rhythm-engine.js';
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

// 노트를 정박에서 offsetSeconds만큼 어긋나게 친다: 앞 글자는 미리, 마지막 글자는 그 시각에
function playNote(engine, note, offsetSeconds, state) {
  const text = note.token.text;
  advanceTo(engine, Math.max(engine.gameTime, note.hitTime - engine.fallSeconds * 0.5), state);
  for (const character of text.slice(0, -1)) engine.input(character, state.ms);
  advanceTo(engine, note.hitTime + offsetSeconds, state);
  return engine.input(text.at(-1), state.ms);
}

test('악보: 128 BPM, 리드인 뒤 정박에만 노트, 레벨마다 간격·길이 제한', () => {
  assert.equal(RHYTHM_RULES.bpm, 128);
  for (const level of [1, 2, 3, 4]) {
    const engine = create({ level });
    const chart = RHYTHM_CHARTS[level];
    assert.ok(engine.notes.length > 20);
    assert.equal(engine.notes[0].beat, RHYTHM_RULES.leadInBeats);
    for (const note of engine.notes) {
      assert.ok(Number.isInteger(note.beat), '정박');
      assert.ok(Math.abs(note.hitTime - note.beat * BEAT_SECONDS) < 1e-9);
      assert.ok(note.token.text.length <= chart.maxLength, `Lv${level} ${note.token.text}`);
      assert.ok(note.lane >= 0 && note.lane < 4);
    }
    for (let index = 1; index < engine.notes.length; index++) assert.notEqual(engine.notes[index].token.text, engine.notes[index - 1].token.text);
  }
  assert.equal(chordAtBeat(0).name, 'Am');
  assert.equal(chordAtBeat(4).name, 'F');
  assert.equal(RHYTHM_MAX_POINTS_PER_CHARACTER, 300);
});

test('판정 창: ±50ms PERFECT, ±100 GREAT, ±150 GOOD, 그 밖 BAD', () => {
  assert.equal(judgeTiming(0), 'perfect');
  assert.equal(judgeTiming(-0.049), 'perfect');
  assert.equal(judgeTiming(0.08), 'great');
  assert.equal(judgeTiming(-0.14), 'good');
  assert.equal(judgeTiming(0.2), 'bad');
});

test('첫 키는 시작 신호, 마지막 글자 타이밍으로 판정·콤보·점수·HP가 바뀐다', () => {
  const engine = create({ level: 2 });
  const events = [];
  engine.onEvent = (type, payload) => events.push([type, payload]);
  const state = { ms: 1000 };
  const start = engine.input('x', state.ms);
  assert.ok(start.started);
  assert.equal(engine.wrongKeystrokes, 0, '시작 키는 오타가 아님');
  assert.equal(engine.input('x', state.ms).reason, 'no_note', '리드인 동안 노트 없음');

  const offsets = [0, 0.02, -0.08, 0.13, 0.2];
  const expected = ['perfect', 'perfect', 'great', 'good', 'bad'];
  offsets.forEach((offset, index) => {
    const result = playNote(engine, engine.notes[index], offset, state);
    assert.ok(result.fired);
    assert.equal(result.judgement, expected[index], `노트 ${index}`);
  });
  assert.equal(engine.combo, 0, 'BAD는 콤보를 끊는다');
  assert.equal(engine.maxCombo, 4);
  assert.deepEqual(engine.counts, { perfect: 2, great: 1, good: 1, bad: 1, miss: 0 });
  assert.ok(engine.score > 0);
  assert.ok(events.some(([type]) => type === 'judge'));
});

test('판정선을 지나간 노트는 MISS, HP가 0이 되면 실패, 끝까지 버티면 클리어', () => {
  const engine = create({ level: 4 });
  const state = { ms: 0 };
  engine.input('a', state.ms);
  let finished = null;
  engine.onEvent = (type, payload) => { if (type === 'finish') finished = payload.summary; };
  advanceTo(engine, engine.notes[0].hitTime + RHYTHM_RULES.missAfter + 0.05, state);
  assert.equal(engine.notes[0].state, 'missed');
  assert.equal(engine.counts.miss, 1);
  assert.ok(engine.health < 100);
  advanceTo(engine, engine.endTime + 1, state);
  assert.equal(engine.status, 'finished');
  assert.equal(finished.outcome, 'failed');
  assert.equal(finished.rank, 'F');

  const perfectRun = create({ level: 1 });
  const runState = { ms: 0 };
  perfectRun.input('a', runState.ms);
  let summary = null;
  perfectRun.onEvent = (type, payload) => { if (type === 'finish') summary = payload.summary; };
  for (const note of perfectRun.notes) playNote(perfectRun, note, 0, runState);
  advanceTo(perfectRun, perfectRun.endTime + 0.1, runState);
  assert.equal(summary.outcome, 'cleared');
  assert.equal(summary.rank, 'S');
  assert.equal(summary.judgements.perfect, perfectRun.notes.length);
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
