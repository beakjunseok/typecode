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

  noise(context, { startTime, peak, decay, filterType, frequency, q = 1, attack = 0.002 }) {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
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
  // 기계식 키보드 느낌: 밴드패스 노이즈 + 아주 짧은 고음. 매번 음색을 조금씩 흔들어 단조로움을 피한다.
  key(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.09, decay: 0.022, filterType: 'bandpass', frequency: 3200 + Math.random() * 1400, q: 1.4 });
    engine.tone(context, { frequency: 1900 + Math.random() * 300, startTime: time, peak: 0.012, decay: 0.012, waveform: 'square' });
  },
  // 지우기: 키 소리보다 낮고 둔하게
  erase(engine, context, time) {
    engine.noise(context, { startTime: time, peak: 0.06, decay: 0.03, filterType: 'bandpass', frequency: 1400, q: 1.2 });
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
    engine.tone(context, { frequency: 98, startTime: time, peak: 0.08, decay: 0.15, waveform: 'sawtooth', filter });
    engine.tone(context, { frequency: 104, startTime: time, peak: 0.08, decay: 0.15, waveform: 'sawtooth', filter });
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
  // 종료: 상행 아르페지오
  finish(engine, context, time) {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      engine.tone(context, { frequency, startTime: time + index * 0.09, peak: 0.07, decay: 0.32, waveform: 'triangle' });
    });
  }
};

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
