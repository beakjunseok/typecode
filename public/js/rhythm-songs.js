// 리듬 모드 곡 목록. 두 종류가 있다.
// 1) 이 파일의 문자열 악보: 저작권이 끝난 곡의 주제 선율을 이 프로젝트에서 직접 음표로 옮긴 것. 반주는 스타일별로 합성한다.
// 2) rhythm-songs-midi.js: Mutopia Project의 MIDI(라이선스를 곡마다 확인, source·license 필드)를 scripts/import-midi.mjs로
//    선율(맨 윗성부)과 반주(나머지 음)로 나눈 것. 반주는 악보의 음을 그대로 부드러운 소리로 연주한다.
// 선율 표기: "음이름옥타브:길이(박)" 공백 구분, 쉼표는 "r:길이", 길이 생략 시 1박. 마디 구분 "|"는 읽기용(무시).
// 화음 표기: 마디마다 하나, 한 마디에 둘 이상이면 공백으로 나눠 마디를 균등 분할. 예) 'C', 'F C', 'Am'

import { MIDI_SONG_DATA } from './rhythm-songs-midi.js';

const NOTE_OFFSETS = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

// "F#4" → MIDI 번호
export function noteToMidi(name) {
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!match) throw new Error(`bad note: ${name}`);
  const [, letter, accidental, octave] = match;
  return (Number(octave) + 1) * 12 + NOTE_OFFSETS[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
}

// 선율 문자열 → [{ beat, dur, midi }] (쉼표 제외). transpose 반음
export function parseMelody(text, transpose = 0) {
  const events = [];
  let beat = 0;
  for (const part of text.split(/\s+/)) {
    if (!part || part === '|') continue;
    const [name, length = '1'] = part.split(':');
    const dur = Number(length);
    if (!(dur > 0)) throw new Error(`bad length: ${part}`);
    if (name !== 'r') events.push({ beat, dur, midi: noteToMidi(name) + transpose });
    beat += dur;
  }
  return { events, beats: beat };
}

const CHORD_ROOTS = Object.freeze({ C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 });

// 'F#m' → { root: 베이스 MIDI(40~51), tones: 화음 MIDI 3개(55~70) }
export function parseChord(symbol, transpose = 0) {
  const match = /^([A-G](?:#|b)?)(m?)(7?)$/.exec(symbol);
  if (!match) throw new Error(`bad chord: ${symbol}`);
  const pitchClass = ((CHORD_ROOTS[match[1]] + transpose) % 12 + 12) % 12;
  const minor = match[2] === 'm';
  const root = 40 + ((pitchClass - 4 + 12) % 12);
  let base = 55 + ((pitchClass - 7 + 12) % 12);
  const tones = [base, base + (minor ? 3 : 4), base + 7];
  if (match[3]) tones.push(base + (minor ? 10 : 10));
  return { name: symbol, root, tones };
}

// 곡 정의 → 펼친 선율·화음. sections: [{ melody, chords, transpose }] 순서대로 이어 붙인다. O(음표 수)
function buildSong(definition) {
  const melody = [];
  const chords = [];
  let offset = 0;
  for (const section of definition.sections) {
    const parsed = parseMelody(section.melody, section.transpose ?? 0);
    for (const event of parsed.events) melody.push({ ...event, beat: event.beat + offset });
    section.chords.forEach((bar, barIndex) => {
      const parts = bar.split(/\s+/).filter(Boolean);
      parts.forEach((symbol, partIndex) => {
        chords.push({ beat: offset + barIndex * definition.beatsPerBar + partIndex * definition.beatsPerBar / parts.length, chord: parseChord(symbol, section.transpose ?? 0) });
      });
    });
    offset += parsed.beats;
  }
  return Object.freeze({ ...definition, melody: Object.freeze(melody), chords: Object.freeze(chords), totalBeats: offset });
}

const repeat = (section, times, transposes = []) => Array.from({ length: times }, (_, index) => ({ ...section, transpose: transposes[index] ?? section.transpose ?? 0 }));

// ---------- 곡 ----------
const TWINKLE = {
  melody: `C5 C5 G5 G5 | A5 A5 G5:2 | F5 F5 E5 E5 | D5 D5 C5:2 | G5 G5 F5 F5 | E5 E5 D5:2 | G5 G5 F5 F5 | E5 E5 D5:2 |
    C5 C5 G5 G5 | A5 A5 G5:2 | F5 F5 E5 E5 | D5 D5 C5:2`,
  chords: ['C', 'F C', 'F C', 'G C', 'C F', 'C G', 'C F', 'C G', 'C', 'F C', 'F C', 'G C']
};

// 징글벨(피어폰트, 1857): 절 + 후렴
const JINGLE_BELLS = {
  melody: `G4 E5 D5 C5 | G4:3 G4:0.5 G4:0.5 | G4 E5 D5 C5 | A4:4 | A4 F5 E5 D5 | B4:4 | G5 G5 F5 D5 | E5:4 |
    G4 E5 D5 C5 | G4:4 | G4 E5 D5 C5 | A4:3 A4 | A4 F5 E5 D5 | G5 G5 G5 G5 | A5 G5 F5 D5 | C5:2 G5:2 |
    E5 E5 E5:2 | E5 E5 E5:2 | E5 G5 C5:1.5 D5:0.5 | E5:4 | F5 F5 F5:1.5 F5:0.5 | F5 E5 E5 E5:0.5 E5:0.5 | E5 D5 D5 E5 | D5:2 G5:2 |
    E5 E5 E5:2 | E5 E5 E5:2 | E5 G5 C5:1.5 D5:0.5 | E5:4 | F5 F5 F5 F5 | F5 E5 E5 E5:0.5 E5:0.5 | G5 G5 F5 D5 | C5:4`,
  chords: ['C', 'C', 'C', 'F', 'F', 'G', 'G', 'C', 'C', 'C', 'C', 'F', 'F', 'G', 'G', 'C G',
    'C', 'C', 'C', 'C', 'F', 'C', 'D', 'G', 'C', 'C', 'C', 'C', 'F', 'C', 'G', 'C']
};

// 고요한 밤(그루버, 1818). 6/8: 8분음표 = 1박
const SILENT_NIGHT = {
  melody: `G4:3 A4 G4:2 | E4:6 | G4:3 A4 G4:2 | E4:6 | D5:4 D5:2 | B4:6 | C5:4 C5:2 | G4:6 |
    A4:4 A4:2 | C5:3 B4 A4:2 | G4:3 A4 G4:2 | E4:6 | A4:4 A4:2 | C5:3 B4 A4:2 | G4:3 A4 G4:2 | E4:6 |
    D5:4 D5:2 | F5:3 D5 B4:2 | C5:6 | E5:6 | C5:2 G4:2 E4:2 | G4:3 F4 D4:2 | C4:12`,
  chords: ['C', 'C', 'C', 'C', 'G', 'G', 'C', 'C', 'F', 'F', 'C', 'C', 'F', 'F', 'C', 'C', 'G', 'G', 'C', 'C', 'C', 'G', 'C', 'C']
};

// 스와니 강(포스터, 1851) 첫 절
const SWANEE = {
  melody: `E5:1.5 D5:0.5 C5:0.5 E5:0.5 D5:0.5 C5:0.5 | C6 A5 C6 G5 | E5:2 C5 D5 | D5:4 |
    E5:1.5 D5:0.5 C5:0.5 E5:0.5 D5:0.5 C5:0.5 | C6 A5 C6 G5 | E5:1.5 C5:0.5 D5 D5 | C5:4`,
  chords: ['C', 'F C', 'C', 'G', 'C', 'F C', 'C G', 'C']
};

// 코로부시카(러시아 민요, 원곡 선율)
const KOROBEINIKI = {
  melody: `E5 B4:0.5 C5:0.5 D5 C5:0.5 B4:0.5 | A4 A4:0.5 C5:0.5 E5 D5:0.5 C5:0.5 | B4:1.5 C5:0.5 D5 E5 | C5 A4 A4:2 |
    D5:1.5 F5:0.5 A5 G5:0.5 F5:0.5 | E5:1.5 C5:0.5 E5 D5:0.5 C5:0.5 | B4 B4:0.5 C5:0.5 D5 E5 | C5 A4 A4:2`,
  chords: ['Am E', 'Am', 'E', 'Am', 'Dm', 'C', 'E', 'Am']
};

// 윌리엄 텔 서곡 피날레(로시니, 1829)의 질주 주제
const WILLIAM_TELL = {
  melody: `G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 G4:0.5 | G4:0.25 G4:0.25 C5:0.5 D5:0.5 E5:0.5 |
    G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 G4:0.5 | G4:0.25 C5:0.25 E5:0.5 D5:0.5 B4:0.25 G4:0.25 |
    G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 G4:0.5 | G4:0.25 G4:0.25 C5:0.5 D5:0.5 E5:0.5 |
    G4:0.25 C5:0.25 E5:0.5 G5:0.5 E5:0.5 | D5:0.5 B4:0.5 C5`,
  chords: ['C', 'C', 'C', 'G', 'C', 'C', 'C', 'G C']
};

// 왕벌의 비행(림스키코르사코프, 1900): 반음계 하강 도입 + 주제
const S = '0.25';
const run = notes => notes.split(' ').map(note => `${note}:${S}`).join(' ');
const BUMBLEBEE = {
  melody: [
    'E6 D#6 D6 C#6 D6 C#6 C6 B5', 'C6 B5 A#5 A5 G#5 G5 F#5 F5', 'E5 D#5 D5 C#5 D5 C#5 C5 B4', 'C5 B4 A#4 A4 G#4 G4 F#4 F4',
    'A4 G#4 G4 F#4 F4 A#4 A4 G#4', 'A4 G#4 G4 F#4 F4 F#4 G4 G#4', 'A4 G#4 G4 F#4 F4 A#4 A4 G#4', 'A4 G#4 G4 F#4 F4 F#4 G4 G#4',
    'D5 C#5 C5 B4 A#4 D#5 D5 C#5', 'D5 C#5 C5 B4 A#4 B4 C5 C#5', 'D5 C#5 C5 B4 A#4 D#5 D5 C#5', 'D5 C#5 C5 B4 A#4 B4 C5 C#5',
    'A4 G#4 G4 F#4 F4 A#4 A4 G#4', 'A4 G#4 G4 F#4 F4 F#4 G4 G#4', 'A4 B4 C5 D5 E5 F5 G#5 A5'
  ].map(run).join(' | ') + ' | A5:2',
  chords: ['E', 'E', 'E', 'E', 'Am', 'Am', 'Am', 'Am', 'Dm', 'Dm', 'Dm', 'Dm', 'Am', 'Am', 'E', 'Am']
};

// 아름답고 푸른 도나우(요한 슈트라우스 2세, 1866) 첫 왈츠 주제
const BLUE_DANUBE = {
  melody: `D4 D4 F#4 | A4:3 | r A5 A5 | r F#5 F#5 | D4 D4 F#4 | A4:3 | r A5 A5 | r G5 G5 |
    C#4 C#4 E4 | B4:3 | r B5 B5 | r G5 G5 | C#4 C#4 E4 | B4:3 | r B5 B5 | r F#5 F#5 |
    D4 D4 F#4 | A4 D5:2 | r D6 D6 | r A5 A5 | D4 D4 F#4 | A4 D5:2 | r D6 D6 | r B5 B5 |
    E4 E4 G4 | B4:3 | B4:2 G#4 | A4 F#5:2 | D5 F#4 F#4 | E4:2 B4 | A4 D4 D4 | D4:3`,
  chords: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'D',
    'D', 'D', 'D', 'D', 'D', 'D', 'D', 'G', 'G', 'G', 'E', 'D', 'D', 'A', 'D', 'D']
};

const NACHTMUSIK = {
  melody: `G4 r:0.5 D4:0.5 G4 r:0.5 D4:0.5 | G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 | C5 r:0.5 A4:0.5 C5 r:0.5 A4:0.5 | C5:0.5 A4:0.5 F#4:0.5 A4:0.5 D4:2 |
    G4 r:0.5 D4:0.5 G4 r:0.5 D4:0.5 | G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 | C5 r:0.5 A4:0.5 C5 r:0.5 A4:0.5 | C5:0.5 A4:0.5 F#4:0.5 A4:0.5 G4:0.5 B4:0.5 D5:0.5 G5:0.5`,
  chords: ['G', 'G', 'D', 'D', 'G', 'G', 'D', 'D G']
};

const CAN_CAN = {
  melody: `G4 A4:0.5 C5:0.5 | B4:0.5 A4:0.5 D5 | D5 D5:0.5 E5:0.5 | B4:0.5 C5:0.5 A4 | A4 A4:0.5 C5:0.5 | B4:0.5 A4:0.5 G4:0.5 G5:0.5 | F#5:0.5 E5:0.5 D5:0.5 C5:0.5 | B4:0.5 A4:0.5 G4 |
    G4 A4:0.5 C5:0.5 | B4:0.5 A4:0.5 D5 | D5 D5:0.5 E5:0.5 | B4:0.5 C5:0.5 A4 | A4 A4:0.5 C5:0.5 | B4:0.5 A4:0.5 G4:0.5 D5:0.5 | B4:0.5 A4:0.5 G4 | G4 r`,
  chords: ['G', 'D', 'D', 'D', 'D', 'G', 'D', 'G', 'G', 'D', 'D', 'D', 'D', 'G', 'D G', 'G']
};

// 원래 게임 반주(Am–F–C–G)에 맞춘 아르페지오 선율
const BEAT_COMPILER = {
  melody: `A4:0.5 C5:0.5 E5:0.5 C5:0.5 A5:0.5 E5:0.5 C5:0.5 E5:0.5 | F4:0.5 A4:0.5 C5:0.5 A4:0.5 F5:0.5 C5:0.5 A4:0.5 C5:0.5 |
    C5:0.5 E5:0.5 G5:0.5 E5:0.5 C6:0.5 G5:0.5 E5:0.5 G5:0.5 | G4:0.5 B4:0.5 D5:0.5 B4:0.5 G5:0.5 D5:0.5 B4:0.5 D5:0.5`,
  chords: ['Am', 'F', 'C', 'G']
};

// MIDI 곡 데이터 → 곡 객체. [간격, 길이, 음높이] 반복(단위 1/steps박)을 펼친다. O(음 수)
function decodeNotes(flat, steps) {
  const notes = [];
  let step = 0;
  for (let index = 0; index + 2 < flat.length; index += 3) {
    step += flat[index];
    notes.push(Object.freeze({ beat: step / steps, dur: flat[index + 1] / steps, midi: flat[index + 2] }));
  }
  return Object.freeze(notes);
}

function buildMidiSong(data) {
  const { melody, accompaniment, chords, steps, beats, ...meta } = data;
  const chordEntries = chords.flatMap((bar, barIndex) => {
    const parts = bar.split(/\s+/).filter(Boolean);
    return parts.map((symbol, partIndex) => ({ beat: barIndex * meta.beatsPerBar + partIndex * meta.beatsPerBar / parts.length, chord: parseChord(symbol) }));
  });
  return Object.freeze({ ...meta, melody: decodeNotes(melody, steps), accompaniment: decodeNotes(accompaniment, steps), chords: Object.freeze(chordEntries), totalBeats: beats });
}
const MIDI_SONGS = new Map(MIDI_SONG_DATA.map(data => [data.id, buildMidiSong(data)]));
const midiSong = id => {
  const song = MIDI_SONGS.get(id);
  if (!song) throw new Error(`missing MIDI song: ${id}`);
  return song;
};

// style: 반주 스타일(rhythm-music.js). bpm은 1박 기준(3/8 곡은 8분음표 = 1박)
const TRANSCRIBED = '이 프로젝트에서 직접 채보';
export const RHYTHM_SONGS = Object.freeze([
  buildSong({ id: 'twinkle', title: '작은 별', composer: '프랑스 민요 · 모차르트 변주곡 K.265', died: 1791, bpm: 112, beatsPerBar: 4, style: 'gentle', source: TRANSCRIBED, sections: repeat(TWINKLE, 3, [0, 0, 5]) }),
  midiSong('brahms-lullaby'),
  buildSong({ id: 'silent-night', title: '고요한 밤', composer: '그루버 · 1818', died: 1863, bpm: 150, beatsPerBar: 6, style: 'lullaby', source: TRANSCRIBED, sections: repeat(SILENT_NIGHT, 2, [0, 2]) }),
  midiSong('ode-to-joy'),
  buildSong({ id: 'swanee-river', title: '스와니 강', composer: '포스터 · 1851', died: 1864, bpm: 100, beatsPerBar: 4, style: 'gentle', source: TRANSCRIBED, sections: repeat(SWANEE, 4, [0, 0, 5, 0]) }),
  midiSong('abt-vocalise'),
  midiSong('minuit-chretiens'),
  midiSong('bach-chorale'),
  buildSong({ id: 'jingle-bells', title: '징글벨', composer: '피어폰트 · 1857', died: 1893, bpm: 132, beatsPerBar: 4, style: 'pop', source: TRANSCRIBED, sections: repeat(JINGLE_BELLS, 2, [0, 2]) }),
  midiSong('canon'),
  midiSong('clair-de-lune'),
  midiSong('pathetique'),
  midiSong('fur-elise'),
  buildSong({ id: 'blue-danube', title: '아름답고 푸른 도나우', composer: '요한 슈트라우스 2세 · Op.314', died: 1899, bpm: 176, beatsPerBar: 3, style: 'waltz', source: TRANSCRIBED, sections: repeat(BLUE_DANUBE, 3, [0, 0, 5]) }),
  buildSong({ id: 'nachtmusik', title: '아이네 클라이네 나흐트무지크', composer: '모차르트 · K.525', died: 1791, bpm: 132, beatsPerBar: 4, style: 'classic', source: TRANSCRIBED, sections: repeat(NACHTMUSIK, 4, [0, 0, 12, 12]) }),
  buildSong({ id: 'korobeiniki', title: '코로부시카', composer: '러시아 민요', died: null, bpm: 140, beatsPerBar: 4, style: 'drive', source: TRANSCRIBED, sections: repeat(KOROBEINIKI, 6, [0, 0, 5, 5, 0, 0]) }),
  buildSong({ id: 'beat-compiler', title: 'beat-compiler.wav', composer: 'TYPE//CODE 오리지널', died: null, bpm: 128, beatsPerBar: 4, style: 'pop', source: TRANSCRIBED, sections: repeat(BEAT_COMPILER, 9) }),
  midiSong('beethoven-menuetto'),
  midiSong('bach-bourree'),
  midiSong('greensleeves'),
  midiSong('entertainer'),
  midiSong('maple-leaf'),
  midiSong('elite-syncopations'),
  midiSong('turkish-march'),
  midiSong('mountain-king'),
  buildSong({ id: 'can-can', title: '지옥의 갤럽 (캉캉)', composer: '오펜바흐 · 지옥의 오르페', died: 1880, bpm: 150, beatsPerBar: 2, style: 'galop', source: TRANSCRIBED, sections: repeat(CAN_CAN, 5, [0, 0, 5, 5, 0]) }),
  buildSong({ id: 'william-tell', title: '윌리엄 텔 서곡', composer: '로시니 · 피날레', died: 1868, bpm: 152, beatsPerBar: 2, style: 'galop', source: TRANSCRIBED, sections: repeat(WILLIAM_TELL, 12, [0, 0, 5, 5, 0, 0, 7, 7, 0, 0, 5, 0]) }),
  midiSong('barbella-sonata'),
  midiSong('giuliani-allegro'),
  midiSong('toccata-fugue'),
  buildSong({ id: 'bumblebee', title: '왕벌의 비행', composer: '림스키코르사코프 · 살탄 황제 이야기', died: 1908, bpm: 116, beatsPerBar: 2, style: 'drive', source: TRANSCRIBED, sections: repeat(BUMBLEBEE, 4, [0, 0, 2, 0]) })
]);

export const SONG_BY_ID = new Map(RHYTHM_SONGS.map(song => [song.id, song]));
export const DEFAULT_SONG_ID = 'ode-to-joy';
export const getSong = id => SONG_BY_ID.get(id) ?? SONG_BY_ID.get(DEFAULT_SONG_ID);

// 난이도: 키를 칠 노트 사이 최소 간격(초), 낱말 사이 쉼(초), 낱말 최대 길이, 노트가 떨어지는 시간(초), 칠 수 있는 박 위치(1 = 정박만)
export const RHYTHM_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ label: 'EASY', color: '#39ff88', minGap: 0.8, wordRest: 1.4, maxLength: 4, fallSeconds: 2.6, grid: 1 }),
  normal: Object.freeze({ label: 'NORMAL', color: '#36e2ff', minGap: 0.5, wordRest: 1.0, maxLength: 6, fallSeconds: 2.2, grid: 0.5 }),
  hard: Object.freeze({ label: 'HARD', color: '#ffb547', minGap: 0.32, wordRest: 0.7, maxLength: 7, fallSeconds: 1.8, grid: 0.5 }),
  expert: Object.freeze({ label: 'EXPERT', color: '#ff4d6d', minGap: 0.2, wordRest: 0.5, maxLength: 9, fallSeconds: 1.5, grid: 0.25 })
});
export const DIFFICULTY_ORDER = Object.freeze(Object.keys(RHYTHM_DIFFICULTIES));
