import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine, SOUND_NAMES } from '../public/js/audio.js';
import { BgmEngine } from '../public/js/bgm.js';
import { SONGS, songSeconds, expandForm } from '../public/js/songs.js';

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

test('BGM 3곡: 모두 2분 넘는 곡 구성, 곡 전체를 오류 없이 끝까지 연주하고 루프한다', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 1;
  try {
    const sound = new SoundEngine();
    const bgm = new BgmEngine(sound);
    const tempos = new Set();
    for (const [name, song] of Object.entries(SONGS)) {
      tempos.add(song.tempo);
      assert.ok(songSeconds(song) >= 130, `${name}: ${songSeconds(song).toFixed(0)}초`);
      const sectionNames = new Set(expandForm(song).map(bar => bar.name));
      assert.ok(sectionNames.size >= 7, `${name}: 섹션 ${sectionNames.size}종`);
      assert.ok(song.form.some(entry => typeof entry === 'object' && entry.transpose), `${name}: 전조 후렴`);
      bgm.play(name, { force: true });
      const visited = new Set();
      const before = stats.oscillators + stats.noises;
      const seconds = songSeconds(song) + 4;
      for (let tick = 0; tick < seconds / 0.025; tick++) {
        sound.context.currentTime += 0.025;
        bgm.schedule();
        visited.add(bgm.position().section);
      }
      assert.deepEqual([...visited].sort(), [...sectionNames].sort(), `${name}: 모든 섹션 연주`);
      assert.ok(bgm.position().barIndex < 8, `${name}: 끝나면 처음 부근으로 루프`);
      assert.ok(stats.oscillators + stats.noises - before > 2000, `${name}: 음 수`);
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
      bgm.play('battery', { force: true });
      bgm.setIntensity(intensity);
      const before = stats.oscillators + stats.noises;
      for (let tick = 0; tick < 1200; tick++) { sound.context.currentTime += 0.025; bgm.schedule(); }
      return stats.oscillators + stats.noises - before;
    };
    const calm = countFor(0);
    const intense = countFor(2);
    assert.ok(intense > calm * 1.15, `${calm} → ${intense}`);
    assert.deepEqual(stats.errors, []);
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete globalThis.AudioContext;
  }
});
