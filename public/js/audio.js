// Web Audio 효과음. 대부분 직접 합성하고, 적축 키·Backspace만 실제 녹음 스프라이트(/sounds/linear.wav, MIT)를 쓴다.
// 효과음·BGM은 master → compressor, 키 소리는 따로 keyOut → limiter로 보내 BGM이 키 소리를 눌러 작게 만들지 않게 한다.
import { LINEAR_SPRITE, LINEAR_SPRITE_URL } from './key-samples.js';

const PENTATONIC_STEPS = [0, 2, 4, 7, 9];
// 키 소리(청축·적축) 크기 배율: 다른 효과음보다 자주 나오지만 손맛이 묻히지 않게 키운다
const KEY_VOLUME = 1.8;
// 키 전용 출력 크기(master 대비 약 +2 dB). BGM 압축기를 거치지 않으므로 이 값이 곧 체감 크기다
const KEY_OUTPUT_BOOST = 1.25;
// 녹음 샘플 재생 변화: 매 타 ±18 cents, ±2 dB (같은 소리 반복감 줄이기)
const SAMPLE_CENTS = 18;
const SAMPLE_DECIBELS = 2;
// 크기 맞춤(실측): 녹음 적축이 합성 청축보다 15 dB 크게 들어와서, 청축은 +11 dB, 적축 녹음은 −4 dB로 맞춘다
const CLICKY_BOOST = 3.5;
const LINEAR_DOWN_GAIN = 0.39;
const LINEAR_UP_GAIN = 0.57;
// 키 소리 공간감: 짧은 방 울림(책상 위 키보드)과 좌우 위치. 울림 길이는 짧게 잡아 잔향이 타이핑을 뭉개지 않게 한다
const ROOM_SECONDS = 0.32;
const KEY_PAN_WIDTH = 0.55;
const KEYBOARD_ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
const SHIFTED_ROWS = ['~!@#$%^&*()_+', 'QWERTYUIOP{}|', 'ASDFGHJKL:"', 'ZXCVBNM<>?'];

function setParam(param, value) {
  if (param && typeof param === 'object' && 'value' in param) param.value = value;
}

// decodeAudioData: 최신 브라우저는 Promise, 구형 Safari는 콜백만 지원 → 둘 다 처리
function decodeAudio(context, data) {
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(data, resolve, reject);
    if (result && typeof result.then === 'function') result.then(resolve, reject);
  });
}

// 글자 → 좌우 위치(-1 왼쪽 ~ 1 오른쪽). 실제 키보드 열 위치를 따른다. 행 길이 합 상수라 O(1)
export function keyPan(character) {
  if (typeof character !== 'string' || character.length !== 1 || character === ' ') return 0;
  for (const rows of [KEYBOARD_ROWS, SHIFTED_ROWS]) {
    for (let row = 0; row < rows.length; row++) {
      const column = rows[row].indexOf(character);
      if (column === -1) continue;
      const offset = row * 0.25;
      const position = Math.min(1, (column + offset) / (KEYBOARD_ROWS[0].length - 1));
      return (position * 2 - 1) * KEY_PAN_WIDTH;
    }
  }
  return 0;
}
const COMBO_BASE_FREQUENCY = 523.25; // C5
// 로봇 종류별 몸통 층(시작음·저음은 공통, 몸통만 바꿔 종류를 구분): body '퍽' 시작음(Hz), buzz 떨림(Hz), length 몸통 길이(초)
const ROBOT_HIT_BODIES = Object.freeze({
  basic: Object.freeze({ body: 620, buzz: 45, length: 0.09 }),
  fast: Object.freeze({ body: 760, buzz: 60, length: 0.06 }),
  tank: Object.freeze({ body: 430, buzz: 32, length: 0.14 })
});

const BELL_PARTIALS = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.76, gain: 0.5, decay: 0.6 },
  { ratio: 5.4, gain: 0.28, decay: 0.38 },
  { ratio: 8.93, gain: 0.14, decay: 0.24 }
];

export class SoundEngine {
  constructor({ volume = 0.7 } = {}) {
    this.enabled = true;
    this.volume = volume;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  // 첫 사용자 입력 이후에만 생성된다(브라우저 자동재생 정책). 실패하면 무음으로 동작.
  ensureContext() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      return this.context;
    }
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      const context = new AudioContextClass();
      this.setupGraph(context);
      this.loadSamples();
      return context;
    } catch (error) {
      return null;
    }
  }

  // 출력 그래프: 효과음·BGM(master → compressor)과 키 소리(keyOut → limiter)를 나눈다. 렌더링 테스트에서도 그대로 쓴다
  setupGraph(context) {
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    master.gain.value = this.volume;
    master.connect(compressor);
    compressor.connect(context.destination);
    const keyOut = context.createGain();
    keyOut.gain.value = this.volume * KEY_OUTPUT_BOOST;
    const limiter = context.createDynamicsCompressor();
    setParam(limiter.threshold, -6);
    setParam(limiter.knee, 4);
    setParam(limiter.ratio, 10);
    setParam(limiter.attack, 0.001);
    setParam(limiter.release, 0.06);
    keyOut.connect(limiter);
    limiter.connect(context.destination);
    this.context = context;
    this.master = master;
    this.keyOut = keyOut;
    this.noiseBuffer = this.createNoiseBuffer(context, 0.5);
    this.room = this.createRoom(context, keyOut);
  }

  // 적축 녹음 스프라이트를 한 번만 받아 디코딩. 실패하거나 아직이면 합성음으로 대신한다(소리는 항상 난다)
  loadSamples() {
    if (this.samplesReady || typeof globalThis.fetch !== 'function') return this.samplesReady ?? Promise.resolve(null);
    const context = this.context;
    this.samplesReady = globalThis.fetch(LINEAR_SPRITE_URL)
      .then(response => {
        if (!response.ok) throw new Error(`sprite ${response.status}`);
        return response.arrayBuffer();
      })
      .then(data => decodeAudio(context, data))
      .then(buffer => {
        this.linearBuffer = buffer;
        return buffer;
      })
      .catch(() => null);
    return this.samplesReady;
  }

  // 스프라이트의 group(down/up/eraseDown/eraseUp)에서 직전과 다른 클립 하나를 골라 재생. O(1)
  playSample(context, time, group, { destination, gain = 1 }) {
    const clips = LINEAR_SPRITE[group];
    if (!this.linearBuffer || !clips?.length) return false;
    this.lastClip ??= {};
    let index = Math.floor(Math.random() * clips.length);
    if (clips.length > 1 && index === this.lastClip[group]) index = (index + 1) % clips.length;
    this.lastClip[group] = index;
    const [offset, duration] = clips[index];
    const source = context.createBufferSource();
    source.buffer = this.linearBuffer;
    source.playbackRate.value = 2 ** (((Math.random() * 2 - 1) * SAMPLE_CENTS) / 1200);
    const level = context.createGain();
    level.gain.value = gain * 10 ** (((Math.random() * 2 - 1) * SAMPLE_DECIBELS) / 20);
    source.connect(level);
    level.connect(destination);
    source.start(time, offset, duration);
    return true;
  }

  // 짧은 방 울림 버스(Convolver). 지원하지 않는 브라우저면 null → 울림 없이 동작
  createRoom(context, destination) {
    if (typeof context.createConvolver !== 'function') return null;
    try {
      const convolver = context.createConvolver();
      convolver.buffer = this.createRoomImpulse(context, ROOM_SECONDS);
      const returnGain = context.createGain();
      returnGain.gain.value = 1;
      convolver.connect(returnGain);
      returnGain.connect(destination);
      return convolver;
    } catch (error) {
      return null;
    }
  }

  // 스테레오 임펄스: 좌우가 조금씩 다른 초기 반사 몇 개 + 지수 감쇠 잡음(고역은 빨리 사라지게 1차 저역통과). 길이 n 샘플, O(n)
  createRoomImpulse(context, seconds) {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const impulse = context.createBuffer(2, length, context.sampleRate);
    const reflections = [[0.006, 0.5], [0.013, 0.35], [0.021, 0.25], [0.034, 0.18]];
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      let smoothed = 0;
      for (let index = 0; index < length; index++) {
        const progress = index / length;
        smoothed += ((Math.random() * 2 - 1) - smoothed) * (0.55 - progress * 0.4);
        samples[index] = smoothed * Math.pow(1 - progress, 3) * 0.35;
      }
      for (const [delay, gain] of reflections) {
        const index = Math.floor((delay + channel * 0.0023) * context.sampleRate);
        if (index < length) samples[index] += gain * (channel ? -1 : 1);
      }
    }
    return impulse;
  }

  // 키 한 번의 소리 버스: 좌우 위치(pan) + 방 울림 보내기(wet). 모든 레이어가 이 버스로 모인다
  keyBus(context, { pan = 0, wet = 0.15 } = {}) {
    const input = context.createGain();
    let output = input;
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      input.connect(panner);
      output = panner;
    }
    output.connect(this.keyOut ?? this.master);
    if (this.room && wet > 0) {
      const send = context.createGain();
      send.gain.value = wet;
      output.connect(send);
      send.connect(this.room);
    }
    return input;
  }

  // 적축 녹음: 키 위치대로 좌우에 놓고, 누르는 소리 → 사람 손 속도만큼 뒤에 올라오는 소리. 로딩 전이면 false
  playLinear(context, time, character, { down, up, wet, level = 1 }) {
    if (!this.linearBuffer) return false;
    const pan = character === '\b' ? KEY_PAN_WIDTH : keyPan(character);
    const destination = this.keyBus(context, { pan, wet });
    this.playSample(context, time, down, { destination, gain: LINEAR_DOWN_GAIN * level });
    this.playSample(context, time + 0.07 + Math.random() * 0.035, up, { destination, gain: LINEAR_UP_GAIN * level });
    return true;
  }

  createNoiseBuffer(context, seconds) {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
    return buffer;
  }

  // 소리 이름으로 재생. 어떤 실패도 게임을 멈추지 않는다.
  play(soundName, options = {}) {
    if (!this.enabled) return;
    const context = this.ensureContext();
    const sound = SOUNDS[soundName];
    if (!context || !sound) return;
    try {
      sound(this, context, context.currentTime, options);
    } catch (error) {
      /* 효과음 실패는 무시 */
    }
  }

  envelope(context, startTime, peak, attack, decay, destination = this.master) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);
    gain.connect(destination);
    return gain;
  }

  tone(context, { frequency, startTime, peak, decay, waveform = 'sine', attack = 0.004, filter = null, sweepTo = null, destination }) {
    const oscillator = context.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (sweepTo) oscillator.frequency.exponentialRampToValueAtTime(sweepTo, startTime + attack + decay);
    const output = this.envelope(context, startTime, peak, attack, decay, destination);
    if (filter) {
      const biquad = context.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = filter.frequency;
      oscillator.connect(biquad);
      biquad.connect(output);
    } else {
      oscillator.connect(output);
    }
    oscillator.start(startTime);
    oscillator.stop(startTime + attack + decay + 0.02);
  }

  noise(context, { startTime, peak, decay, filterType, frequency, q = 1, attack = 0.002, sweepTo = null, destination }) {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, startTime);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, startTime + attack + decay);
    filter.Q.value = q;
    source.connect(filter);
    filter.connect(this.envelope(context, startTime, peak, attack, decay, destination));
    source.start(startTime, Math.random() * 0.3);
    source.stop(startTime + attack + decay + 0.02);
  }

  // 비조화 배음으로 만든 금속성 종소리
  bell(context, { frequency, startTime, peak, length }) {
    for (const partial of BELL_PARTIALS) {
      this.tone(context, {
        frequency: frequency * partial.ratio, startTime, peak: peak * partial.gain, decay: length * partial.decay, attack: 0.002
      });
    }
  }
}

// 로봇 처치 보상음: 시작음(도·레를 번갈아)에서 올라가다 마지막에 크게 도약해 한 옥타브+5도 위(높은 솔·라)에서 울린다.
// 콤보 배율 단계(×1 / ×1.5 / ×2)마다 사이 음이 늘어난다: '띠리링' → '띠리리링' → '띠리리리링'.
// 꼭대기 음은 세 단계 모두 같아서 단계가 올라도 귀가 아플 만큼 높아지지 않고, 3단계는 반짝임이 조금 더 길다
const ROBOT_REWARD_NOTES = Object.freeze([523.25, 587.33]);
// 음 사이 간격, 사이 음 길이, 꼭대기 음 울림(초)
const ROBOT_REWARD_TIMING = Object.freeze({ gap: 0.075, note: 0.09, ring: 0.65 });
const ROBOT_REWARD_TIERS = Object.freeze([
  Object.freeze({ steps: Object.freeze([1, 1.5, 3]), sparkle: 0.36 }),
  Object.freeze({ steps: Object.freeze([1, 1.26, 1.5, 3]), sparkle: 0.44 }),
  Object.freeze({ steps: Object.freeze([1, 1.26, 1.5, 2, 3]), sparkle: 0.56 })
]);

// 링 변조 음: 음 × 저주파(45Hz 안팎) 사인 → '부르르' 떠는 로봇 질감(sfxr 타격음 계열). 노드 4개, O(1)
function ringTone(engine, context, { frequency, sweepTo, startTime, peak, decay, modFrequency, waveform = 'square', destination }) {
  const carrier = context.createOscillator();
  carrier.type = waveform;
  carrier.frequency.setValueAtTime(frequency, startTime);
  if (sweepTo) carrier.frequency.exponentialRampToValueAtTime(sweepTo, startTime + decay);
  const modulator = context.createOscillator();
  modulator.frequency.setValueAtTime(modFrequency, startTime);
  const ring = context.createGain();
  ring.gain.value = 0;
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  carrier.connect(ring);
  modulator.connect(ring.gain);
  ring.connect(tone);
  tone.connect(engine.envelope(context, startTime, peak, 0.002, decay, destination));
  for (const oscillator of [carrier, modulator]) {
    oscillator.start(startTime);
    oscillator.stop(startTime + decay + 0.03);
  }
}

// 떨림(비브라토) 있는 금관 같은 음: 톱니파 → 저역 통과, 6Hz LFO로 음높이를 흔든다. 패배 '빠밤빠~' 용. 노드 5개, O(1)
function brassTone(engine, context, { frequency, startTime, length, peak, vibrato = 0, slideTo = null }) {
  const oscillator = context.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, startTime + length);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  oscillator.connect(filter);
  filter.connect(engine.envelope(context, startTime, peak, 0.03, length, engine.master));
  const nodes = [oscillator];
  if (vibrato > 0) {
    const lfo = context.createOscillator();
    lfo.frequency.setValueAtTime(6, startTime);
    const depth = context.createGain();
    depth.gain.value = frequency * vibrato;
    lfo.connect(depth);
    depth.connect(oscillator.frequency);
    nodes.push(lfo);
  }
  for (const node of nodes) {
    node.start(startTime);
    node.stop(startTime + length + 0.08);
  }
}

function comboFrequency(combo) {
  const step = Math.max(0, combo - 1) % (PENTATONIC_STEPS.length * 2);
  const semitones = PENTATONIC_STEPS[step % PENTATONIC_STEPS.length] + 12 * Math.floor(step / PENTATONIC_STEPS.length);
  return COMBO_BASE_FREQUENCY * 2 ** (semitones / 12);
}

const SOUNDS = {
  // 맞는 키: 청축(클리키). 높고 쨍한 '찰칵' + 클릭 스프링의 아주 짧은 '칭'(청량감) → 가벼운 바닥 소리 → 올라올 때 '찰칵'.
  // 키 위치대로 좌우에 놓고 짧은 방 울림을 살짝 섞는다. 매 타 ±8% 흔들기. 노드 약 20개, O(1)
  key(engine, context, time, { character } = {}) {
    const vary = () => 0.92 + Math.random() * 0.16;
    const loud = KEY_VOLUME * CLICKY_BOOST;
    const destination = engine.keyBus(context, { pan: keyPan(character), wet: 0.12 });
    const layer = options => ({ destination, attack: 0.0004, ...options });
    engine.noise(context, layer({ startTime: time, peak: 0.1 * loud * vary(), decay: 0.005, filterType: 'bandpass', frequency: 6800 * vary(), q: 2.6 }));
    engine.tone(context, layer({ frequency: 5200 * vary(), startTime: time, peak: 0.03 * loud, decay: 0.0035, waveform: 'square' }));
    engine.tone(context, layer({ frequency: 8400 * vary(), startTime: time + 0.001, peak: 0.016 * loud, decay: 0.035 }));
    engine.noise(context, layer({ startTime: time, peak: 0.025 * loud, decay: 0.012, filterType: 'highpass', frequency: 9500 }));
    const bottom = time + 0.01;
    engine.noise(context, layer({ startTime: bottom, peak: 0.045 * loud, attack: 0.0008, decay: 0.016, filterType: 'bandpass', frequency: 2100 * vary(), q: 1.2 }));
    engine.tone(context, layer({ frequency: 420 * vary(), sweepTo: 300, startTime: bottom, peak: 0.03 * loud, attack: 0.0008, decay: 0.02 }));
    engine.tone(context, layer({ frequency: 210 * vary(), sweepTo: 170, startTime: bottom, peak: 0.022 * loud, attack: 0.0008, decay: 0.024 }));
    const release = time + 0.07 + Math.random() * 0.025;
    engine.noise(context, layer({ startTime: release, peak: 0.05 * loud * vary(), decay: 0.004, filterType: 'bandpass', frequency: 6000 * vary(), q: 2.4 }));
    engine.tone(context, layer({ frequency: 4600 * vary(), startTime: release, peak: 0.014 * loud, decay: 0.003, waveform: 'square' }));
    engine.tone(context, layer({ frequency: 7800 * vary(), startTime: release + 0.001, peak: 0.008 * loud, decay: 0.025 }));
  },
  // 틀린 키: 적축(리니어). 실제 녹음 샘플(누름 + 0.07~0.1초 뒤 올라옴)이 있으면 그것을, 없으면 아래 합성음.
  // 합성음: 클릭 없이 '도각' — 축이 바닥 하우징에 닿는 플라스틱 소리 + 짧은 몸통 울림,
  // 올라올 때 윗 하우징에 닿는 '각'. 방 울림을 청축보다 많이 섞어 입체감을 준다. 저음은 짧게 잘라 노크처럼 안 들리게. O(1)
  keyWrong(engine, context, time, { character } = {}) {
    if (engine.playLinear(context, time, character, { down: 'down', up: 'up', wet: 0.08 })) return;
    const vary = () => 0.93 + Math.random() * 0.14;
    const loud = KEY_VOLUME * CLICKY_BOOST * 0.8;
    const destination = engine.keyBus(context, { pan: keyPan(character), wet: 0.28 });
    const layer = options => ({ destination, attack: 0.0012, ...options });
    engine.noise(context, layer({ startTime: time, peak: 0.075 * loud * vary(), decay: 0.02, filterType: 'bandpass', frequency: 950 * vary(), q: 1.2 }));
    engine.tone(context, layer({ frequency: 540 * vary(), sweepTo: 440, startTime: time, peak: 0.03 * loud, decay: 0.03, waveform: 'triangle' }));
    engine.tone(context, layer({ frequency: 200 * vary(), sweepTo: 160, startTime: time, peak: 0.045 * loud, decay: 0.035 }));
    engine.noise(context, layer({ startTime: time, peak: 0.02 * loud, decay: 0.008, filterType: 'bandpass', frequency: 2600 * vary(), q: 1 }));
    const release = time + 0.07 + Math.random() * 0.02;
    engine.noise(context, layer({ startTime: release, peak: 0.032 * loud * vary(), decay: 0.012, filterType: 'bandpass', frequency: 1450 * vary(), q: 1.4 }));
    engine.tone(context, layer({ frequency: 720 * vary(), startTime: release, peak: 0.012 * loud, decay: 0.014, waveform: 'triangle' }));
  },
  // 지우기: 오른쪽 위 넓은 키(Backspace) — 낮고 묵직하게, 스태빌라이저 '덜컥'
  erase(engine, context, time) {
    if (engine.playLinear(context, time, '\b', { down: 'eraseDown', up: 'eraseUp', wet: 0.06, level: 0.8 })) return;
    const destination = engine.keyBus(context, { pan: KEY_PAN_WIDTH, wet: 0.2 });
    engine.tone(context, { destination, frequency: 120, sweepTo: 70, startTime: time, peak: 0.1, attack: 0.001, decay: 0.06 });
    engine.noise(context, { destination, startTime: time, peak: 0.07, attack: 0.001, decay: 0.03, filterType: 'lowpass', frequency: 800, q: 0.7 });
    engine.noise(context, { destination, startTime: time + 0.012, peak: 0.025, attack: 0.001, decay: 0.015, filterType: 'bandpass', frequency: 1500, q: 1.5 });
  },
  // 토큰 완성: 콤보가 오를수록 펜타토닉 음계를 따라 올라간다
  token(engine, context, time, { combo = 1 }) {
    const frequency = comboFrequency(combo);
    engine.tone(context, { frequency, startTime: time, peak: 0.07, decay: 0.12, waveform: 'triangle' });
    engine.tone(context, { frequency: frequency * 2, startTime: time, peak: 0.02, decay: 0.08 });
  },
  // 오타가 있었던 토큰 완성: 음 상승 없이 짧고 낮게
  tokenDirty(engine, context, time) {
    engine.tone(context, { frequency: 330, startTime: time, peak: 0.04, decay: 0.07, waveform: 'triangle' });
  },
  // 오타: 살짝 어긋난 두 톱니파를 저역 필터로 눌러 '버즈' 느낌
  error(engine, context, time) {
    const filter = { type: 'lowpass', frequency: 750 };
    engine.tone(context, { frequency: 98, startTime: time + 0.02, peak: 0.05, decay: 0.12, waveform: 'sawtooth', filter });
    engine.tone(context, { frequency: 104, startTime: time + 0.02, peak: 0.05, decay: 0.12, waveform: 'sawtooth', filter });
    engine.noise(context, { startTime: time, peak: 0.04, decay: 0.05, filterType: 'lowpass', frequency: 500 });
  },
  // 콤보 10단위: 짧은 메탈릭 핑
  milestone(engine, context, time) {
    engine.bell(context, { frequency: 1318.5, startTime: time, peak: 0.07, length: 0.55 });
  },
  // 배율 단계 상승: 상승 스윕 + 긴 종소리 + 고역 반짝임
  tierUp(engine, context, time, { tier = 1 }) {
    const base = tier >= 2 ? 1174.66 : 880;
    engine.tone(context, { frequency: 420, sweepTo: 1700, startTime: time, peak: 0.05, decay: 0.24, waveform: 'sine' });
    engine.bell(context, { frequency: base, startTime: time + 0.12, peak: 0.09, length: 1.1 });
    engine.noise(context, { startTime: time + 0.12, peak: 0.03, decay: 0.35, filterType: 'highpass', frequency: 6500 });
  },
  // 마지막 5초 경고
  warning(engine, context, time, { remainingSeconds = 5 }) {
    engine.tone(context, { frequency: remainingSeconds === 1 ? 1320 : 990, startTime: time, peak: 0.05, decay: 0.06 });
  },
  // 휴대폰 던지기: 대역 필터가 올라가는 '휙' 소리
  throwPhone(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.08, decay: 0.18, filterType: 'bandpass', frequency: 600, sweepTo: 3200, q: 2 });
  },
  // 노트북 던지기: 더 낮고 무거운 '휘익'
  throwLaptop(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.1, decay: 0.26, filterType: 'bandpass', frequency: 300, sweepTo: 1600, q: 1.5 });
    engine.tone(context, { frequency: 140, sweepTo: 90, startTime: time, peak: 0.05, decay: 0.2, waveform: 'triangle' });
  },
  // 명중: 짧은 금속 충돌음
  hit(engine, context, time) {
    engine.bell(context, { frequency: 520, startTime: time, peak: 0.06, length: 0.18 });
    engine.noise(context, { startTime: time, peak: 0.07, decay: 0.05, filterType: 'highpass', frequency: 2500 });
  },
  // 로봇 명중 — 세 겹(시작음 · 몸통 · 저음), 전체 0.2초 안쪽:
  // ① '톡' 아주 짧은 클릭(대역 잡음 12ms) ② '퍽' 링 변조 사각파가 아래로 미끄러지며 '부르르'(로봇 몸통, 종류마다 다름)
  // ③ '쿵' 사인 저음 110→45Hz(손맛의 대부분). 노트북은 몸통·저음이 더 낮고 세다.
  // 아직 버티는 로봇은 장갑 '땡'(낮은 비조화 두 음)을 더해 '안 죽었다'를 알린다. 매 타 음높이 ±5%·세기 ±10% 흔들기. O(1)
  robotHit(engine, context, time, { type = 'basic', weapon = 'phone', remainingHp = 0 } = {}) {
    const body = ROBOT_HIT_BODIES[type] ?? ROBOT_HIT_BODIES.basic;
    const heavy = weapon === 'laptop';
    const pitch = (0.95 + Math.random() * 0.1) * (heavy ? 0.8 : 1);
    const level = (0.9 + Math.random() * 0.2) * (heavy ? 1.25 : 1);
    engine.noise(context, { startTime: time, peak: 0.05 * level, decay: 0.012, filterType: 'bandpass', frequency: 2600, q: 1 });
    ringTone(engine, context, { frequency: body.body * pitch, sweepTo: body.body * pitch * 0.35, startTime: time, peak: 0.075 * level, decay: body.length, modFrequency: body.buzz });
    engine.tone(context, { frequency: 110 * pitch, sweepTo: 45, startTime: time, peak: 0.14 * level, decay: 0.11, attack: 0.002 });
    if (remainingHp > 0) {
      engine.tone(context, { frequency: 540 * pitch, startTime: time + 0.01, peak: 0.03, decay: 0.12, attack: 0.001 });
      engine.tone(context, { frequency: 860 * pitch, startTime: time + 0.01, peak: 0.018, decay: 0.08, attack: 0.001 });
    }
  },
  // 로봇 처치 — 명중음 바로 뒤에 이어지는 0.45초: 저음 '쿵'(80→40Hz) + 필터가 닫히는 잡음 '콰광' + 팝콘처럼 튀는 '타닥' 3번
  // + 보상음(콤보 배율 단계마다 '띠리링' → '띠리리링' → '띠리리리링'). O(1)
  robotKill(engine, context, time, { type = 'basic', combo = 1, tier = 0, withReward = true } = {}) {
    const big = type === 'tank' ? 1.3 : 1;
    engine.tone(context, { frequency: 80, sweepTo: 40, startTime: time, peak: 0.13 * big, decay: 0.2 * big, attack: 0.003 });
    engine.noise(context, { startTime: time, peak: 0.12 * big, decay: 0.32 * big, filterType: 'lowpass', frequency: 2200, sweepTo: 150 });
    for (let index = 0; index < 3; index++) {
      engine.noise(context, { startTime: time + 0.05 + index * 0.045 + Math.random() * 0.02, peak: 0.05, decay: 0.018, filterType: 'bandpass', frequency: 1200 + Math.random() * 600, q: 2 });
    }
    if (!withReward) return;
    const note = ROBOT_REWARD_NOTES[Math.max(0, combo - 1) % ROBOT_REWARD_NOTES.length];
    const reward = ROBOT_REWARD_TIERS[Math.max(0, Math.min(ROBOT_REWARD_TIERS.length - 1, Math.floor(tier) || 0))];
    const steps = reward.steps;
    const sparkle = { type: 'lowpass', frequency: 3600 };
    steps.forEach((step, index) => {
      const last = index === steps.length - 1;
      const startTime = time + 0.07 + index * ROBOT_REWARD_TIMING.gap;
      engine.tone(context, { frequency: note * step, startTime, peak: 0.05, decay: last ? ROBOT_REWARD_TIMING.ring : ROBOT_REWARD_TIMING.note, waveform: 'triangle' });
      // 꼭대기 음에만 옅은 사각파를 겹쳐 '링' 하고 반짝이게
      if (last) engine.tone(context, { frequency: note * step, startTime, peak: 0.018, decay: reward.sparkle, waveform: 'square', filter: sparkle });
    });
  },
  // 처치: 저역 폭발 + 낮게 떨어지는 톤
  explode(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.16, decay: 0.45, filterType: 'lowpass', frequency: 1400, sweepTo: 120 });
    engine.tone(context, { frequency: 110, sweepTo: 40, startTime: time, peak: 0.1, decay: 0.35, waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 400 } });
  },
  // 아이템 획득: 빠르게 올라가는 사각파 아르페지오
  powerUp(engine, context, time) {
    [523.25, 783.99, 1046.5, 1567.98].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.05, peak: 0.045, decay: 0.12, waveform: 'square', filter: { type: 'lowpass', frequency: 3000 } });
    });
  },
  // 생명 감소: 내려가는 경보음
  lifeLost(engine, context, time) {
    engine.tone(context, { frequency: 440, sweepTo: 110, startTime: time, peak: 0.09, decay: 0.45, waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 1200 } });
    engine.noise(context, { startTime: time, peak: 0.08, decay: 0.2, filterType: 'lowpass', frequency: 600 });
  },
  // 휴대폰 화면 금: 높은 유리 '쩍' + 잔금이 퍼지는 짧은 딸깍 몇 번
  glassCrack(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.12, decay: 0.06, filterType: 'highpass', frequency: 3800 });
    engine.tone(context, { frequency: 2600, sweepTo: 1700, startTime: time, peak: 0.03, decay: 0.08, waveform: 'square' });
    for (let index = 1; index <= 3; index++) {
      engine.noise(context, { startTime: time + index * 0.035, peak: 0.05 / index, decay: 0.02, filterType: 'bandpass', frequency: 5200 - index * 600, q: 3 });
    }
  },
  // 패치 튜브 투하: '퐁' 하는 물소리
  splash(engine, context, time) {
    engine.tone(context, { frequency: 520, sweepTo: 1300, startTime: time, peak: 0.07, decay: 0.12 });
    engine.noise(context, { startTime: time + 0.05, peak: 0.06, decay: 0.2, filterType: 'bandpass', frequency: 900, sweepTo: 300 });
  },
  // 구조 성공: 밝은 두 음
  rescued(engine, context, time) {
    engine.tone(context, { frequency: 783.99, startTime: time, peak: 0.06, decay: 0.12, waveform: 'triangle' });
    engine.tone(context, { frequency: 1174.66, startTime: time + 0.08, peak: 0.06, decay: 0.22, waveform: 'triangle' });
  },
  // 가라앉음: 아래로 꺼지는 '꼬르륵'
  sink(engine, context, time) {
    [0, 0.09, 0.18].forEach((offset, index) => {
      engine.tone(context, { frequency: 420 - index * 90, sweepTo: 180 - index * 30, startTime: time + offset, peak: 0.06, decay: 0.1 });
    });
  },
  // 롤백: 거꾸로 감기는 스윕 + 종소리
  rollback(engine, context, time) {
    engine.tone(context, { frequency: 1800, sweepTo: 300, startTime: time, peak: 0.06, decay: 0.35, waveform: 'triangle' });
    engine.bell(context, { frequency: 659.25, startTime: time + 0.3, peak: 0.07, length: 0.8 });
  },
  // 조준 고정: 아주 짧은 틱
  lock(engine, context, time) {
    engine.tone(context, { frequency: 2600, startTime: time, peak: 0.02, decay: 0.02, waveform: 'square' });
  },
  // 게임 시작: 부팅 차임(두 음 상승 + 반짝임)
  gameStart(engine, context, time) {
    engine.tone(context, { frequency: 392, startTime: time, peak: 0.05, decay: 0.12, waveform: 'triangle' });
    engine.tone(context, { frequency: 784, startTime: time + 0.1, peak: 0.05, decay: 0.25, waveform: 'triangle' });
    engine.noise(context, { startTime: time + 0.1, peak: 0.02, decay: 0.2, filterType: 'highpass', frequency: 7000 });
  },
  // 로봇 등장: 작은 '삐-뽀' (자주 나오므로 아주 작게)
  spawnRobot(engine, context, time, { type = 'basic' }) {
    const base = { basic: 660, fast: 990, tank: 330 }[type] ?? 660;
    engine.tone(context, { frequency: base, startTime: time, peak: 0.016, decay: 0.05, waveform: 'square', filter: { type: 'lowpass', frequency: 2000 } });
    engine.tone(context, { frequency: base * 0.75, startTime: time + 0.06, peak: 0.016, decay: 0.06, waveform: 'square', filter: { type: 'lowpass', frequency: 2000 } });
  },
  // 프로세스 입수: 작은 첨벙
  spawnVictim(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.05, decay: 0.25, filterType: 'bandpass', frequency: 1200, sweepTo: 300, q: 0.8 });
  },
  // 아이템 등장: 반짝이는 3음
  itemSpawn(engine, context, time) {
    [1318.5, 1760, 2093].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.06, peak: 0.025, decay: 0.15 });
    });
  },
  // 아이템 효과 종료: 내려가는 두 음
  powerDown(engine, context, time) {
    engine.tone(context, { frequency: 880, sweepTo: 440, startTime: time, peak: 0.04, decay: 0.25, waveform: 'triangle' });
  },
  // 게임 오버: 단조 하행
  gameOver(engine, context, time) {
    [440, 392, 349.23, 293.66].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.18, peak: 0.07, decay: 0.4, waveform: 'triangle' });
    });
    engine.tone(context, { frequency: 146.83, startTime: time + 0.72, peak: 0.08, decay: 0.9, waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 600 } });
  },
  // 주간 1위: 팡파르
  newRecord(engine, context, time) {
    [523.25, 523.25, 523.25, 698.46, 880, 1046.5].forEach((frequency, index) => {
      const offset = [0, 0.1, 0.2, 0.32, 0.5, 0.68][index];
      engine.tone(context, { frequency, startTime: time + offset, peak: 0.06, decay: index === 5 ? 0.7 : 0.12, waveform: 'square', filter: { type: 'lowpass', frequency: 3500 } });
    });
    engine.bell(context, { frequency: 1046.5, startTime: time + 0.68, peak: 0.05, length: 1.2 });
  },
  // 버튼 클릭
  uiClick(engine, context, time) {
    engine.tone(context, { frequency: 1500, startTime: time, peak: 0.02, decay: 0.03, waveform: 'square', filter: { type: 'lowpass', frequency: 4000 } });
  },
  // 종료: 상행 아르페지오
  // 승리(PvP 승리·개인 최고 기록): 쿵 + 도미솔 빠른 상행 → 높은 도 '빠밤!' → 도·미·솔·도 화음이 반짝이며 울린다(약 1.6초)
  victory(engine, context, time) {
    engine.tone(context, { frequency: 110, sweepTo: 50, startTime: time, peak: 0.12, decay: 0.18 });
    const lead = { type: 'lowpass', frequency: 3200 };
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.08, peak: 0.05, decay: 0.09, waveform: 'square', filter: lead });
    });
    engine.tone(context, { frequency: 1046.5, startTime: time + 0.26, peak: 0.06, decay: 0.12, waveform: 'square', filter: lead });
    for (const frequency of [523.25, 659.25, 783.99, 1046.5]) {
      engine.tone(context, { frequency, startTime: time + 0.42, peak: 0.04, decay: 1.1, waveform: 'triangle', attack: 0.01 });
    }
    engine.tone(context, { frequency: 1046.5, startTime: time + 0.42, peak: 0.025, decay: 0.8, waveform: 'square', filter: lead });
    engine.bell(context, { frequency: 1046.5, startTime: time + 0.42, peak: 0.035, length: 1.2 });
  },
  // 패배: 코믹한 '빠-밤-빠-바아암~' — 반음씩 내려가는 금관 세 음, 마지막 음은 길게 떨며 아래로 처진다 + 낮은 쿵(약 2초)
  defeat(engine, context, time) {
    [392, 369.99, 349.23].forEach((frequency, index) => {
      brassTone(engine, context, { frequency, startTime: time + index * 0.32, length: 0.26, peak: 0.07 });
    });
    brassTone(engine, context, { frequency: 329.63, slideTo: 300, startTime: time + 0.96, length: 1, peak: 0.075, vibrato: 0.02 });
    engine.tone(context, { frequency: 82, sweepTo: 40, startTime: time + 0.96, peak: 0.09, decay: 0.4 });
  },
  finish(engine, context, time) {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.09, peak: 0.07, decay: 0.32, waveform: 'triangle' });
    });
  }
};

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
