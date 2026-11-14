// 리듬 모드 반주: 곡의 화음 진행·템포로 베이스·화음·드럼을, 글자를 얹지 않은 선율 음은 부드러운 소리로 실시간 합성한다
// (음원 파일 없음). 글자를 얹은 선율 음은 플레이어가 맞혔을 때만 소리 난다(키 사운드).
// 프레임마다 앞으로 LOOKAHEAD초 안의 소리를 오디오 시계에 미리 예약한다. 예약 시각 = clock.audioOffset + 게임 시간이라
// 판정선에 노트가 닿는 순간과 박이 들리는 순간이 같다. 탭이 숨으면 예약이 멈추고, 돌아오면 지난 소리는 건너뛴다.

const LOOKAHEAD_SECONDS = 0.15;

// AI 음원 곡의 오디오 버퍼(주소별 한 번만 받아 디코딩). 실패하면 null로 남고 게임은 음원 없이 진행된다
const audioBuffers = new Map();
export function loadSongAudio(context, url) {
  if (!context || !url) return Promise.resolve(null);
  if (!audioBuffers.has(url)) {
    const entry = { buffer: null, promise: null };
    entry.promise = fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(data => context.decodeAudioData(data))
      .then(buffer => (entry.buffer = buffer))
      .catch(() => null);
    audioBuffers.set(url, entry);
  }
  return audioBuffers.get(url).promise;
}
const readyBuffer = url => audioBuffers.get(url)?.buffer ?? null;
export const midiToFrequency = note => 440 * 2 ** ((note - 69) / 12);

// 스타일별 반주: 박 안 위치마다 무엇을 칠지
// beat = 마디 안 박 번호, half = 0(정박)/1(엇박)
const STYLES = Object.freeze({
  // 원래 게임 반주: 킥 매 박, 스네어 2·4, 하이햇 엇박, 베이스 8분, 마디 첫 박 화음
  pop: { kick: ({ half }) => half === 0, snare: ({ beat, half }) => half === 0 && beat % 2 === 1, hat: ({ half }) => half === 1, bass: () => true, bassOctaveOnOff: true, chord: ({ beat, half }) => beat === 0 && half === 0, chordLength: 0.8, kickLevel: 1 },
  // 동요·찬가: 1·3박 베이스, 2·4박 화음, 가벼운 킥과 하이햇
  gentle: { kick: ({ beat, half }) => half === 0 && beat % 2 === 0, snare: () => false, hat: ({ half }) => half === 1, bass: ({ beat, half }) => half === 0 && beat % 2 === 0, chord: ({ beat, half }) => half === 0 && beat % 2 === 1, chordLength: 0.7, kickLevel: 0.55, hatLevel: 0.6 },
  // 고전 세레나데: 베이스 1·3박, 화음 8분 반복(알베르티 느낌), 드럼 없음에 가까움
  classic: { kick: ({ beat, half }) => half === 0 && beat === 0, snare: () => false, hat: () => false, bass: ({ beat, half }) => half === 0 && beat % 2 === 0, chord: ({ half }) => half === 1, chordLength: 0.4, kickLevel: 0.45 },
  // 3박 곡: 첫 박 베이스, 2·3박 화음
  waltz: { kick: ({ beat, half }) => half === 0 && beat === 0, snare: () => false, hat: () => false, bass: ({ beat, half }) => half === 0 && beat === 0, chord: ({ beat, half }) => half === 0 && beat > 0, chordLength: 0.6, kickLevel: 0.4 },
  // 행진·질주: 킥 매 박, 스네어 2·4, 베이스 8분 스타카토
  drive: { kick: ({ half }) => half === 0, snare: ({ beat, half }) => half === 0 && beat % 2 === 1, hat: ({ half }) => half === 1, bass: () => true, chord: ({ beat, half }) => beat % 2 === 1 && half === 1, chordLength: 0.3, kickLevel: 1 },
  // 갤럽(2/4): 쿵(베이스)-짝(화음) 반복, 킥 매 박, 스네어 둘째 박
  // AI 음원 곡: 음원이 반주라 합성 반주는 없다(카운트만)
  audio: { kick: () => false, snare: () => false, hat: () => false, bass: () => false, chord: () => false },
  galop: { kick: ({ half }) => half === 0, snare: ({ beat, half }) => half === 0 && beat === 1, hat: () => false, bass: ({ half }) => half === 0, chord: ({ half }) => half === 1, chordLength: 0.35, kickLevel: 0.9 },
  // 6/8 자장가: 셋째 8분마다 베이스, 나머지 8분에 여린 화음, 드럼 없음
  lullaby: { kick: () => false, snare: () => false, hat: () => false, bass: ({ beat, half }) => half === 0 && beat % 3 === 0, chord: ({ beat, half }) => half === 0 && beat % 3 !== 0, chordLength: 0.5 },
  // 느린 곡: 2박마다 베이스와 길게 끄는 화음, 드럼 없음
  pad: { kick: () => false, snare: () => false, hat: () => false, bass: ({ beat, half }) => half === 0 && beat % 2 === 0, chord: ({ beat, half }) => half === 0 && beat % 2 === 0, chordLength: 1.8 },
  // MIDI 악보 곡: 반주는 악보의 음(accompaniment)을 그대로 연주하고 드럼은 없다 / 래그·행진곡은 여린 킥과 하이햇만 더한다
  score: { kick: () => false, snare: () => false, hat: () => false, bass: () => false, chord: () => false },
  'score-beat': { kick: ({ beat, half }) => half === 0 && beat === 0, snare: () => false, hat: ({ half }) => half === 1, bass: () => false, chord: () => false, kickLevel: 0.5, hatLevel: 0.5 }
});

// 악보 반주 음: 부드러운 삼각파(피아노 비슷하게 빨리 올라와 서서히 줄어든다)
function scoreNote(sound, context, { midi, time, seconds, level = 1, destination }) {
  sound.tone(context, { frequency: midiToFrequency(midi), startTime: time, peak: 0.02 * level, attack: 0.004, decay: Math.min(1.4, Math.max(0.1, seconds * 0.95)), waveform: 'triangle', filter: { type: 'lowpass', frequency: 2400 }, destination });
}

// 리듬 모드 소리 키우기: 반주·키 소리·음원·미리듣기를 모두 증폭 버스(× RHYTHM_BOOST)에 모아 master로 보낸다.
// master 뒤 압축기가 있어 커져도 찢어지지 않는다. sound를 감싸 tone()의 기본 출력과 master만 바꾼다
export const RHYTHM_BOOST = 2.6;
function rhythmBus(sound, context) {
  if (!sound.master) return undefined;
  if (sound.rhythmBusNode?.context !== context) {
    const bus = context.createGain();
    bus.gain.value = RHYTHM_BOOST;
    bus.connect(sound.master);
    sound.rhythmBusNode = bus;
  }
  return sound.rhythmBusNode;
}
export function boostedSound(sound) {
  if (!sound || sound.isBoosted) return sound;
  return new Proxy(sound, {
    get(target, property) {
      if (property === 'isBoosted') return true;
      if (property === 'tone' || property === 'noise') {
        return (context, options) => target[property](context, { ...options, destination: options.destination ?? rhythmBus(target, context) });
      }
      if (property === 'master') return target.context ? rhythmBus(target, target.context) ?? target.master : target.master;
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export class RhythmMusic {
  constructor(sound) {
    this.sound = boostedSound(sound);
    this.reset();
  }

  reset() {
    this.nextHalf = 0;
    this.nextAuto = 0;
    this.nextScore = 0;
    this.stopAudio();
  }

  stopAudio() {
    if (!this.audioNode) return;
    try {
      this.audioNode.source.stop();
      this.audioNode.gain.disconnect();
    } catch (error) {
      /* 이미 멈춤 */
    }
    this.audioNode = null;
  }

  // 음원 곡: 곡 첫 박(음원 firstBeat초)이 게임 시간 리드인 끝에 오도록 한 번 예약한다.
  // 시작 시각이 이미 지났으면(버퍼가 늦게 준비됨) 그만큼 음원 안쪽에서 시작
  pumpAudio(engine, context, offset) {
    const audio = engine.song.audio;
    if (!audio || this.audioNode) return;
    const buffer = readyBuffer(audio.url);
    if (!buffer) {
      loadSongAudio(context, audio.url);
      return;
    }
    const startGameTime = engine.leadInBeats * engine.beatSeconds - audio.firstBeat;
    const when = offset + startGameTime;
    const late = Math.max(0, context.currentTime + 0.02 - when);
    if (late >= buffer.duration) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(this.sound.master);
    source.start(when + late, late);
    this.audioNode = { source, gain };
  }

  // 매 프레임 호출. O(이번 창에 들어온 소리 수)
  pump(engine, intensity = 0) {
    if (engine.status !== 'running' || !this.sound.enabled) return;
    const context = this.sound.context;
    const offset = engine.clock.audioOffset;
    if (!context || offset === null) return;
    const half = engine.beatSeconds / 2;
    const horizon = Math.min(engine.gameTime + LOOKAHEAD_SECONDS, engine.endTime);
    const firstNeeded = Math.ceil((engine.gameTime - 0.01) / half);
    if (this.nextHalf < firstNeeded) this.nextHalf = firstNeeded;
    while (this.nextHalf * half < horizon) {
      const time = offset + this.nextHalf * half;
      if (time >= context.currentTime - 0.005) this.safely(() => this.scheduleHalf(context, engine, this.nextHalf, time, intensity));
      this.nextHalf++;
    }
    if (engine.song.audio) {
      this.safely(() => this.pumpAudio(engine, context, offset));
      return;
    }
    // 글자를 얹지 않은 선율 음
    const notes = engine.autoNotes;
    while (this.nextAuto < notes.length && notes[this.nextAuto].time < engine.gameTime - 0.01) this.nextAuto++;
    while (this.nextAuto < notes.length && notes[this.nextAuto].time < horizon) {
      const note = notes[this.nextAuto];
      const time = offset + note.time;
      if (time >= context.currentTime - 0.005) this.safely(() => this.melody(context, note.midi, time, note.dur, 0.6));
      this.nextAuto++;
    }
    this.pumpScore(engine, context, offset, horizon);
  }

  // MIDI 곡의 반주 음(곡 박 → 게임 시간 = (박 + 리드인) × 박 길이). O(이번 창의 음 수)
  pumpScore(engine, context, offset, horizon) {
    const score = engine.song.accompaniment;
    if (!score?.length) return;
    const timeOf = note => (note.beat + engine.leadInBeats) * engine.beatSeconds;
    while (this.nextScore < score.length && timeOf(score[this.nextScore]) < engine.gameTime - 0.01) this.nextScore++;
    while (this.nextScore < score.length && timeOf(score[this.nextScore]) < horizon) {
      const note = score[this.nextScore];
      const time = offset + timeOf(note);
      if (time >= context.currentTime - 0.005) this.safely(() => scoreNote(this.sound, context, { midi: note.midi, time, seconds: note.dur * engine.beatSeconds }));
      this.nextScore++;
    }
  }

  safely(action) {
    try {
      action();
    } catch (error) {
      /* 소리 실패는 게임 진행과 무관 */
    }
  }

  scheduleHalf(context, engine, halfIndex, time, intensity) {
    const sound = this.sound;
    const beat = halfIndex / 2;
    const half = halfIndex % 2;
    const beatInBar = Math.floor(beat) % engine.beatsPerBar;
    // 리드인: 첫 마디는 카운트(마디 첫 박은 높게), 그 뒤로 킥
    if (beat < engine.leadInBeats) {
      if (half === 0) {
        sound.tone(context, { frequency: beatInBar === 0 ? 1760 : 1320, startTime: time, peak: 0.05, decay: 0.05, waveform: 'square', filter: { type: 'lowpass', frequency: 4000 } });
        if (beat >= engine.leadInBeats / 2) this.kick(context, time, 0.8);
      }
      return;
    }
    const style = STYLES[engine.song.style] ?? STYLES.pop;
    const position = { beat: beatInBar, half };
    const chord = engine.chordAtBeat(beat);
    if (style.kick(position)) this.kick(context, time, style.kickLevel ?? 1);
    if (style.snare(position)) {
      sound.noise(context, { startTime: time, peak: 0.06, decay: 0.12, filterType: 'bandpass', frequency: 1800, q: 0.8 });
      sound.tone(context, { frequency: 190, sweepTo: 120, startTime: time, peak: 0.04, decay: 0.08, waveform: 'triangle' });
    }
    if (style.hat(position)) sound.noise(context, { startTime: time, peak: (0.022 + intensity * 0.01) * (style.hatLevel ?? 1), decay: 0.035, filterType: 'highpass', frequency: 7000 });
    if (!chord) return;
    if (style.bass(position)) {
      const note = chord.root + (style.bassOctaveOnOff && half === 1 ? 12 : 0);
      sound.tone(context, { frequency: midiToFrequency(note), startTime: time, peak: 0.07, attack: 0.005, decay: engine.beatSeconds * (style.bassOctaveOnOff ? 0.42 : 0.7), waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 420 } });
    }
    if (style.chord(position)) {
      for (const note of chord.tones) {
        sound.tone(context, { frequency: midiToFrequency(note), startTime: time, peak: 0.016, attack: 0.008, decay: engine.beatSeconds * style.chordLength, waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 1300 + intensity * 500 } });
      }
    }
  }

  // 선율 음(자동 연주): 부드러운 삼각파 + 옅은 사각파
  melody(context, midi, time, seconds, level = 1) {
    const frequency = midiToFrequency(midi);
    const length = Math.min(0.9, Math.max(0.12, seconds * 0.9));
    this.sound.tone(context, { frequency, startTime: time, peak: 0.045 * level, attack: 0.006, decay: length, waveform: 'triangle' });
    this.sound.tone(context, { frequency, startTime: time, peak: 0.01 * level, decay: length * 0.6, waveform: 'square', filter: { type: 'lowpass', frequency: 2600 } });
  }

  kick(context, time, level = 1) {
    this.sound.tone(context, { frequency: 140, sweepTo: 42, startTime: time, peak: 0.15 * level, attack: 0.002, decay: 0.16 });
  }
}

// 곡 미리듣기: 선율 첫 몇 초를 출력 하나(gain)에 묶어 재생하고, 다른 곡을 고르면 그 출력을 끊는다
export function createPreview(rawSound) {
  const sound = boostedSound(rawSound);
  let output = null;
  return {
    play(song, seconds = 5) {
      this.stop();
      const context = sound.ensureContext?.();
      if (!context || !sound.enabled) return;
      if (song.audio) {
        this.playAudio(context, song, 8);
        return;
      }
      try {
        output = context.createGain();
        output.gain.value = 1;
        output.connect(sound.master);
        const beatSeconds = 60 / song.bpm;
        const start = context.currentTime + 0.05;
        for (const note of song.melody) {
          const at = note.beat * beatSeconds;
          if (at > seconds) break;
          const length = Math.min(0.8, Math.max(0.12, note.dur * beatSeconds * 0.9));
          sound.tone(context, { frequency: midiToFrequency(note.midi), startTime: start + at, peak: 0.05, attack: 0.006, decay: length, waveform: 'triangle', destination: output });
        }
        for (const note of song.accompaniment ?? []) {
          const at = note.beat * beatSeconds;
          if (at > seconds) break;
          scoreNote(sound, context, { midi: note.midi, time: start + at, seconds: note.dur * beatSeconds, level: 0.8, destination: output });
        }
        output.gain.setValueAtTime(1, start + seconds - 0.4);
        output.gain.linearRampToValueAtTime(0, start + seconds);
      } catch (error) {
        output = null;
      }
    },
    // 음원 곡 미리듣기: previewAt초부터 seconds초, 앞뒤를 부드럽게
    playAudio(context, song, seconds) {
      const token = {};
      this.current = token;
      loadSongAudio(context, song.audio.url).then(buffer => {
        if (!buffer || this.current !== token) return;
        try {
          output = context.createGain();
          output.connect(sound.master);
          const start = context.currentTime + 0.03;
          output.gain.setValueAtTime(0, start);
          output.gain.linearRampToValueAtTime(0.85, start + 0.3);
          output.gain.setValueAtTime(0.85, start + seconds - 0.8);
          output.gain.linearRampToValueAtTime(0, start + seconds);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(output);
          source.start(start, Math.min(song.audio.previewAt ?? 0, Math.max(0, buffer.duration - seconds)), seconds);
        } catch (error) {
          output = null;
        }
      });
    },
    stop() {
      this.current = null;
      if (!output) return;
      try {
        const context = output.context;
        output.gain.cancelScheduledValues(context.currentTime);
        output.gain.setTargetAtTime(0, context.currentTime, 0.03);
        const old = output;
        setTimeout(() => old.disconnect(), 200);
      } catch (error) {
        /* 무시 */
      }
      output = null;
    }
  };
}
