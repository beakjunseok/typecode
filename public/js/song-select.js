// 리듬 모드 곡 선택 화면(DOM). 왼쪽 곡 목록, 오른쪽 고른 곡의 정보·난이도 칩·최고 기록.
// 상태는 main.js가 들고 있고, 이 모듈은 받은 상태를 그리기만 한다. 클릭은 data-song / data-difficulty로 위임 처리.
import { RHYTHM_SONGS, RHYTHM_DIFFICULTIES, DIFFICULTY_ORDER, getSong } from './rhythm-songs.js';
import { RHYTHM_SPEEDS } from './rhythm-engine.js';

// 게임 옵션 토글(버튼 이름 · 짧은 설명). osu! 모드·DJMAX 옵션 참고
export const OPTION_TOGGLES = Object.freeze([
  Object.freeze({ key: 'noFail', label: '노페일', hint: 'HP가 0이어도 끝까지 · 점수 절반' }),
  Object.freeze({ key: 'suddenDeath', label: '서든데스', hint: 'MISS·BAD·오타 하나면 실패' }),
  Object.freeze({ key: 'perfectOnly', label: '퍼펙트', hint: 'PERFECT가 아니면 실패' }),
  Object.freeze({ key: 'hidden', label: '히든', hint: '판정선 가까이에서 노트가 사라짐' }),
  Object.freeze({ key: 'fadeIn', label: '페이드인', hint: '판정선 가까이에서 노트가 나타남' }),
  Object.freeze({ key: 'mirror', label: '미러', hint: '레인 좌우 반전(화면만)' }),
  Object.freeze({ key: 'autoPlay', label: '자동 연주', hint: '구경용 · 기록·포인트 없음' })
]);

// 속도 단계 이동(끝에서 멈춤)
export function stepSpeed(speed, delta) {
  const index = Math.max(0, RHYTHM_SPEEDS.indexOf(speed));
  return RHYTHM_SPEEDS[Math.min(RHYTHM_SPEEDS.length - 1, Math.max(0, index + delta))];
}

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
    if (song.ai) text.querySelector('.song-title').append(element('span', 'ai-badge', 'AI'));
    const rank = bestRankOfSong(song.id, bestOf);
    const badge = element('span', `song-rank${rank ? ` rank-${rank}` : ''}`, rank ?? '–');
    badge.title = rank ? '이 곡 최고 랭크' : '아직 기록 없음';
    const mark = bestOf(song.id, difficulty)?.mark;
    const markBadge = element('span', `clear-mark${mark ? ` mark-${mark}` : ''}`, mark ?? '');
    if (mark) markBadge.title = mark === 'AP' ? `${RHYTHM_DIFFICULTIES[difficulty].label} 올 퍼펙트` : `${RHYTHM_DIFFICULTIES[difficulty].label} 풀 콤보`;
    row.append(level, text, markBadge, badge);
    return row;
  });
  list.replaceChildren(...rows);
  list.querySelector('.selected')?.scrollIntoView?.({ block: 'nearest' });
}

function renderDetail(detail, { songId, difficulty, focused, levelOf, bestOf, options, suggestedOffsetMs }) {
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
    if (best.mark) record.append(element('span', `clear-mark mark-${best.mark}`, best.mark === 'AP' ? 'ALL PERFECT' : 'FULL COMBO'));
  } else {
    record.textContent = '이 난이도는 아직 기록이 없어요';
  }
  const credit = element('p', 'song-source');
  const sourceText = song.ai ? `AI로 만든 곡 · ${song.license}` : song.license ? `악보 출처 · ${song.license}` : '저작권이 끝난 선율을 직접 채보';
  if (/^https:\/\//.test(song.source ?? '')) {
    const link = element('a', '', sourceText);
    link.href = song.source;
    link.target = '_blank';
    link.rel = 'noopener';
    credit.append(link);
  } else {
    credit.textContent = sourceText;
  }
  const start = element('p', 'song-start', focused ? '글자 키를 치면 시작해요' : '여기를 눌러 시작 준비');
  const keys = element('p', 'song-keys', '↑↓ 곡 바꾸기 · ←→ 난이도');
  if (song.ai) title.append(element('span', 'ai-badge', 'AI 생성'));
  detail.replaceChildren(title, meta, facts, chips, record, credit, renderOptions({ options, suggestedOffsetMs }), start, keys);
}

// 옵션: 낙하 속도 · 입력 보정(오프셋) · 모드 토글
function renderOptions({ options, suggestedOffsetMs }) {
  const box = element('div', 'rhythm-options');
  const stepper = (name, label, value, attributes) => {
    const row = element('div', 'option-row');
    row.append(element('span', 'option-name', name));
    const minus = element('button', 'option-step', '−');
    const plus = element('button', 'option-step', '+');
    for (const [button, delta] of [[minus, -1], [plus, 1]]) {
      button.type = 'button';
      button.dataset.option = attributes;
      button.dataset.delta = String(delta);
      button.setAttribute('aria-label', `${name} ${delta < 0 ? '낮추기' : '올리기'}`);
    }
    row.append(minus, element('span', 'option-value', label), plus);
    return row;
  };
  box.append(stepper('속도', `x${options.speed.toFixed(2).replace(/0$/, '')}`, options.speed, 'speed'));
  const offsetRow = stepper('오프셋', `${options.offsetMs > 0 ? '+' : ''}${options.offsetMs}ms`, options.offsetMs, 'offset');
  if (Number.isFinite(suggestedOffsetMs) && suggestedOffsetMs !== options.offsetMs) {
    const suggest = element('button', 'option-suggest', `지난 판 기준 ${suggestedOffsetMs > 0 ? '+' : ''}${suggestedOffsetMs}ms로`);
    suggest.type = 'button';
    suggest.dataset.option = 'offset-suggest';
    suggest.title = '지난 판의 평균 타이밍으로 오프셋을 맞춰요';
    offsetRow.append(suggest);
  }
  box.append(offsetRow);
  const toggles = element('div', 'option-toggles');
  for (const toggle of OPTION_TOGGLES) {
    const button = element('button', `option-toggle${options[toggle.key] ? ' on' : ''}`, toggle.label);
    button.type = 'button';
    button.dataset.option = 'toggle';
    button.dataset.key = toggle.key;
    button.title = toggle.hint;
    button.setAttribute('aria-pressed', String(options[toggle.key] === true));
    toggles.append(button);
  }
  box.append(toggles);
  return box;
}

// 상태 그대로 다시 그린다. O(곡 수 × 난이도 수)
export function renderSongSelect(root, state) {
  root.hidden = !state.visible;
  if (!state.visible) return;
  renderList(root.querySelector('.song-list'), state);
  renderDetail(root.querySelector('.song-detail'), state);
}
