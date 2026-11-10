import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine, SOUND_NAMES } from '../public/js/audio.js';
import { BgmEngine, TRACKS } from '../public/js/bgm.js';

// 실제 Web Audio 규칙을 흉내 내는 가짜: 지수 램프 목표가 0 이하면 예외, stop이 start보다 빠르면 예외.
function createFakeAudio() {
  const stats = { oscillators: 0, noises: 0, errors: [] };
  const param = initial => ({
    value: initial,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value, time) {
      if (!(value > 0)) { stats.errors.push(`exponential ramp to ${value}`); throw new RangeError('ramp target must be > 0'); }
      if (!Number.isFinite(time)) throw new TypeError('bad time');
      this.value = value;
    },
    linearRampToValueAtTime(value) { this.value = value; },
    cancelScheduledValues() {}
  });
  const node = extra => ({ connect(target) { return target; }, disconnect() {}, ...extra });
  const scheduled = (kind) => node({
    startedAt: null,
    start(time = 0) { this.startedAt = time; stats[kind]++; },
    stop(time) { if (time < this.startedAt) { stats.errors.push('stop before start'); throw new RangeError('stop before start'); } }
  });
  class FakeContext {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
    createGain() { return node({ gain: param(1) }); }
    createDynamicsCompressor() { return node(); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(1000), Q: param(1) }); }
    createOscillator() { return Object.assign(scheduled('oscillators'), { type: 'sine', frequency: param(440), detune: param(0) }); }
    createBufferSource() { return Object.assign(scheduled('noises'), { buffer: null }); }
    createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    resume() { return Promise.resolve(); }
  }
  return { FakeContext, stats };
}

test('모든 효과음이 오류 없이 소리를 예약한다', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  try {
    const sound = new SoundEngine();
    for (const name of SOUND_NAMES) {
      const before = stats.oscillators + stats.noises;
      sound.play(name, { combo: 7, tier: 2, remainingSeconds: 1, type: 'tank' });
      assert.ok(stats.oscillators + stats.noises > before, `${name}: 예약된 소리 없음`);
    }
    assert.deepEqual(stats.errors, []);
    assert.ok(SOUND_NAMES.length >= 25, `효과음 ${SOUND_NAMES.length}개`);
    sound.setEnabled(false);
    const before = stats.oscillators;
    sound.play('key');
    assert.equal(stats.oscillators, before, '꺼져 있으면 무음');
  } finally {
    delete globalThis.AudioContext;
  }
});

test('BGM 3곡: 모든 층(intensity 0~2)이 오류 없이 마디를 예약하고, 곡마다 템포가 다르다', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 1;
  try {
    const sound = new SoundEngine();
    const bgm = new BgmEngine(sound);
    const tempos = new Set();
    for (const name of Object.keys(TRACKS)) {
      tempos.add(TRACKS[name].tempo);
      for (const intensity of [0, 1, 2]) {
        bgm.play(name, { force: true });
        bgm.setIntensity(intensity, { tempoBoost: intensity === 2 ? 1.12 : 1, power: intensity > 0 });
        const before = stats.oscillators + stats.noises;
        // 가짜 시계를 4마디만큼 진행시키며 스케줄러 실행
        for (let tick = 0; tick < 400; tick++) {
          sound.context.currentTime += 0.025;
          bgm.schedule();
        }
        assert.ok(stats.oscillators + stats.noises - before > 40, `${name}@${intensity}: 음이 너무 적음`);
        assert.ok(bgm.bar >= 2, `${name}: 마디 진행`);
      }
    }
    assert.equal(tempos.size, 3, '모드마다 다른 템포');
    assert.deepEqual(stats.errors, []);
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete globalThis.AudioContext;
  }
});

test('BGM은 강도가 높을수록 더 많은 음을 낸다 (층 추가)', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 1;
  try {
    const sound = new SoundEngine();
    const bgm = new BgmEngine(sound);
    const countFor = intensity => {
      bgm.play('throw', { force: true });
      bgm.setIntensity(intensity);
      const before = stats.oscillators + stats.noises;
      for (let tick = 0; tick < 200; tick++) { sound.context.currentTime += 0.025; bgm.schedule(); }
      return stats.oscillators + stats.noises - before;
    };
    const calm = countFor(0);
    const intense = countFor(2);
    assert.ok(intense > calm * 1.15, `${calm} → ${intense}`);
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete globalThis.AudioContext;
  }
});
