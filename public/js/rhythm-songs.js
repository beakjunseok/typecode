// 리듬 모드 곡 목록. 모두 작곡가 사후 70년이 지난 공개 도메인 곡의 주제 선율을 이 프로젝트에서 직접 음표로 옮긴 것이다
// (외부 MIDI 파일·편곡을 쓰지 않음). 반주는 곡마다 고른 스타일로 실시간 합성한다.
// 선율 표기: "음이름옥타브:길이(박)" 공백 구분, 쉼표는 "r:길이", 길이 생략 시 1박. 마디 구분 "|"는 읽기용(무시).
// 화음 표기: 마디마다 하나, 한 마디에 둘 이상이면 공백으로 나눠 마디를 균등 분할. 예) 'C', 'F C', 'Am'

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

const ODE = {
  melody: `E5 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | E5:1.5 D5:0.5 D5:2 |
    E5 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | D5:1.5 C5:0.5 C5:2 |
    D5 D5 E5 C5 | D5 E5:0.5 F5:0.5 E5 C5 | D5 E5:0.5 F5:0.5 E5 D5 | C5 D5 G4:2 |
    E5 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | D5:1.5 C5:0.5 C5:2`,
  chords: ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'G C', 'G C', 'G C', 'G C', 'C G', 'C', 'G', 'C', 'G C']
};

// 3/8: 8분음표 = 1박
const FUR_ELISE_A = {
  melody: `r:2 E5:0.5 D#5:0.5 |
    E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4 r:0.5 C4:0.5 E4:0.5 A4:0.5 | B4 r:0.5 E4:0.5 G#4:0.5 B4:0.5 | C5 r:0.5 E4:0.5 E5:0.5 D#5:0.5 |
    E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4 r:0.5 C4:0.5 E4:0.5 A4:0.5 | B4 r:0.5 E4:0.5 C5:0.5 B4:0.5 | A4:2 r:1`,
  chords: ['Am', 'Am', 'Am', 'E', 'Am', 'Am', 'Am', 'E', 'Am']
};
const FUR_ELISE_B = {
  melody: `A4 r:0.5 B4:0.5 C5:0.5 D5:0.5 | E5:1.5 G4:0.5 F5:0.5 E5:0.5 | D5:1.5 F4:0.5 E5:0.5 D5:0.5 | C5:1.5 E4:0.5 D5:0.5 C5:0.5 | B4 r:0.5 E4:0.5 E5:0.5 r:0.5`,
  chords: ['Am', 'C', 'G', 'Am', 'E']
};

const NACHTMUSIK = {
  melody: `G4 r:0.5 D4:0.5 G4 r:0.5 D4:0.5 | G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 | C5 r:0.5 A4:0.5 C5 r:0.5 A4:0.5 | C5:0.5 A4:0.5 F#4:0.5 A4:0.5 D4:2 |
    G4 r:0.5 D4:0.5 G4 r:0.5 D4:0.5 | G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 | C5 r:0.5 A4:0.5 C5 r:0.5 A4:0.5 | C5:0.5 A4:0.5 F#4:0.5 A4:0.5 G4:0.5 B4:0.5 D5:0.5 G5:0.5`,
  chords: ['G', 'G', 'D', 'D', 'G', 'G', 'D', 'D G']
};

const MOUNTAIN_KING = {
  melody: `B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4 | F4:0.5 C#4:0.5 F4 E4:0.5 C4:0.5 E4 |
    B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:0.5 B4:0.5 | A4:0.5 F#4:0.5 D4:0.5 F#4:0.5 A4:2`,
  chords: ['Bm', 'C# C', 'Bm', 'D']
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

// style: 반주 스타일(rhythm-music.js). bpm은 1박 기준(3/8 곡은 8분음표 = 1박)
export const RHYTHM_SONGS = Object.freeze([
  buildSong({ id: 'twinkle', title: '작은 별', composer: '프랑스 민요 · 모차르트 변주곡 K.265', died: 1791, bpm: 112, beatsPerBar: 4, style: 'gentle', sections: repeat(TWINKLE, 3, [0, 0, 5]) }),
  buildSong({ id: 'ode-to-joy', title: '환희의 송가', composer: '베토벤 · 교향곡 9번', died: 1827, bpm: 120, beatsPerBar: 4, style: 'gentle', sections: repeat(ODE, 2, [0, 2]) }),
  buildSong({ id: 'fur-elise', title: '엘리제를 위하여', composer: '베토벤 · WoO 59', died: 1827, bpm: 150, beatsPerBar: 3, style: 'waltz', sections: [FUR_ELISE_A, FUR_ELISE_B, FUR_ELISE_A, FUR_ELISE_B, FUR_ELISE_A, FUR_ELISE_B, FUR_ELISE_A] }),
  buildSong({ id: 'nachtmusik', title: '아이네 클라이네 나흐트무지크', composer: '모차르트 · K.525', died: 1791, bpm: 132, beatsPerBar: 4, style: 'classic', sections: repeat(NACHTMUSIK, 4, [0, 0, 12, 12]) }),
  buildSong({ id: 'beat-compiler', title: 'beat-compiler.wav', composer: 'TYPE//CODE 오리지널', died: null, bpm: 128, beatsPerBar: 4, style: 'pop', sections: repeat(BEAT_COMPILER, 9) }),
  buildSong({ id: 'mountain-king', title: '산왕의 궁전에서', composer: '그리그 · 페르 귄트 Op.46', died: 1907, bpm: 138, beatsPerBar: 4, style: 'drive', sections: repeat(MOUNTAIN_KING, 8, [0, 0, 7, 7, 12, 12, 7, 12]) }),
  buildSong({ id: 'can-can', title: '지옥의 갤럽 (캉캉)', composer: '오펜바흐 · 지옥의 오르페', died: 1880, bpm: 150, beatsPerBar: 2, style: 'galop', sections: repeat(CAN_CAN, 5, [0, 0, 5, 5, 0]) })
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
