// 모드별 BGM을 Web Audio로 실시간 합성한다(음원 파일 없음 → 저작권·로딩 문제 없음).
// 구조: 16분음표 스텝 시퀀서 + 미리 예약(lookahead) 스케줄러. 곡마다 화성 진행·악기·리듬 패턴을 데이터로 정의하고,
// intensity(0~2)로 층(layer)을 더하거나 템포·필터를 바꿔 게임 상황에 반응한다.

const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;
const CROSSFADE_SECONDS = 0.8;
const MUSIC_VOLUME = 0.32;

const midiToFrequency = note => 440 * 2 ** ((note - 69) / 12);

// ---------- 악기: (bgm, destination, time, note, length, velocity) ----------
const INSTRUMENTS = {
  // 로즈 피아노 느낌: 삼각파 + 한 옥타브 위 사인, 부드러운 감쇠
  keys(bgm, destination, time, note, length, velocity) {
    const frequency = midiToFrequency(note);
    bgm.voice(destination, { type: 'triangle', frequency, time, attack: 0.012, hold: length * 0.4, release: length * 1.2, peak: 0.09 * velocity, filter: 1800 });
    bgm.voice(destination, { type: 'sine', frequency: frequency * 2, time, attack: 0.005, hold: 0.02, release: length * 0.5, peak: 0.025 * velocity });
  },
  // 패드: 살짝 어긋난 두 톱니파를 저역 필터로 눌러 넓게
  pad(bgm, destination, time, note, length, velocity) {
    const frequency = midiToFrequency(note);
    for (const detune of [-7, 7]) {
      bgm.voice(destination, { type: 'sawtooth', frequency, detune, time, attack: 0.6, hold: length - 0.6, release: 0.9, peak: 0.028 * velocity, filter: 750 });
    }
  },
  bass(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'triangle', frequency: midiToFrequency(note), time, attack: 0.005, hold: length * 0.5, release: length * 0.6, peak: 0.16 * velocity, filter: 900 });
  },
  chipBass(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'square', frequency: midiToFrequency(note), time, attack: 0.002, hold: length * 0.45, release: 0.05, peak: 0.06 * velocity, filter: bgm.chipFilter });
  },
  lead(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'square', frequency: midiToFrequency(note), time, attack: 0.003, hold: length * 0.55, release: 0.06, peak: 0.045 * velocity, filter: bgm.chipFilter });
  },
  // 소나 핑: 맑은 사인 + 긴 꼬리
  ping(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'sine', frequency: midiToFrequency(note), time, attack: 0.004, hold: 0.02, release: 1.6, peak: 0.07 * velocity });
    bgm.voice(destination, { type: 'sine', frequency: midiToFrequency(note + 12), time: time + 0.36, attack: 0.004, hold: 0.01, release: 0.9, peak: 0.02 * velocity });
  },
  kick(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'sine', frequency: 140, sweepTo: 42, time, attack: 0.002, hold: 0.02, release: 0.22, peak: 0.32 * velocity });
  },
  snare(bgm, destination, time, note, length, velocity) {
    bgm.noise(destination, { time, release: 0.16, peak: 0.12 * velocity, type: 'bandpass', frequency: 1900 });
    bgm.voice(destination, { type: 'triangle', frequency: 190, time, attack: 0.002, hold: 0.01, release: 0.08, peak: 0.06 * velocity });
  },
  rim(bgm, destination, time, note, length, velocity) {
    bgm.noise(destination, { time, release: 0.04, peak: 0.08 * velocity, type: 'bandpass', frequency: 3200 });
  },
  hat(bgm, destination, time, note, length, velocity) {
    bgm.noise(destination, { time, release: 0.035, peak: 0.05 * velocity, type: 'highpass', frequency: 7500 });
  },
  // 레코드 잡음: 아주 작은 클릭
  crackle(bgm, destination, time, note, length, velocity) {
    bgm.noise(destination, { time, release: 0.01, peak: 0.02 * velocity, type: 'highpass', frequency: 3000 });
  },
  // 위기 심장박동: 두 번 쿵쿵
  heartbeat(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'sine', frequency: 70, sweepTo: 40, time, attack: 0.004, hold: 0.02, release: 0.16, peak: 0.28 * velocity });
    bgm.voice(destination, { type: 'sine', frequency: 62, sweepTo: 38, time: time + 0.18, attack: 0.004, hold: 0.02, release: 0.14, peak: 0.2 * velocity });
  },
  alarm(bgm, destination, time, note, length, velocity) {
    bgm.voice(destination, { type: 'sawtooth', frequency: midiToFrequency(note), sweepTo: midiToFrequency(note - 5), time, attack: 0.01, hold: 0.08, release: 0.12, peak: 0.025 * velocity, filter: 1600 });
  }
};

// 7화음 보이싱(루트 기준 반음 간격)
const CHORDS = {
  maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], min: [0, 3, 7], maj: [0, 4, 7]
};

// ---------- 곡 정의 ----------
// steps(16)마다 패턴을 돌며, 각 층은 minIntensity 이상일 때만 연주된다.
export const TRACKS = {
  // 연습: Lo-fi. Fmaj7 – Em7 – Dm7 – Cmaj7, 스윙 16분
  practice: {
    tempo: 80, swing: 0.18,
    progression: [[53, 'maj7'], [52, 'min7'], [50, 'min7'], [48, 'maj7']],
    layers: [
      { instrument: 'keys', steps: [0, 10], notes: chord => chord.map(interval => chord.root + 12 + interval), length: 1.6, velocity: 0.9 },
      { instrument: 'bass', steps: [0, 7, 8], notes: chord => [chord.root - 12 + (chord.step === 7 ? 7 : 0)], length: 0.5 },
      { instrument: 'kick', steps: [0, 8, 11], velocity: 0.7 },
      { instrument: 'snare', steps: [4, 12], velocity: 0.45 },
      { instrument: 'hat', steps: [0, 2, 4, 6, 8, 10, 12, 14], velocity: 0.6 },
      { instrument: 'crackle', steps: [1, 5, 9, 13], velocity: 0.8, chance: 0.5 },
      { instrument: 'hat', steps: [3, 7, 11, 15], velocity: 0.35, minIntensity: 1 },
      { instrument: 'keys', steps: [3, 6, 14], notes: chord => [chord.root + 24 + chord.tones[(chord.bar + chord.step) % chord.tones.length]], length: 0.4, velocity: 0.6, minIntensity: 2 }
    ]
  },
  // 휴대폰 던지기: 칩튠 액션. Am – F – C – G, 16분 아르페지오
  throw: {
    tempo: 140, swing: 0,
    progression: [[57, 'min'], [53, 'maj'], [48, 'maj'], [55, 'maj']],
    layers: [
      { instrument: 'chipBass', steps: [0, 2, 4, 6, 8, 10, 12, 14], notes: chord => [chord.root - 12 + (chord.step % 4 === 2 ? 12 : 0)], length: 0.18 },
      { instrument: 'kick', steps: [0, 4, 8, 12], velocity: 0.9 },
      { instrument: 'snare', steps: [4, 12], velocity: 0.7 },
      { instrument: 'hat', steps: [2, 6, 10, 14], velocity: 0.7 },
      { instrument: 'lead', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], notes: chord => [chord.root + 12 + chord.tones[chord.step % chord.tones.length] + (chord.step >= 8 ? 12 : 0)], length: 0.1, velocity: 0.55 },
      { instrument: 'hat', steps: [1, 3, 5, 7, 9, 11, 13, 15], velocity: 0.4, minIntensity: 1 },
      { instrument: 'lead', steps: [0, 3, 6, 10, 12], notes: chord => [chord.root + 24 + chord.tones[(chord.bar + chord.step) % chord.tones.length]], length: 0.22, velocity: 0.5, minIntensity: 2 },
      { instrument: 'snare', steps: [14, 15], velocity: 0.4, minIntensity: 2 }
    ]
  },
  // 에러 구조 SOS: 긴장감 있는 심해. Dm – B♭ – Gm – A
  rescue: {
    tempo: 104, swing: 0,
    progression: [[50, 'min'], [46, 'maj'], [43, 'min'], [45, 'maj']],
    layers: [
      { instrument: 'pad', steps: [0], notes: chord => chord.tones.map(interval => chord.root + 12 + interval), length: 2.25, velocity: 1 },
      { instrument: 'bass', steps: [0, 3, 6, 8, 11, 14], notes: chord => [chord.root - 12], length: 0.25, velocity: 0.8 },
      { instrument: 'ping', steps: [0], notes: chord => [chord.root + 36], everyBars: 2, velocity: 0.9 },
      { instrument: 'hat', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], velocity: 0.28 },
      { instrument: 'kick', steps: [0, 10], velocity: 0.7 },
      { instrument: 'rim', steps: [12], velocity: 0.8 },
      { instrument: 'alarm', steps: [0, 8], notes: chord => [chord.root + 31], minIntensity: 1, velocity: 0.8 },
      { instrument: 'heartbeat', steps: [0, 8], minIntensity: 2, velocity: 1 }
    ]
  }
};

export class BgmEngine {
  constructor(sound) {
    this.sound = sound;
    this.enabled = true;
    this.trackName = null;
    this.track = null;
    this.bus = null;
    this.intensity = 0;
    this.tempoBoost = 1;
    this.chipFilter = 2200;
    this.step = 0;
    this.bar = 0;
    this.nextStepTime = 0;
    this.timerId = null;
    this.ducked = false;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
    else if (this.trackName) this.play(this.trackName, { force: true });
  }

  // 사용자 입력 이후에 호출해야 소리가 난다(자동재생 정책). 같은 곡이면 무시, 다른 곡이면 크로스페이드.
  play(trackName, { force = false } = {}) {
    this.trackName = trackName;
    if (!this.enabled || !TRACKS[trackName]) return;
    const context = this.sound.ensureContext();
    if (!context) return;
    if (!force && this.track === TRACKS[trackName] && this.timerId) return;
    this.fadeOutBus();
    const bus = context.createGain();
    bus.gain.setValueAtTime(0.0001, context.currentTime);
    bus.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, context.currentTime + CROSSFADE_SECONDS);
    bus.connect(this.sound.master);
    this.bus = bus;
    this.track = TRACKS[trackName];
    this.step = 0;
    this.bar = 0;
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
    this.track = null;
  }

  // 게임 종료·결과창에서는 음악을 낮춘다.
  duck(ducked) {
    const context = this.sound.context;
    if (!this.bus || !context || this.ducked === ducked) return;
    this.ducked = ducked;
    this.bus.gain.cancelScheduledValues(context.currentTime);
    this.bus.gain.setValueAtTime(Math.max(this.bus.gain.value, 0.0001), context.currentTime);
    this.bus.gain.exponentialRampToValueAtTime(ducked ? MUSIC_VOLUME * 0.3 : MUSIC_VOLUME, context.currentTime + 0.5);
  }

  // intensity 0~2: 층 추가. tempoBoost: 위기 때 템포 상승. power: 노트북/롤백 중 필터 개방.
  setIntensity(intensity, { tempoBoost = 1, power = false } = {}) {
    this.intensity = Math.max(0, Math.min(2, intensity));
    this.tempoBoost = tempoBoost;
    this.chipFilter = power ? 5200 : 2200;
  }

  schedule() {
    const context = this.sound.context;
    if (!context || !this.track || !this.bus) return;
    while (this.nextStepTime < context.currentTime + LOOKAHEAD_SECONDS) {
      this.playStep(this.nextStepTime);
      const stepSeconds = 60 / (this.track.tempo * this.tempoBoost) / 4;
      const swing = this.step % 2 === 0 ? 1 + this.track.swing : 1 - this.track.swing;
      this.nextStepTime += stepSeconds * swing;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  playStep(time) {
    const track = this.track;
    const [root, quality] = track.progression[this.bar % track.progression.length];
    const tones = CHORDS[quality];
    const chord = Object.assign(tones.slice(), { root, tones, step: this.step, bar: this.bar });
    const stepSeconds = 60 / (track.tempo * this.tempoBoost) / 4;
    for (const layer of track.layers) {
      if ((layer.minIntensity ?? 0) > this.intensity) continue;
      if (!layer.steps.includes(this.step)) continue;
      if (layer.everyBars && this.bar % layer.everyBars !== 0) continue;
      if (layer.chance && Math.random() > layer.chance) continue;
      const notes = layer.notes ? layer.notes(chord) : [0];
      const length = (layer.length ?? 0.25) * stepSeconds * 4;
      for (const note of notes) {
        try {
          INSTRUMENTS[layer.instrument](this, this.bus, time, note, length, layer.velocity ?? 1);
        } catch (error) { /* 개별 음 실패는 무시 */ }
      }
    }
  }

  // 단일 발음체: 오실레이터 → (필터) → 엔벨로프 → 버스
  voice(destination, { type, frequency, detune = 0, sweepTo = null, time, attack, hold = 0, release, peak, filter = null }) {
    const context = this.sound.context;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (sweepTo) oscillator.frequency.exponentialRampToValueAtTime(sweepTo, time + attack + hold + release);
    oscillator.detune.value = detune;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
    gain.gain.setValueAtTime(Math.max(peak, 0.0002), time + attack + Math.max(hold, 0));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + Math.max(hold, 0) + release);
    let head = oscillator;
    if (filter) {
      const biquad = context.createBiquadFilter();
      biquad.type = 'lowpass';
      biquad.frequency.value = filter;
      oscillator.connect(biquad);
      head = biquad;
    }
    head.connect(gain);
    gain.connect(destination);
    oscillator.start(time);
    oscillator.stop(time + attack + Math.max(hold, 0) + release + 0.05);
  }

  noise(destination, { time, release, peak, type, frequency }) {
    const context = this.sound.context;
    const source = context.createBufferSource();
    source.buffer = this.sound.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(time, Math.random() * 0.3);
    source.stop(time + release + 0.02);
  }
}
