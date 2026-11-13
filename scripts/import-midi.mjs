// MIDI(Mutopia Project, 라이선스 확인한 파일만) → 리듬 모드 곡 데이터(public/js/rhythm-songs-midi.js).
// 사용: node scripts/import-midi.mjs
// 선율 = 지정 트랙에서 같은 시각에 시작하는 음 중 가장 높은 음(스카이라인), 반주 = 나머지 모든 음.
// 박 위치는 1/24박으로 맞추고, 노트는 [앞 음과의 간격, 길이, 음높이]를 이어 붙인 정수 배열로 줄여 저장한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(ROOT, '..', 'public', 'js', 'rhythm-songs-midi.js');
const STEPS_PER_BEAT = 24;
const MAX_SECONDS = 150;
const MIN_SECONDS = 60;
const MUTOPIA = id => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;

// file: scripts/midi 안 파일, melodyTrack: 선율 트랙 번호, beatUnit: 1박 = 4분음표 몇 개, bpm: 1박 기준 템포
// (LilyPond MIDI는 템포 표시가 없으면 4분음표 = 60이라 실제 곡 빠르기로 다시 정한다)
const SONGS = [
  { id: 'turkish-march', file: 'KV331_3_RondoAllaTurca.mid', title: '터키 행진곡', composer: '모차르트 · 소나타 K.331 3악장', died: 1791, melodyTrack: 1, beatUnit: 1, beatsPerBar: 2, bpm: 120, style: 'score-beat', source: MUTOPIA(108), license: 'Public Domain' },
  { id: 'entertainer', file: 'entertainer.mid', title: '엔터테이너', composer: '스콧 조플린 · 1902', died: 1917, melodyTrack: 1, beatUnit: 1, beatsPerBar: 2, bpm: 80, style: 'score-beat', source: MUTOPIA(263), license: 'Public Domain' },
  { id: 'maple-leaf', file: 'maple.mid', title: '메이플 리프 래그', composer: '스콧 조플린 · 1899', died: 1917, melodyTrack: 1, beatUnit: 1, beatsPerBar: 2, bpm: 100, style: 'score-beat', source: MUTOPIA(23), license: 'Public Domain' },
  { id: 'elite-syncopations', file: 'EliteSyncopations.mid', title: '엘리트 싱코페이션', composer: '스콧 조플린 · 1902', died: 1917, melodyTrack: 1, beatUnit: 1, beatsPerBar: 2, bpm: 92, style: 'score-beat', source: MUTOPIA(1540), license: 'Public Domain' },
  { id: 'fur-elise', file: 'fur_Elise_WoO59.mid', title: '엘리제를 위하여', composer: '베토벤 · WoO 59', died: 1827, melodyTrack: 1, beatUnit: 0.5, beatsPerBar: 3, bpm: 144, style: 'score', source: MUTOPIA(931), license: 'Public Domain' },
  { id: 'ode-to-joy', file: 'ode.mid', title: '환희의 송가', composer: '베토벤 · 교향곡 9번', died: 1827, melodyTrack: 1, beatUnit: 1, beatsPerBar: 4, bpm: 108, style: 'score-beat', source: MUTOPIA(528), license: 'Public Domain' },
  { id: 'mountain-king', file: 'Dans_l_antre_du_roi_de_la_montagne.mid', title: '산왕의 궁전에서', composer: '그리그 · 페르 귄트 Op.46-4', died: 1907, melodyTrack: 1, beatUnit: 1, beatsPerBar: 4, bpm: 138, style: 'score-beat', source: MUTOPIA(1888), license: 'Public Domain' },
  { id: 'pathetique', file: 'pathetique-2.mid', title: '비창 2악장', composer: '베토벤 · 소나타 Op.13', died: 1827, melodyTrack: 1, beatUnit: 0.5, beatsPerBar: 4, bpm: 76, style: 'score', source: MUTOPIA(295), license: 'Public Domain' },
  { id: 'beethoven-menuetto', file: 'LVB_Sonate_02no1_3.mid', title: '소나타 1번 미뉴에트', composer: '베토벤 · Op.2-1 3악장', died: 1827, melodyTrack: 1, beatUnit: 1, beatsPerBar: 3, bpm: 144, style: 'score', source: MUTOPIA(1276), license: 'Public Domain' },
  { id: 'clair-de-lune', file: 'debussy_Ste_Bergamesq_Clair.mid', title: '달빛', composer: '드뷔시 · 베르가마스크 모음곡', died: 1918, melodyTrack: 1, beatUnit: 0.5, beatsPerBar: 9, bpm: 104, style: 'score', source: MUTOPIA(1778), license: 'Public Domain' },
  { id: 'brahms-lullaby', file: 'Wiegenlied.mid', title: '브람스 자장가', composer: '브람스 · Op.49-4', died: 1897, melodyTrack: 1, beatUnit: 1, beatsPerBar: 3, bpm: 96, style: 'score', source: MUTOPIA(1037), license: 'Public Domain' },
  { id: 'toccata-fugue', file: 'ToccataFugue.mid', title: '토카타와 푸가 d단조', composer: '바흐 · BWV 565', died: 1750, melodyTrack: 1, beatUnit: 1, beatsPerBar: 4, bpm: 76, style: 'score', source: MUTOPIA(1780), license: 'Public Domain' },
  { id: 'bach-bourree', file: 'bourree.mid', title: '부레 E단조', composer: '바흐 · 류트 모음곡 BWV 996', died: 1750, melodyTrack: 1, beatUnit: 1, beatsPerBar: 4, bpm: 140, style: 'score', source: 'https://www.mutopiaproject.org/ftp/BachJS/BWV996/bourree/', license: 'Public Domain' },
  { id: 'bach-chorale', file: 'bwv_269.mid', title: '코랄 「진심으로」', composer: '바흐 · BWV 269', died: 1750, melodyTrack: 1, beatUnit: 1, beatsPerBar: 3, bpm: 84, style: 'score', source: MUTOPIA(378), license: 'Public Domain' },
  { id: 'minuit-chretiens', file: 'minuit_chretiens.mid', title: '거룩한 밤', composer: '아당 · 1847', died: 1856, melodyTrack: 2, beatUnit: 1, beatsPerBar: 4, bpm: 92, style: 'score', source: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=AdamA', license: 'Public Domain' },
  { id: 'abt-vocalise', file: 'Vocalise1.mid', title: '보칼리제 1번', composer: '프란츠 아프트', died: 1885, melodyTrack: 1, beatUnit: 1, beatsPerBar: 4, bpm: 104, style: 'score', source: 'https://www.mutopiaproject.org/ftp/AbtF/Vocalise1/', license: 'Public Domain' },
  { id: 'greensleeves', file: 'division-violin-two-27.mid', title: '그린슬리브스 변주', composer: '플레이퍼드 「디비전 바이올린」 · 1705', died: null, melodyTrack: 1, beatUnit: 1, beatsPerBar: 6, bpm: 150, style: 'classic', autoChords: true, source: MUTOPIA(1730), license: 'Public Domain' },
  { id: 'barbella-sonata', file: 'gimo-12.mid', title: '두 만돌린 소나타', composer: '바르벨라 · Gimo 12', died: 1777, melodyTrack: 1, beatUnit: 1, beatsPerBar: 2, bpm: 112, style: 'score', source: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=gimo', license: 'Public Domain' },
  { id: 'giuliani-allegro', file: 'giuliani-op50n24.mid', title: '나비 Op.50-24', composer: '줄리아니 · 기타', died: 1829, melodyTrack: 1, beatUnit: 1, beatsPerBar: 2, bpm: 132, style: 'score', source: MUTOPIA(1352), license: 'CC BY 3.0 (Mutopia Project)' },
  { id: 'canon', file: 'CanonInD.mid', title: '캐논 D장조', composer: '파헬벨', died: 1706, melodyTrack: 1, beatUnit: 1, beatsPerBar: 4, bpm: 66, style: 'gentle', chordCycle: ['D A', 'Bm F#m', 'G D', 'G A'], source: MUTOPIA(1700), license: 'CC BY 3.0 (Jim Paterson · mfiles.co.uk, Mutopia Project)' }
];

// ---------- 최소 SMF 파서 ----------
function readVariableLength(bytes, position) {
  let value = 0;
  let byte;
  do {
    byte = bytes[position.offset++];
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return value;
}

// 트랙별 음표 [{ track, start, end, pitch }] (틱). 드럼 채널(10)은 뺀다
function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
  const trackCount = view.getUint16(10);
  const ticksPerQuarter = view.getUint16(12);
  let offset = 8 + view.getUint32(4);
  const notes = [];
  for (let track = 0; track < trackCount; track++) {
    if (String.fromCharCode(...bytes.slice(offset, offset + 4)) !== 'MTrk') throw new Error('bad track header');
    const end = offset + 8 + view.getUint32(offset + 4);
    const position = { offset: offset + 8 };
    const open = new Map();
    let tick = 0;
    let status = 0;
    while (position.offset < end) {
      tick += readVariableLength(bytes, position);
      const byte = bytes[position.offset];
      // 메타·시스템 익스클루시브는 러닝 스테이터스를 바꾸지 않는다
      if (byte === 0xff) {
        position.offset += 2;
        const length = readVariableLength(bytes, position);
        position.offset += length;
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        position.offset++;
        const length = readVariableLength(bytes, position);
        position.offset += length;
        continue;
      }
      if (byte & 0x80) {
        status = byte;
        position.offset++;
      }
      const type = status & 0xf0;
      const channel = status & 0x0f;
      const first = bytes[position.offset++];
      const second = type === 0xc0 || type === 0xd0 ? 0 : bytes[position.offset++];
      if (channel === 9) continue;
      const key = `${channel}:${first}`;
      if (type === 0x90 && second > 0) {
        open.set(key, tick);
      } else if (type === 0x80 || (type === 0x90 && second === 0)) {
        if (open.has(key)) {
          notes.push({ track, start: open.get(key), end: tick, pitch: first });
          open.delete(key);
        }
      }
    }
    offset = end;
  }
  return { ticksPerQuarter, notes };
}

// ---------- 변환 ----------
const quantize = (ticks, ticksPerBeat) => Math.round(ticks / ticksPerBeat * STEPS_PER_BEAT);

// 선율 트랙 스카이라인 + 나머지 = 반주. 너무 짧은 장식음(1/12박 미만)은 반주로 보낸다
function splitVoices(notes, config, ticksPerBeat) {
  const quantized = notes.map(note => ({
    track: note.track, pitch: note.pitch,
    start: quantize(note.start, ticksPerBeat),
    length: Math.max(1, quantize(note.end, ticksPerBeat) - quantize(note.start, ticksPerBeat))
  })).sort((first, second) => first.start - second.start || second.pitch - first.pitch);
  const melodySet = new Set();
  const byOnset = new Map();
  for (const note of quantized) {
    if (note.track !== config.melodyTrack || note.length < STEPS_PER_BEAT / 12) continue;
    const top = byOnset.get(note.start);
    if (!top || note.pitch > top.pitch) byOnset.set(note.start, note);
  }
  const onsets = [...byOnset.keys()].sort((first, second) => first - second);
  const melody = onsets.map((onset, index) => {
    const note = byOnset.get(onset);
    melodySet.add(note);
    const next = onsets[index + 1] ?? Infinity;
    return { start: onset, length: Math.max(1, Math.min(note.length, next - onset)), pitch: note.pitch };
  });
  const accompaniment = quantized.filter(note => !melodySet.has(note)).map(({ start, length, pitch }) => ({ start, length, pitch }));
  return { melody, accompaniment };
}

// 긴 곡은 MAX_SECONDS 안의 마지막 마디 경계에서 자르고, 짧은 곡은 MIN_SECONDS를 넘을 때까지 반복한다
function fitLength(voices, config) {
  const barSteps = config.beatsPerBar * STEPS_PER_BEAT;
  const secondsPerStep = 60 / config.bpm / STEPS_PER_BEAT;
  const all = [...voices.melody, ...voices.accompaniment];
  const lastEnd = Math.max(...all.map(note => note.start + note.length));
  let length = Math.ceil(lastEnd / barSteps) * barSteps;
  const maxSteps = Math.floor(MAX_SECONDS / secondsPerStep / barSteps) * barSteps;
  const crop = list => list.filter(note => note.start < length).map(note => ({ ...note, length: Math.min(note.length, length - note.start) }));
  if (length > maxSteps) {
    length = maxSteps;
    return { melody: crop(voices.melody), accompaniment: crop(voices.accompaniment), length };
  }
  const repeats = Math.max(1, Math.min(4, Math.ceil(MIN_SECONDS / (length * secondsPerStep))));
  const repeat = list => Array.from({ length: repeats }, (_, index) => list.map(note => ({ ...note, start: note.start + index * length }))).flat();
  return { melody: repeat(voices.melody), accompaniment: repeat(voices.accompaniment), length: length * repeats };
}

// 반주가 없는 곡: 마디마다 선율 음으로 가장 잘 맞는 장·단3화음을 고른다
const CHORD_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function detectChords(melody, length, beatsPerBar) {
  const barSteps = beatsPerBar * STEPS_PER_BEAT;
  const bars = [];
  for (let bar = 0; bar * barSteps < length; bar++) {
    const weights = new Array(12).fill(0);
    for (const note of melody) {
      const overlap = Math.min(note.start + note.length, (bar + 1) * barSteps) - Math.max(note.start, bar * barSteps);
      if (overlap > 0) weights[note.pitch % 12] += overlap;
    }
    let best = { score: -1, name: bars.at(-1) ?? 'C' };
    for (let root = 0; root < 12; root++) {
      for (const minor of [false, true]) {
        const score = weights[root] * 1.2 + weights[(root + (minor ? 3 : 4)) % 12] + weights[(root + 7) % 12] * 0.9;
        if (score > best.score) best = { score, name: CHORD_NAMES[root] + (minor ? 'm' : '') };
      }
    }
    bars.push(best.score > 0 ? best.name : bars.at(-1) ?? 'C');
  }
  return bars;
}

// [간격, 길이, 음높이]를 이어 붙인 배열(간격 = 앞 음 시작과의 차이). O(n)
function encode(notes) {
  const sorted = [...notes].sort((first, second) => first.start - second.start || first.pitch - second.pitch);
  const flat = [];
  let previous = 0;
  for (const note of sorted) {
    flat.push(note.start - previous, note.length, note.pitch);
    previous = note.start;
  }
  return flat;
}

function convert(config) {
  const { ticksPerQuarter, notes } = parseMidi(readFileSync(join(ROOT, 'midi', config.file)));
  const ticksPerBeat = ticksPerQuarter * config.beatUnit;
  const fitted = fitLength(splitVoices(notes, config, ticksPerBeat), config);
  const bars = config.autoChords ? detectChords(fitted.melody, fitted.length, config.beatsPerBar)
    : config.chordCycle ? Array.from({ length: Math.ceil(fitted.length / (config.beatsPerBar * STEPS_PER_BEAT)) }, (_, index) => config.chordCycle[index % config.chordCycle.length])
      : [];
  const { file, melodyTrack, autoChords, chordCycle, beatUnit, ...meta } = config;
  return {
    ...meta,
    steps: STEPS_PER_BEAT,
    beats: fitted.length / STEPS_PER_BEAT,
    chords: bars,
    melody: encode(fitted.melody),
    accompaniment: encode(fitted.accompaniment)
  };
}

const songs = SONGS.map(convert);
for (const song of songs) {
  console.log(`${song.id.padEnd(20)} ${(song.beats * 60 / song.bpm).toFixed(0).padStart(4)}s melody ${song.melody.length / 3} accomp ${song.accompaniment.length / 3}`);
}
const header = `// 자동 생성 파일: node scripts/import-midi.mjs (원본: scripts/midi, 출처·라이선스는 곡마다 source·license)\n` +
  `// melody·accompaniment = [앞 음과의 간격, 길이, MIDI 음높이] 반복, 단위 1/${STEPS_PER_BEAT}박\n`;
writeFileSync(OUTPUT, `${header}export const MIDI_SONG_DATA = ${JSON.stringify(songs)};\n`);
console.log(`wrote ${OUTPUT} (${(JSON.stringify(songs).length / 1024).toFixed(0)} KB)`);
