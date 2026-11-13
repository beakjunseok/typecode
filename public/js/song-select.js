// 리듬 모드 곡 선택 화면(DOM). 왼쪽 곡 목록, 오른쪽 고른 곡의 정보·난이도 칩·최고 기록.
// 상태는 main.js가 들고 있고, 이 모듈은 받은 상태를 그리기만 한다. 클릭은 data-song / data-difficulty로 위임 처리.
import { RHYTHM_SONGS, RHYTHM_DIFFICULTIES, DIFFICULTY_ORDER, getSong } from './rhythm-songs.js';

const RANK_ORDER = Object.freeze(['S', 'A', 'B', 'C', 'D', 'F']);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 곡 길이(카운트인 제외) → m:ss
export function songLength(song) {
  const seconds = Math.round(song.totalBeats * 60 / song.bpm);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// 목록 이동: 끝에서 반대쪽 끝으로 돈다
export function stepSong(songId, delta) {
  const index = Math.max(0, RHYTHM_SONGS.findIndex(song => song.id === songId));
  return RHYTHM_SONGS[(index + delta + RHYTHM_SONGS.length) % RHYTHM_SONGS.length].id;
}

// 난이도 이동: 끝에서 멈춘다
export function stepDifficulty(difficulty, delta) {
  const index = Math.max(0, DIFFICULTY_ORDER.indexOf(difficulty));
  return DIFFICULTY_ORDER[Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, index + delta))];
}

// 곡의 모든 난이도 기록 중 가장 좋은 랭크(목록 오른쪽 배지)
function bestRankOfSong(songId, bestOf) {
  let best = null;
  for (const difficulty of DIFFICULTY_ORDER) {
    const rank = bestOf(songId, difficulty)?.rank;
    if (rank && (best === null || RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(best))) best = rank;
  }
  return best;
}

function renderList(list, { songId, difficulty, levelOf, bestOf }) {
  const rows = RHYTHM_SONGS.map(song => {
    const row = element('li', `song-row${song.id === songId ? ' selected' : ''}`);
    row.dataset.song = song.id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(song.id === songId));
    const text = element('div', 'song-text');
    text.append(element('span', 'song-title', song.title), element('span', 'song-composer', song.composer));
    const level = element('span', 'song-level', String(levelOf(song.id, difficulty)));
    level.style.color = RHYTHM_DIFFICULTIES[difficulty].color;
    level.title = `${RHYTHM_DIFFICULTIES[difficulty].label} 레벨`;
    const rank = bestRankOfSong(song.id, bestOf);
    const badge = element('span', `song-rank${rank ? ` rank-${rank}` : ''}`, rank ?? '–');
    badge.title = rank ? '이 곡 최고 랭크' : '아직 기록 없음';
    row.append(level, text, badge);
    return row;
  });
  list.replaceChildren(...rows);
  list.querySelector('.selected')?.scrollIntoView?.({ block: 'nearest' });
}

function renderDetail(detail, { songId, difficulty, focused, levelOf, bestOf }) {
  const song = getSong(songId);
  const title = element('h3', 'song-detail-title', song.title);
  const meta = element('p', 'song-detail-meta', `${song.composer}${song.died ? ` (†${song.died})` : ''}`);
  const facts = element('dl', 'song-facts');
  for (const [label, value] of [['BPM', song.bpm], ['길이', songLength(song)], ['박자', `${song.beatsPerBar}/4`]]) {
    const item = element('div');
    item.append(element('dt', '', label), element('dd', '', String(value)));
    facts.append(item);
  }
  const chips = element('div', 'difficulty-chips');
  chips.setAttribute('role', 'radiogroup');
  chips.setAttribute('aria-label', '난이도');
  for (const key of DIFFICULTY_ORDER) {
    const config = RHYTHM_DIFFICULTIES[key];
    const chip = element('button', `difficulty-chip${key === difficulty ? ' selected' : ''}`);
    chip.type = 'button';
    chip.dataset.difficulty = key;
    chip.style.setProperty('--chip', config.color);
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(key === difficulty));
    chip.append(element('span', 'chip-label', config.label), element('span', 'chip-level', String(levelOf(song.id, key))));
    chips.append(chip);
  }
  const best = bestOf(song.id, difficulty);
  const record = element('p', 'song-record');
  if (best) {
    record.append(element('span', `song-rank rank-${best.rank}`, best.rank), element('span', 'song-record-score', best.score.toLocaleString()));
  } else {
    record.textContent = '이 난이도는 아직 기록이 없어요';
  }
  const start = element('p', 'song-start', focused ? '글자 키를 치면 시작해요' : '여기를 눌러 시작 준비');
  const keys = element('p', 'song-keys', '↑↓ 곡 바꾸기 · ←→ 난이도');
  detail.replaceChildren(title, meta, facts, chips, record, start, keys);
}

// 상태 그대로 다시 그린다. O(곡 수 × 난이도 수)
export function renderSongSelect(root, state) {
  root.hidden = !state.visible;
  if (!state.visible) return;
  renderList(root.querySelector('.song-list'), state);
  renderDetail(root.querySelector('.song-detail'), state);
}
