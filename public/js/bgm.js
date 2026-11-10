// BGM 시퀀서: songs.js의 악보를 Web Audio로 실시간 연주한다(음원 파일 없음).
// 미리 예약(lookahead) 스케줄러로 16분음표 단위를 오디오 시계에 맞춰 예약해 박자가 흔들리지 않는다.
// 게임 상황(intensity 0~2)에 따라 하이햇·옥타브 더블·위기 층을 더하고, 위기 때는 템포를 올린다.
import { SONGS, parseChord, melodyNote, expandForm } from './songs.js';

const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;
const CROSSFADE_SECONDS = 0.8;
const MUSIC_VOLUME = 0.27; // 키 소리가 묻히지 않게 0.34 → 0.27(약 −2 dB)

const midiToFrequency = note => 440 * 2 ** ((note - 69) / 12);

// ---------- 악기: (bgm, time, note, seconds, velocity) ----------
const INSTRUMENTS = {
  pluck(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'triangle', frequency: midiToFrequency(note), time, attack: 0.004, hold: seconds * 0.3, release: seconds * 0.8 + 0.05, peak: 0.085 * velocity, filter: 2600 });
    bgm.voice({ type: 'square', frequency: midiToFrequency(note), time, attack: 0.003, hold: 0.02, release: 0.08, peak: 0.02 * velocity, filter: 3000 });
  },
  bright(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'sawtooth', frequency: midiToFrequency(note), time, attack: 0.01, hold: seconds * 0.7, release: 0.12, peak: 0.05 * velocity, filter: 3200, detune: -6 });
    bgm.voice({ type: 'sawtooth', frequency: midiToFrequency(note), time, attack: 0.01, hold: seconds * 0.7, release: 0.12, peak: 0.05 * velocity, filter: 3200, detune: 6 });
    bgm.voice({ type: 'sine', frequency: midiToFrequency(note + 12), time, attack: 0.01, hold: seconds * 0.5, release: 0.1, peak: 0.025 * velocity });
  },
  bell(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'sine', frequency: midiToFrequency(note + 12), time, attack: 0.003, hold: 0.02, release: Math.min(1.4, seconds + 0.4), peak: 0.07 * velocity });
    bgm.voice({ type: 'triangle', frequency: midiToFrequency(note + 24) * 1.003, time, attack: 0.002, hold: 0.01, release: 0.35, peak: 0.02 * velocity });
  },
  chip(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'square', frequency: midiToFrequency(note + 12), time, attack: 0.002, hold: seconds * 0.8, release: 0.04, peak: 0.045 * velocity, filter: bgm.brightness });
  },
  chipBright(bgm, time, note, seconds, velocity) {
    INSTRUMENTS.chip(bgm, time, note, seconds, velocity);
    bgm.voice({ type: 'square', frequency: midiToFrequency(note + 24) * 1.004, time, attack: 0.002, hold: seconds * 0.6, release: 0.04, peak: 0.018 * velocity, filter: bgm.brightness });
  },
  saw(bgm, time, note, seconds, velocity) {
    for (const detune of [-9, 9]) {
      bgm.voice({ type: 'sawtooth', frequency: midiToFrequency(note + 12), time, attack: 0.006, hold: seconds * 0.6, release: 0.1, peak: 0.038 * velocity, filter: bgm.brightness, detune });
    }
  },
  sawBright(bgm, time, note, seconds, velocity) {
    INSTRUMENTS.saw(bgm, time, note, seconds, velocity);
    bgm.voice({ type: 'square', frequency: midiToFrequency(note + 24), time, attack: 0.006, hold: seconds * 0.5, release: 0.08, peak: 0.016 * velocity, filter: 4000 });
  },
  stab(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'triangle', frequency: midiToFrequency(note), time, attack: 0.004, hold: 0.04, release: 0.16, peak: 0.05 * velocity, filter: 2400 });
  },
  chipStab(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'square', frequency: midiToFrequency(note), time, attack: 0.002, hold: 0.05, release: 0.05, peak: 0.022 * velocity, filter: 2200 });
  },
  pad(bgm, time, note, seconds, velocity) {
    for (const detune of [-8, 8]) {
      bgm.voice({ type: 'sawtooth', frequency: midiToFrequency(note), time, attack: Math.min(0.4, seconds * 0.3), hold: seconds * 0.6, release: 0.5, peak: 0.022 * velocity, filter: 1100, detune });
    }
  },
  arp(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'square', frequency: midiToFrequency(note), time, attack: 0.002, hold: 0.02, release: 0.07, peak: 0.026 * velocity, filter: bgm.brightness * 0.8 });
  },
  bass(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'triangle', frequency: midiToFrequency(note), time, attack: 0.004, hold: seconds * 0.6, release: 0.08, peak: 0.17 * velocity, filter: 1200 });
    bgm.voice({ type: 'square', frequency: midiToFrequency(note), time, attack: 0.004, hold: seconds * 0.4, release: 0.05, peak: 0.03 * velocity, filter: 700 });
  },
  kick(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'sine', frequency: 150, sweepTo: 42, time, attack: 0.002, hold: 0.02, release: 0.22, peak: 0.36 * velocity });
    bgm.noise({ time, release: 0.02, peak: 0.05 * velocity, type: 'lowpass', frequency: 2500 });
  },
  snare(bgm, time, note, seconds, velocity) {
    bgm.noise({ time, release: 0.16, peak: 0.13 * velocity, type: 'bandpass', frequency: 1900 });
    bgm.voice({ type: 'triangle', frequency: 200, sweepTo: 150, time, attack: 0.002, hold: 0.01, release: 0.08, peak: 0.07 * velocity });
  },
  clap(bgm, time, note, seconds, velocity) {
    for (const offset of [0, 0.012, 0.024]) bgm.noise({ time: time + offset, release: 0.08, peak: 0.07 * velocity, type: 'bandpass', frequency: 1300 });
  },
  hat(bgm, time, note, seconds, velocity) {
    bgm.noise({ time, release: 0.035, peak: 0.05 * velocity, type: 'highpass', frequency: 7500 });
  },
  openHat(bgm, time, note, seconds, velocity) {
    bgm.noise({ time, release: 0.18, peak: 0.045 * velocity, type: 'highpass', frequency: 6500 });
  },
  shaker(bgm, time, note, seconds, velocity) {
    bgm.noise({ time, release: 0.03, peak: 0.022 * velocity, type: 'highpass', frequency: 9000 });
  },
  crash(bgm, time, note, seconds, velocity) {
    bgm.noise({ time, release: 1.3, peak: 0.07 * velocity, type: 'highpass', frequency: 5000 });
  },
  ping(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'sine', frequency: midiToFrequency(note), time, attack: 0.004, hold: 0.02, release: 1.4, peak: 0.06 * velocity });
  },
  heartbeat(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'sine', frequency: 70, sweepTo: 40, time, attack: 0.004, hold: 0.02, release: 0.16, peak: 0.3 * velocity });
    bgm.voice({ type: 'sine', frequency: 62, sweepTo: 38, time: time + 0.18, attack: 0.004, hold: 0.02, release: 0.14, peak: 0.22 * velocity });
  },
  alarm(bgm, time, note, seconds, velocity) {
    bgm.voice({ type: 'sawtooth', frequency: midiToFrequency(note), sweepTo: midiToFrequency(note - 5), time, attack: 0.01, hold: 0.08, release: 0.12, peak: 0.026 * velocity, filter: 1700 });
  }
};

const DRUM_PARTS = ['kick', 'snare', 'clap', 'hat', 'openHat', 'shaker'];

// 16칸 패턴에서 각 음의 길이(칸 수)를 '-' 이어짐으로 계산
function noteLengths(pattern) {
  const lengths = new Array(16).fill(0);
  for (let step = 0; step < 16; step++) {
    if (pattern[step] === '-' || pattern[step] === '.') continue;
    let length = 1;
    while (step + length < 16 && pattern[step + length] === '-') length++;
    lengths[step] = length;
  }
  return lengths;
}

export class BgmEngine {
  constructor(sound) {
    this.sound = sound;
    this.enabled = true;
    this.songName = null;
    this.song = null;
    this.bars = [];
    this.bus = null;
    this.intensity = 0;
    this.tempoBoost = 1;
    this.brightness = 2400;
    this.step = 0;
    this.barIndex = 0;
    this.nextStepTime = 0;
    this.timerId = null;
    this.ducked = false;
    this.cache = new Map();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
    else if (this.songName) this.play(this.songName, { force: true });
  }

  // 사용자 입력 이후에 호출해야 소리가 난다(자동재생 정책). 같은 곡이면 이어서, 다른 곡이면 크로스페이드.
  play(songName, { force = false } = {}) {
    this.songName = songName;
    if (!this.enabled || !SONGS[songName]) return;
    const context = this.sound.ensureContext();
    if (!context) return;
    if (!force && this.song === SONGS[songName] && this.timerId) return;
    this.fadeOutBus();
    const bus = context.createGain();
    bus.gain.setValueAtTime(0.0001, context.currentTime);
    bus.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, context.currentTime + CROSSFADE_SECONDS);
    bus.connect(this.sound.master);
    this.bus = bus;
    this.song = SONGS[songName];
    this.bars = expandForm(this.song);
    this.step = 0;
    this.barIndex = 0;
    this.nextStepTime = context.currentTime + 0.05;
    this.ducked = false;
    clearInterval(this.timerId);
    this.timerId = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
  }

  fadeOutBus() {
    const context = this.sound.context;
    if (!this.bus || !context) return;
    const bus = this.bus;
    try {
      bus.gain.cancelScheduledValues(context.currentTime);
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), context.currentTime);
      bus.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + CROSSFADE_SECONDS);
    } catch (error) { /* 무시 */ }
    setTimeout(() => bus.disconnect(), CROSSFADE_SECONDS * 1000 + 100);
    this.bus = null;
  }

  stop() {
    clearInterval(this.timerId);
    this.timerId = null;
    this.fadeOutBus();
    this.song = null;
  }

  duck(ducked) {
    const context = this.sound.context;
    if (!this.bus || !context || this.ducked === ducked) return;
    this.ducked = ducked;
    this.bus.gain.cancelScheduledValues(context.currentTime);
    this.bus.gain.setValueAtTime(Math.max(this.bus.gain.value, 0.0001), context.currentTime);
    this.bus.gain.exponentialRampToValueAtTime(ducked ? MUSIC_VOLUME * 0.3 : MUSIC_VOLUME, context.currentTime + 0.5);
  }

  // intensity 0~2: 층 추가. tempoBoost: 위기 때 템포 상승. power: 아이템 효과 중 필터 개방.
  setIntensity(intensity, { tempoBoost = 1, power = false } = {}) {
    this.intensity = Math.max(0, Math.min(2, intensity));
    this.tempoBoost = tempoBoost;
    this.brightness = power ? 5600 : 2400;
  }

  stepSeconds() {
    return 60 / (this.song.tempo * this.tempoBoost) / 4;
  }

  // 현재 곡 위치(섹션 이름·마디)를 알려준다. 디버그·테스트용.
  position() {
    const bar = this.bars[this.barIndex];
    return bar ? { section: bar.name, barInSection: bar.barInSection, barIndex: this.barIndex, step: this.step } : null;
  }

  schedule() {
    const context = this.sound.context;
    if (!context || !this.song || !this.bus) return;
    while (this.nextStepTime < context.currentTime + LOOKAHEAD_SECONDS) {
      this.playStep(this.nextStepTime);
      const swing = this.step % 2 === 0 ? 1 + this.song.swing : 1 - this.song.swing;
      this.nextStepTime += this.stepSeconds() * swing;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.barIndex++;
        if (this.barIndex >= this.bars.length) this.barIndex = this.song.loopFrom ?? 0;
      }
    }
  }

  // 섹션별 패턴 길이 계산은 한 번만 하고 재사용한다.
  lengthsFor(pattern) {
    if (!this.cache.has(pattern)) this.cache.set(pattern, noteLengths(pattern));
    return this.cache.get(pattern);
  }

  playStep(time) {
    const song = this.song;
    const { section, barInSection, transpose } = this.bars[this.barIndex];
    const step = this.step;
    const stepSeconds = this.stepSeconds();
    const chord = parseChord(section.chords[barInSection % section.chords.length]);
    const chordRoot = song.key + transpose + chord.semitones;
    const lastBar = barInSection === section.bars - 1;
    const play = (instrument, note, steps, velocity = 1) => {
      try {
        INSTRUMENTS[instrument](this, time, note, steps * stepSeconds, velocity);
      } catch (error) { /* 개별 음 실패는 무시 */ }
    };

    // 드럼: 섹션 마지막 마디는 필인으로 대체
    const kit = song.kits[section.drums] ?? {};
    for (const part of DRUM_PARTS) {
      const pattern = section.fill && lastBar && song.fill[part] ? song.fill[part] : kit[part];
      if (!pattern) continue;
      const mark = pattern[step];
      if (mark === 'x') play(part, 0, 1, 1);
      else if (mark === 'o') play(part === 'hat' ? 'openHat' : part, 0, 1, 0.7);
    }
    if (section.crash && barInSection === 0 && step === 0) play('crash', 0, 1, 1);
    if (this.intensity >= 1 && step % 2 === 1 && section.drums !== 'none') play('hat', 0, 1, 0.45);

    // 베이스: 근음을 36~47 옥타브로
    if (section.bass) {
      const mark = section.bass[step];
      const lengths = this.lengthsFor(section.bass);
      if (lengths[step]) {
        const bassRoot = 36 + ((((chordRoot - 36) % 12) + 12) % 12);
        const offsets = { R: 0, r: 0, O: 12, 5: 7, 3: chord.tones[1] };
        if (mark in offsets) play('bass', bassRoot + offsets[mark], lengths[step], mark === 'r' ? 0.55 : 1);
      }
    }

    // 화음 반주
    const voicingRoot = 53 + ((((chordRoot - 53) % 12) + 12) % 12);
    if (section.comp === 'pad' && step === 0) {
      for (const tone of chord.tones) play('pad', voicingRoot + tone, 16, 1);
    } else if (section.comp === 'arp') {
      const tones = [...chord.tones, ...chord.tones.map(tone => tone + 12)];
      play('arp', voicingRoot + 12 + tones[step % tones.length], 1, step % 4 === 0 ? 1 : 0.7);
    } else if (section.comp && typeof section.comp === 'object' && section.comp.pattern[step] === 'x') {
      for (const tone of chord.tones) play(section.comp.instrument, voicingRoot + tone, 1, 1);
    }

    // 멜로디
    if (section.melody && section.lead) {
      const bar = section.melody[barInSection % section.melody.length];
      const lengths = this.lengthsFor(bar);
      if (lengths[step]) {
        const note = melodyNote(song, bar[step], transpose);
        if (note !== null) {
          play(section.lead, note, lengths[step], 1);
          if (this.intensity >= 2) play('bell', note, lengths[step], 0.5);
        }
      }
    }

    // 배터리 모드 인트로·브레이크다운의 소나 핑, 위기 층
    if (section.ping && step === 0 && barInSection % 2 === 0) play('ping', song.key + 36 + transpose, 8, 0.9);
    if (this.songName === 'battery' && this.intensity >= 1 && (step === 0 || step === 8)) play('alarm', chordRoot + 31, 1, 0.8);
    if (this.intensity >= 2 && this.songName === 'battery' && (step === 0 || step === 8)) play('heartbeat', 0, 1, 1);
  }

  voice({ type, frequency, detune = 0, sweepTo = null, time, attack, hold = 0, release, peak, filter = null }) {
    const context = this.sound.context;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    const holdSeconds = Math.max(0, hold);
    if (sweepTo) oscillator.frequency.exponentialRampToValueAtTime(sweepTo, time + attack + holdSeconds + release);
    oscillator.detune.value = detune;
    const gain = context.createGain();
    const safePeak = Math.max(peak, 0.0002);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(safePeak, time + attack);
    gain.gain.setValueAtTime(safePeak, time + attack + holdSeconds);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + holdSeconds + release);
    let head = oscillator;
    if (filter) {
      const biquad = context.createBiquadFilter();
      biquad.type = 'lowpass';
      biquad.frequency.value = filter;
      oscillator.connect(biquad);
      head = biquad;
    }
    head.connect(gain);
    gain.connect(this.bus);
    oscillator.start(time);
    oscillator.stop(time + attack + holdSeconds + release + 0.05);
  }

  noise({ time, release, peak, type, frequency }) {
    const context = this.sound.context;
    const source = context.createBufferSource();
    source.buffer = this.sound.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(peak, 0.0002), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    source.start(time, Math.random() * 0.3);
    source.stop(time + release + 0.02);
  }
}

export { SONGS };
