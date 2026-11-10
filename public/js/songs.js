// BGM 악보. 모두 이 프로젝트를 위해 새로 쓴 곡이다(음원 파일 없음, Web Audio로 실시간 합성).
//
// 표기법
//  chords   : 마디마다 화음(로마 숫자, 조 기준). 대문자=장, 소문자=단, b=반음 내림, maj7/7 접미사.
//  melody   : 마디마다 16칸 문자열. 1~7=음계 음, 8 9 a b c d=한 옥타브 위 1~6, q w e=한 옥타브 아래 5~7,
//             '-'=앞 음 늘이기, '.'=쉼표. 섹션 마디 수보다 짧으면 처음부터 다시 쓴다.
//  bass     : 16칸. R=근음, O=옥타브 위, 5=5도, 3=3도, r=약한 근음, '-'=늘이기, '.'=쉼표.
//  comp     : 화음 반주 { instrument, pattern(16칸 x) } 또는 'pad' / 'arp'.
//  drums    : 곡의 kits 이름. fill=섹션 마지막 마디에 필인, crash=섹션 첫 박에 크래시.
//  form     : 연주 순서. { section, transpose } 로 전조 가능. 끝나면 loopFrom 위치부터 반복.

export const SONGS = {
  // 연습: 퓨처펑크/시티팝 느낌의 밝은 코딩 BGM. 왕도 진행(IV–V–iii–vi).
  practice: {
    title: 'Commit & Push',
    tempo: 120, key: 53, scale: 'major', swing: 0.06,
    kits: {
      funk: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.o.', clap: '................' },
      disco: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '....x.......x...', shaker: 'xxxxxxxxxxxxxxxx' },
      soft: { kick: '................', snare: '................', hat: '..x...x...x...x.' },
      half: { kick: 'x.........x.....', snare: '........x.......', hat: 'x...x...x...x...' },
      build: { kick: 'x...x...x...x...', snare: 'x.x.x.x.xxxxxxxx', hat: '................' }
    },
    fill: { snare: '....x...x.x.xxxx', kick: 'x.....x.........' },
    sections: {
      intro: { bars: 4, chords: ['IVmaj7', 'V', 'iii7', 'vi7'], comp: 'arp', bass: 'R-------R---O---', drums: 'soft', fill: true },
      verse: {
        bars: 8, chords: ['IVmaj7', 'V', 'iii7', 'vi7'], drums: 'funk', bass: 'R..RO.R...R.O.5.',
        comp: { instrument: 'stab', pattern: '..x...x...x..x..' }, lead: 'pluck',
        melody: ['1.1.2.3-.3.2.1..', '2.2.3.4-.4.3.2..', '3.3.4.5-.5.4.3.2', '1---e-1-w-------',
          '1.1.2.3-.3.5.6..', '5.5.4.3-.4.3.2..', '3.3.4.5-.6.5.3.2', '3---2-1-2-------']
      },
      pre: {
        bars: 4, chords: ['ii7', 'iii7', 'IVmaj7', 'V'], drums: 'funk', bass: 'R.R.R.R.R.R.O.O.',
        comp: { instrument: 'stab', pattern: 'x...x...x...x...' }, lead: 'pluck', fill: true,
        melody: ['4.4.4.5.6.6.6.7.', '5.5.5.6.7.7.7.8.', '6.6.7.8.9.9.a.9.', '9-------7-5-2-..']
      },
      chorus: {
        bars: 8, chords: ['IVmaj7', 'V', 'iii7', 'vi7', 'ii7', 'V', 'Imaj7', 'Imaj7'], drums: 'disco', bass: 'R.O.R.O.R.O.R.O.',
        comp: 'pad', lead: 'bright', crash: true, fill: true,
        melody: ['8-.7.8.9-.8.7.5.', '6-.5.6.7-.6.5.3.', '5-.3.5.6-.5.3.2.', '3---2-1-2---....',
          '4-.4.5.6-.6.5.4.', '5-.5.6.7-.7.8.9.', 'a---9-8-9-8-7-8-', '8-------........']
      },
      interlude: {
        bars: 4, chords: ['IVmaj7', 'V', 'iii7', 'vi7'], drums: 'funk', bass: 'R..RO.R...R.O.5.', comp: 'arp', lead: 'bell',
        melody: ['8.8.9.8.7.5.6.5.', '7.7.8.7.6.5.3.5.', '5.5.6.5.3.2.3.5.', '6-------5-------']
      },
      bridge: {
        bars: 8, chords: ['vi7', 'iii7', 'IVmaj7', 'Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V'], drums: 'half', bass: 'R-------5-------',
        comp: 'pad', lead: 'bell', crash: true,
        melody: ['3-----5-----6---', '5-----3-----2---', '4-----6-----8---', '7---------------',
          '3-----5-----8---', '9-----8-----6---', '7-----6-----5---', '5---------------']
      },
      breakdown: { bars: 4, chords: ['IVmaj7', 'V', 'iii7', 'vi7'], drums: 'soft', bass: 'R---------------', comp: 'pad', lead: 'bell', melody: ['8-.7.8.9-.8.7.5.', '6-.5.6.7-.6.5.3.', '5-.3.5.6-.5.3.2.', '3---------------'] },
      build: { bars: 4, chords: ['ii7', 'iii7', 'IVmaj7', 'V'], drums: 'build', bass: 'R.R.R.R.R.R.R.R.', comp: 'arp' },
      outro: { bars: 4, chords: ['IVmaj7', 'V', 'Imaj7', 'Imaj7'], drums: 'soft', bass: 'R-------R-------', comp: 'pad', lead: 'bell', melody: ['a---9-8-9-8-7-8-', '9---8---7---5---', '8---------------', '................'] }
    },
    form: ['intro', 'verse', 'pre', 'chorus', 'interlude', 'verse', 'pre', 'chorus', 'bridge', 'breakdown', 'build',
      { section: 'chorus', transpose: 1 }, { section: 'outro', transpose: 1 }],
    loopFrom: 1
  },

  // 휴대폰 던지기: 칩튠 액션. A단조, 질주하는 16분 아르페지오와 큰 후렴 훅.
  throw: {
    title: 'Robot Rush',
    tempo: 150, key: 57, scale: 'minor', swing: 0,
    kits: {
      rock: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      drive: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', clap: '....x.......x...' },
      half: { kick: 'x.......x.......', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
      none: { hat: '..x...x...x...x.' },
      build: { kick: 'x...x...x...x...', snare: 'x.x.x.x.xxxxxxxx' }
    },
    fill: { snare: '........xxxxxxxx', kick: 'x...x...........' },
    sections: {
      intro: { bars: 4, chords: ['i', 'bVI', 'bIII', 'bVII'], comp: 'arp', bass: 'R.......R.......', drums: 'none', fill: true },
      verse: {
        bars: 8, chords: ['i', 'bVI', 'bIII', 'bVII'], drums: 'rock', bass: 'R.R.O.R.R.R.O.R.', comp: 'arp', lead: 'chip',
        melody: ['1.3.5.8.7.5.3.5.', '6.8.a.8.6.5.3.1.', '3.5.7.9.8.7.5.3.', '2.4.7.9-.7.5.4.2',
          '1.3.5.8.7.5.3.5.', '6.8.a.8.6.5.3.1.', '3.5.7.9.8.7.5.3.', '7.9.b.9.7.5.4.2.']
      },
      pre: {
        bars: 8, chords: ['iv', 'i', 'bVII', 'bIII', 'iv', 'i', 'V', 'V'], drums: 'rock', bass: 'R.R.R.R.O.O.O.O.',
        comp: { instrument: 'chipStab', pattern: 'x..x..x...x..x..' }, lead: 'chip', fill: true,
        melody: ['4--5--6-8---6-5-', '5--3--1-3-------', '4--5--7-9---7-5-', '8-------7-5-3-..',
          '4--5--6-8---a-9-', '8--5--3-5---8---', '5---5-6-7---5---', '5---------------']
      },
      chorus: {
        bars: 8, chords: ['i', 'bVII', 'bVI', 'bVII', 'i', 'bVII', 'bVI', 'V'], drums: 'drive', bass: 'RORORORORORORORO',
        comp: 'arp', lead: 'chipBright', crash: true, fill: true,
        melody: ['8-8-a-8-9---8-5-', '7-7-9-7-8---7-4-', '6-6-8-6-7---6-3-', '7-------9---b---',
          '8-8-a-8-9---8-5-', '7-7-9-7-b---a-9-', '8---a---c---b---', 'a-----9-----8---']
      },
      bridge: {
        bars: 8, chords: ['iv', 'v', 'bVI', 'bVII'], drums: 'half', bass: 'R-------R-------', comp: 'pad', lead: 'chip', crash: true,
        melody: ['4-------6-------', '5-------7-------', '6-------8-------', '7-------9-------',
          '8-------a-------', '9-------b-------', 'a-------c-------', 'b-------9-------']
      },
      breakdown: { bars: 4, chords: ['i', 'bVI', 'bIII', 'bVII'], drums: 'none', bass: '................', comp: 'arp' },
      build: { bars: 4, chords: ['iv', 'v', 'bVI', 'V'], drums: 'build', bass: 'R.R.R.R.R.R.R.R.', comp: 'arp', lead: 'chip', melody: ['5.5.5.5.5.5.5.5.', '7.7.7.7.7.7.7.7.', '8.8.8.8.8.8.8.8.', '9.9.9.9.99999999'] },
      outro: { bars: 4, chords: ['i', 'bVII', 'bVI', 'V'], drums: 'rock', bass: 'R.R.O.R.R.R.O.R.', comp: 'arp', lead: 'chipBright', melody: ['8-8-a-8-9---8-5-', '7-7-9-7-8---7-4-', '8---------------', '................'] }
    },
    form: ['intro', 'verse', 'pre', 'chorus', 'verse', 'pre', 'chorus', 'bridge', 'breakdown', 'build',
      { section: 'chorus', transpose: 2 }, { section: 'chorus', transpose: 2 }, { section: 'outro', transpose: 2 }],
    loopFrom: 1
  },

  // 배터리 구조 SOS: 일렉트로 레이싱. D단조, 오프비트 신스 리드와 점점 차오르는 후렴.
  battery: {
    title: 'Full Charge',
    tempo: 138, key: 50, scale: 'minor', swing: 0,
    kits: {
      break: { kick: 'x.........x.....', snare: '....x.......x..x', hat: 'x.xxx.xxx.xxx.xx' },
      four: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '....x.......x...', shaker: 'x.x.x.x.x.x.x.x.' },
      half: { kick: 'x.......x.......', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
      pulse: { kick: 'x...............', hat: 'x.x.x.x.x.x.x.x.' },
      build: { kick: 'x...x...x...x...', snare: 'x.x.x.x.xxxxxxxx' }
    },
    fill: { snare: '....x.x.xxx.xxxx', kick: 'x.........x.....' },
    sections: {
      intro: { bars: 4, chords: ['i', 'bVI', 'bIII', 'bVII'], comp: 'arp', bass: 'R.R.R.R.R.R.R.R.', drums: 'pulse', ping: true, fill: true },
      verse: {
        bars: 8, chords: ['i', 'bVI', 'bIII', 'bVII'], drums: 'break', bass: 'R.RR.R.RR.R.RR.O', comp: { instrument: 'stab', pattern: '..x...x...x...x.' },
        lead: 'saw',
        melody: ['.5.5.8.5.7.5.3.5', '.6.6.8.6.a.8.6.5', '.3.3.5.3.7.5.3.1', '2-4-5-7-9-------',
          '.5.5.8.5.7.5.3.5', '.6.6.8.6.a.8.6.5', '.3.3.5.7.9.7.5.3', '2-4-5-7-5-------']
      },
      pre: {
        bars: 8, chords: ['iv', 'bVI', 'i', 'V'], drums: 'break', bass: 'R.R.R.R.O.O.O.O.', comp: 'pad', lead: 'saw', fill: true,
        melody: ['4---5---6---8---', '6---5---4---3---', '5---6---8---9---', '9-------7---5---',
          '4---5---6---8---', '6---8---a---8---', '9---a---b---c---', 'c-------9-------']
      },
      chorus: {
        bars: 8, chords: ['bVI', 'bVII', 'i', 'i', 'bVI', 'bVII', 'bIII', 'V'], drums: 'four', bass: 'RORORORORORORORO',
        comp: 'pad', lead: 'sawBright', crash: true, fill: true,
        melody: ['8-a-8-6-8---a---', '9-b-9-7-9---b---', 'c---a---8---a---', 'c-------........',
          '8-a-8-6-8---a---', '9-b-9-7-9---c---', 'c-a-c-d-c---a---', '9-------8---9---']
      },
      bridge: {
        bars: 8, chords: ['i', 'bVII', 'bVI', 'V'], drums: 'half', bass: 'R-------R---R---', comp: 'pad', lead: 'bell', crash: true,
        melody: ['5-------3-------', '4-------7-------', '6-------5-------', '9-------........',
          '8-------a-------', '9-------b-------', 'a-------8-------', '9---------------']
      },
      breakdown: { bars: 4, chords: ['i', 'bVI', 'bIII', 'bVII'], drums: 'pulse', bass: '................', comp: 'arp', ping: true },
      build: { bars: 4, chords: ['iv', 'bVI', 'bVII', 'V'], drums: 'build', bass: 'R.R.R.R.R.R.R.R.', comp: 'arp', lead: 'saw', melody: ['4.4.4.4.4.4.4.4.', '6.6.6.6.6.6.6.6.', '7.7.7.7.7.7.7.7.', '9.9.9.9.99999999'] },
      outro: { bars: 4, chords: ['bVI', 'bVII', 'i', 'i'], drums: 'break', bass: 'R.RR.R.RR.R.RR.O', comp: 'arp', lead: 'sawBright', melody: ['8-a-8-6-8---a---', '9-b-9-7-9---b---', 'c---------------', '................'] }
    },
    form: ['intro', 'verse', 'pre', 'chorus', 'verse', 'pre', 'chorus', 'bridge', 'breakdown', 'build',
      { section: 'chorus', transpose: 1 }, { section: 'outro', transpose: 1 }],
    loopFrom: 1
  }
};

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const NUMERALS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const QUALITY_TONES = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10], min7: [0, 3, 7, 10] };
const DEGREE_CHARACTERS = {
  q: [4, -1], w: [5, -1], e: [6, -1],
  1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [3, 0], 5: [4, 0], 6: [5, 0], 7: [6, 0],
  8: [0, 1], 9: [1, 1], a: [2, 1], b: [3, 1], c: [4, 1], d: [5, 1]
};

// 'bVImaj7' → { semitones: 8, tones: [0,4,7,11] }. 단조 곡도 으뜸음 기준 반음 수로 계산한다.
export function parseChord(symbol) {
  const match = /^(b|#)?(vii|vi|v|iv|iii|ii|i|VII|VI|V|IV|III|II|I)(maj7|7)?$/.exec(symbol);
  if (!match) throw new Error(`잘못된 화음 표기: ${symbol}`);
  const [, accidental, numeral, suffix] = match;
  const index = NUMERALS.indexOf(numeral.toLowerCase());
  const semitones = MAJOR_STEPS[index] + (accidental === 'b' ? -1 : accidental === '#' ? 1 : 0);
  const major = numeral === numeral.toUpperCase();
  const quality = suffix === 'maj7' ? 'maj7' : suffix === '7' ? (major ? 'dom7' : 'min7') : major ? 'maj' : 'min';
  return { semitones, tones: QUALITY_TONES[quality] };
}

export function melodyNote(song, character, transpose = 0) {
  const degree = DEGREE_CHARACTERS[character];
  if (!degree) return null;
  const [index, octave] = degree;
  return song.key + 12 + octave * 12 + SCALES[song.scale][index] + transpose;
}

export function songBars(song) {
  return song.form.reduce((sum, entry) => sum + song.sections[typeof entry === 'string' ? entry : entry.section].bars, 0);
}

export function songSeconds(song) {
  return (songBars(song) * 4 * 60) / song.tempo;
}

// 곡 전체를 마디 목록으로 펼친다: [{ section, name, barInSection, transpose }]. O(마디 수)
export function expandForm(song) {
  const bars = [];
  for (const entry of song.form) {
    const name = typeof entry === 'string' ? entry : entry.section;
    const transpose = typeof entry === 'string' ? 0 : entry.transpose ?? 0;
    const section = song.sections[name];
    for (let bar = 0; bar < section.bars; bar++) bars.push({ section, name, barInSection: bar, transpose });
  }
  return bars;
}
