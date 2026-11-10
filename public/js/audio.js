// Web Audio로 직접 합성하는 효과음. 외부 오디오 파일이 없어 로딩 지연·라이선스 문제가 없다.
// 모든 소리는 master gain → compressor를 거쳐 겹쳐도 클리핑되지 않는다.

const PENTATONIC_STEPS = [0, 2, 4, 7, 9];
const COMBO_BASE_FREQUENCY = 523.25; // C5
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
      const compressor = context.createDynamicsCompressor();
      const master = context.createGain();
      master.gain.value = this.volume;
      master.connect(compressor);
      compressor.connect(context.destination);
      this.context = context;
      this.master = master;
      this.noiseBuffer = this.createNoiseBuffer(context, 0.5);
      return context;
    } catch (error) {
      return null;
    }
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

  envelope(context, startTime, peak, attack, decay) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);
    gain.connect(this.master);
    return gain;
  }

  tone(context, { frequency, startTime, peak, decay, waveform = 'sine', attack = 0.004, filter = null, sweepTo = null }) {
    const oscillator = context.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (sweepTo) oscillator.frequency.exponentialRampToValueAtTime(sweepTo, startTime + attack + decay);
    const output = this.envelope(context, startTime, peak, attack, decay);
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

  noise(context, { startTime, peak, decay, filterType, frequency, q = 1, attack = 0.002, sweepTo = null }) {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, startTime);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, startTime + attack + decay);
    filter.Q.value = q;
    source.connect(filter);
    filter.connect(this.envelope(context, startTime, peak, attack, decay));
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

function comboFrequency(combo) {
  const step = Math.max(0, combo - 1) % (PENTATONIC_STEPS.length * 2);
  const semitones = PENTATONIC_STEPS[step % PENTATONIC_STEPS.length] + 12 * Math.floor(step / PENTATONIC_STEPS.length);
  return COMBO_BASE_FREQUENCY * 2 ** (semitones / 12);
}

const SOUNDS = {
  // 맞는 키: 청축(클리키). 높고 쨍한 '찰칵' → 가벼운 바닥 소리 → 올라올 때 작은 '찰칵' 한 번 더.
  // 매 타마다 음높이·세기를 ±8% 흔들어 같은 소리 반복을 피한다. 노드 7개, O(1)
  key(engine, context, time) {
    const vary = () => 0.92 + Math.random() * 0.16;
    engine.noise(context, { startTime: time, peak: 0.1 * vary(), attack: 0.0004, decay: 0.005, filterType: 'bandpass', frequency: 6800 * vary(), q: 2.6 });
    engine.tone(context, { frequency: 5200 * vary(), startTime: time, peak: 0.03, attack: 0.0004, decay: 0.0035, waveform: 'square' });
    const bottom = time + 0.01;
    engine.noise(context, { startTime: bottom, peak: 0.04, attack: 0.0008, decay: 0.014, filterType: 'bandpass', frequency: 2800 * vary(), q: 1 });
    engine.tone(context, { frequency: 420 * vary(), sweepTo: 300, startTime: bottom, peak: 0.03, attack: 0.0008, decay: 0.02 });
    const release = time + 0.07 + Math.random() * 0.025;
    engine.noise(context, { startTime: release, peak: 0.05 * vary(), attack: 0.0004, decay: 0.004, filterType: 'bandpass', frequency: 6000 * vary(), q: 2.4 });
    engine.tone(context, { frequency: 4600 * vary(), startTime: release, peak: 0.014, attack: 0.0004, decay: 0.003, waveform: 'square' });
  },
  // 틀린 키: 적축(리니어). 클릭 없이 낮고 둥글게 '둔' — 저역 울림을 길게 남겨 묵직하게. 노드 3개, O(1)
  keyWrong(engine, context, time) {
    const vary = () => 0.94 + Math.random() * 0.12;
    engine.tone(context, { frequency: 105 * vary(), sweepTo: 58, startTime: time, peak: 0.15, attack: 0.003, decay: 0.09 });
    engine.tone(context, { frequency: 210 * vary(), sweepTo: 120, startTime: time, peak: 0.035, attack: 0.003, decay: 0.05, waveform: 'triangle', filter: { type: 'lowpass', frequency: 500 } });
    engine.noise(context, { startTime: time, peak: 0.06, attack: 0.003, decay: 0.035, filterType: 'lowpass', frequency: 380 * vary(), q: 0.5 });
  },
  // 지우기: 같은 키보드의 넓은 키(Backspace) — 더 낮고 묵직하게, 스태빌라이저 '덜컥'
  erase(engine, context, time) {
    engine.tone(context, { frequency: 120, sweepTo: 70, startTime: time, peak: 0.1, attack: 0.001, decay: 0.06 });
    engine.noise(context, { startTime: time, peak: 0.07, attack: 0.001, decay: 0.03, filterType: 'lowpass', frequency: 800, q: 0.7 });
    engine.noise(context, { startTime: time + 0.012, peak: 0.025, attack: 0.001, decay: 0.015, filterType: 'bandpass', frequency: 1500, q: 1.5 });
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
  finish(engine, context, time) {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.09, peak: 0.07, decay: 0.32, waveform: 'triangle' });
    });
  }
};

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
