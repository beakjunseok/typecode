// 리듬 모드 반주: 128 BPM 킥·스네어·하이햇·베이스·화음 스탭을 Web Audio로 실시간 합성한다(음원 파일 없음).
// 프레임마다 앞으로 LOOKAHEAD초 안의 8분음표를 오디오 시계에 미리 예약한다. 예약 시각 = clock.audioOffset + 게임 시간이라
// 판정선에 노트가 닿는 순간과 박이 들리는 순간이 같다. 탭이 숨으면(프레임 없음) 예약이 멈추고, 돌아오면 지난 박은 건너뛴다.
import { BEAT_SECONDS, RHYTHM_RULES, chordAtBeat } from './rhythm-engine.js';

const LOOKAHEAD_SECONDS = 0.15;
const HALF = BEAT_SECONDS / 2;
const midiToFrequency = note => 440 * 2 ** ((note - 69) / 12);

export class RhythmMusic {
  constructor(sound) {
    this.sound = sound;
    this.nextHalf = 0;
  }

  reset() {
    this.nextHalf = 0;
  }

  // 매 프레임 호출. O(이번 창에 들어온 8분음표 수)
  pump(engine, intensity = 0) {
    if (engine.status !== 'running' || !this.sound.enabled) return;
    const context = this.sound.context;
    const offset = engine.clock.audioOffset;
    if (!context || offset === null) return;
    const firstNeeded = Math.ceil((engine.gameTime - 0.01) / HALF);
    if (this.nextHalf < firstNeeded) this.nextHalf = firstNeeded;
    const horizon = Math.min(engine.gameTime + LOOKAHEAD_SECONDS, engine.endTime);
    while (this.nextHalf * HALF < horizon) {
      const time = offset + this.nextHalf * HALF;
      if (time >= context.currentTime - 0.005) {
        try {
          this.scheduleHalf(context, this.nextHalf, time, intensity);
        } catch (error) {
          /* 소리 실패는 게임 진행과 무관 */
        }
      }
      this.nextHalf++;
    }
  }

  scheduleHalf(context, half, time, intensity) {
    const sound = this.sound;
    const beat = half / 2;
    const onBeat = half % 2 === 0;
    const beatInBar = Math.floor(beat) % RHYTHM_RULES.beatsPerBar;
    const leadIn = beat < RHYTHM_RULES.leadInBeats;
    // 리드인: 첫 마디는 카운트(마디 첫 박은 높게), 둘째 마디부터 킥이 들어온다
    if (leadIn) {
      if (onBeat) {
        sound.tone(context, { frequency: beatInBar === 0 ? 1760 : 1320, startTime: time, peak: 0.05, decay: 0.05, waveform: 'square', filter: { type: 'lowpass', frequency: 4000 } });
        if (beat >= RHYTHM_RULES.beatsPerBar) this.kick(context, time);
      }
      return;
    }
    const chord = chordAtBeat(beat);
    if (onBeat) {
      this.kick(context, time);
      if (beatInBar === 1 || beatInBar === 3) {
        sound.noise(context, { startTime: time, peak: 0.07, decay: 0.12, filterType: 'bandpass', frequency: 1800, q: 0.8 });
        sound.tone(context, { frequency: 190, sweepTo: 120, startTime: time, peak: 0.05, decay: 0.08, waveform: 'triangle' });
      }
      if (beatInBar === 0) {
        for (const note of chord.tones) {
          sound.tone(context, { frequency: midiToFrequency(note), startTime: time, peak: 0.018, attack: 0.01, decay: 0.38, waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 1400 + intensity * 600 } });
        }
      }
    } else {
      sound.noise(context, { startTime: time, peak: 0.025 + intensity * 0.01, decay: 0.035, filterType: 'highpass', frequency: 7000 });
      // 콤보 단계가 오르면 화음 아르페지오가 붙는다
      if (intensity >= 1) {
        const tone = chord.tones[(half >> 1) % chord.tones.length] + 12;
        sound.tone(context, { frequency: midiToFrequency(tone), startTime: time, peak: 0.016 + (intensity - 1) * 0.008, decay: 0.12, waveform: 'square', filter: { type: 'lowpass', frequency: 3200 } });
      }
    }
    // 베이스: 정박 근음, 엇박 한 옥타브 위
    sound.tone(context, { frequency: midiToFrequency(chord.root + (onBeat ? 0 : 12)), startTime: time, peak: 0.07, attack: 0.005, decay: HALF * 0.85, waveform: 'sawtooth', filter: { type: 'lowpass', frequency: 420 } });
  }

  kick(context, time) {
    this.sound.tone(context, { frequency: 140, sweepTo: 42, startTime: time, peak: 0.16, attack: 0.002, decay: 0.16 });
  }
}

// 판정음의 높이: 그 박의 화음에서 레인 번호의 음(레인 0~3 = 화음 1·3·5·8도) 한 옥타브 위
export function hitFrequency(beat, lane) {
  const chord = chordAtBeat(beat);
  return midiToFrequency(chord.tones[Math.max(0, Math.min(chord.tones.length - 1, lane))] + 12);
}
