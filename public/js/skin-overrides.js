// 키 위치 편집기(/keyfit.html)에서 서버에 저장한 키 좌표·글씨 색을 받아 SKIN_BOARDS에 덮어쓴다.
// 게임이 시작할 때 한 번 부른다. 서버가 없거나 느리면(2.5초) 조용히 원래 값으로 둔다.
import { SKIN_BOARDS } from './skin-boards.js';

const ENDPOINT = '/api/keyfit';
const TIMEOUT_MS = 2500;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// overrides = { 스킨: { keys: { 키: [x,y,w,h] }, legend: { 키: '#hex' | null } } } → SKIN_BOARDS에 반영. 반영한 키 수. O(키 수)
export function applySkinOverrides(overrides, boards = SKIN_BOARDS) {
  let applied = 0;
  for (const [skin, entry] of Object.entries(overrides ?? {})) {
    const board = boards[skin];
    if (!board || !entry) continue;
    for (const [key, box] of Object.entries(entry.keys ?? {})) {
      if (!(key in board.keys) || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) continue;
      board.keys[key] = box;
      applied++;
    }
    for (const [key, color] of Object.entries(entry.legend ?? {})) {
      if (!(key in board.keys)) continue;
      if (color === null) {
        if (board.legendColors) delete board.legendColors[key];
      } else if (typeof color === 'string' && HEX_COLOR.test(color)) {
        board.legendColors ??= {};
        board.legendColors[key] = color;
      } else continue;
      applied++;
    }
  }
  return applied;
}

// 서버에서 덮어쓰기를 받아 반영. 반영한 키 수(실패하면 0)
export async function loadSkinOverrides(fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') return 0;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(ENDPOINT, { signal: controller?.signal, cache: 'no-store' });
    if (!response.ok) return 0;
    const body = await response.json();
    return applySkinOverrides(body?.overrides);
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
