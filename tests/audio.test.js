import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine, SOUND_NAMES, keyPan } from '../public/js/audio.js';
import { LINEAR_SPRITE } from '../public/js/key-samples.js';
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
    createBufferSource() { return Object.assign(scheduled('noises'), { buffer: null, playbackRate: param(1) }); }
    createConvolver() { stats.convolvers = (stats.convolvers ?? 0) + 1; return node({ buffer: null }); }
    createStereoPanner() { const panner = node({ pan: param(0) }); stats.pans = [...(stats.pans ?? []), panner.pan]; return panner; }
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

test('로봇 명중음: 종류·무기·남은 체력마다 오류 없이 울리고, 버티는 로봇은 장갑 소리가 더해진다', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  try {
    const sound = new SoundEngine();
    const count = options => {
      const before = stats.oscillators + stats.noises;
      sound.play('robotHit', options);
      return stats.oscillators + stats.noises - before;
    };
    for (const type of ['basic', 'fast', 'tank', 'unknown']) {
      for (const weapon of ['phone', 'laptop']) assert.ok(count({ type, weapon, remainingHp: 0 }) >= 4, `${type}/${weapon}`);
    }
    assert.equal(count({ type: 'tank', remainingHp: 2 }), count({ type: 'tank', remainingHp: 0 }) + 2, '버티면 장갑 "땡" 두 음이 더해짐');
    assert.ok(count() > 0, '옵션 없이도 울림');
    for (const combo of [0, 1, 7, 40]) assert.ok(count({ combo }) > 0, `combo ${combo}`);
    const kill = options => {
      const before = stats.oscillators + stats.noises;
      sound.play('robotKill', options);
      return stats.oscillators + stats.noises - before;
    };
    const [one, two, three] = [0, 1, 2].map(tier => kill({ tier }));
    assert.ok(one < two && two < three, `단계마다 음이 늘어남: ${one} < ${two} < ${three}`);
    assert.equal(kill({ tier: 9 }), three, '범위 밖 단계는 3단계로');
    assert.equal(kill({ tier: -1 }), one, '음수 단계는 1단계로');
    assert.deepEqual(stats.errors, []);
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

test('키 소리 좌우 위치: 왼손 키는 왼쪽, 오른손 키는 오른쪽, 공백·알 수 없는 글자는 가운데', () => {
  assert.ok(keyPan('q') < -0.3 && keyPan('a') < -0.3 && keyPan('`') < -0.4);
  assert.ok(keyPan('p') > 0.25 && keyPan('l') > 0.2 && keyPan('/') > 0.2);
  assert.equal(keyPan('Q'), keyPan('q'), 'Shift 글자도 같은 자리');
  assert.equal(keyPan('{'), keyPan('['));
  assert.equal(keyPan(' '), 0);
  assert.equal(keyPan(undefined), 0);
  for (const character of '`1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./') {
    assert.ok(Math.abs(keyPan(character)) <= 0.55 + 1e-9, `${character} 범위`);
  }
});

test('키 소리는 방 울림 버스(Convolver)와 좌우 패너를 쓰고, 미지원 브라우저에서도 소리가 난다', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  try {
    const sound = new SoundEngine();
    sound.play('key', { character: 'q' });
    sound.play('keyWrong', { character: 'p' });
    assert.equal(stats.convolvers, 1, '방 울림은 한 번만 생성');
    assert.ok(stats.pans[0].value < 0 && stats.pans[1].value > 0, 'q 왼쪽, p 오른쪽');
  } finally {
    delete globalThis.AudioContext;
  }
  const bare = createFakeAudio();
  globalThis.AudioContext = class extends bare.FakeContext {
    constructor() { super(); this.createConvolver = undefined; this.createStereoPanner = undefined; }
  };
  try {
    const sound = new SoundEngine();
    sound.play('key', { character: 'a' });
    assert.ok(bare.stats.oscillators > 0 && bare.stats.noises > 0, '울림·패너 없이도 재생');
    assert.deepEqual(bare.stats.errors, []);
  } finally {
    delete globalThis.AudioContext;
  }
});

test('적축 녹음: 샘플이 준비되면 누름+올라옴 두 클립을 재생하고, 같은 클립을 연달아 쓰지 않는다', () => {
  const { FakeContext, stats } = createFakeAudio();
  globalThis.AudioContext = FakeContext;
  try {
    const sound = new SoundEngine();
    sound.ensureContext();
    sound.linearBuffer = { duration: 3 };
    const starts = [];
    const original = sound.context.createBufferSource.bind(sound.context);
    sound.context.createBufferSource = () => {
      const source = original();
      const start = source.start.bind(source);
      source.start = (time, offset, duration) => { starts.push({ time, offset, duration }); start(time); };
      return source;
    };
    const oscillatorsBefore = stats.oscillators;
    sound.play('keyWrong', { character: 'a' });
    assert.equal(starts.length, 2, '누름 + 올라옴');
    assert.ok(starts[1].time - starts[0].time >= 0.07, '올라오는 소리는 70ms 이상 뒤');
    assert.equal(stats.oscillators, oscillatorsBefore, '샘플이 있으면 합성음 없음');
    const downOffsets = LINEAR_SPRITE.down.map(([offset]) => offset);
    assert.ok(downOffsets.includes(starts[0].offset));
    let previous = sound.lastClip.down;
    for (let round = 0; round < 40; round++) {
      sound.play('keyWrong', { character: 'k' });
      assert.notEqual(sound.lastClip.down, previous, '직전 클립 반복 없음');
      previous = sound.lastClip.down;
    }
    sound.play('erase');
    assert.ok(LINEAR_SPRITE.eraseDown.some(([offset]) => offset === starts.at(-2).offset), 'Backspace 녹음');
    assert.deepEqual(stats.errors, []);
  } finally {
    delete globalThis.AudioContext;
  }
});

test('스프라이트 오프셋은 겹치지 않고 그룹마다 클립이 있다', () => {
  const all = Object.values(LINEAR_SPRITE).flat().sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < all.length; index++) assert.ok(all[index][0] >= all[index - 1][0] + all[index - 1][1]);
  for (const group of ['down', 'up', 'eraseDown', 'eraseUp']) assert.ok(LINEAR_SPRITE[group].length >= 3, group);
});
