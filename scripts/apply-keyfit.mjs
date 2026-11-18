// 키 위치 편집기(TYPE//CODE 키 위치 맞추기)에서 복사한 'TYPECODE-KEYFIT {...}' 내용을 public/js/skin-boards.js에 반영한다.
// 사용: node scripts/apply-keyfit.mjs <붙여 넣은 내용 파일>. 기존 스킨의 바뀐 키만 덮어쓰고, 'new' 항목(새 키보드)은 건너뛰고 알려 준다.
import { readFileSync, writeFileSync } from 'node:fs';

const MODULE_PATH = new URL('../public/js/skin-boards.js', import.meta.url);

function parseInput(text) {
  const start = text.indexOf('{');
  if (!text.includes('TYPECODE-KEYFIT') || start < 0) throw new Error('TYPECODE-KEYFIT 내용이 아니에요');
  return JSON.parse(text.slice(start).trim());
}

function validBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(value => Number.isFinite(value) && value >= -0.05 && value <= 1.05) && box[2] > 0 && box[3] > 0;
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('사용: node scripts/apply-keyfit.mjs <내용 파일>');
  process.exit(1);
}
const payload = parseInput(readFileSync(inputPath, 'utf8'));
const source = readFileSync(MODULE_PATH, 'utf8');
const marker = 'export const SKIN_BOARDS = Object.freeze(';
const header = source.slice(0, source.indexOf(marker));
const { SKIN_BOARDS } = await import(MODULE_PATH.href);
const boards = JSON.parse(JSON.stringify(SKIN_BOARDS));
let changed = 0;
for (const [skin, keys] of Object.entries(payload)) {
  if (skin === 'new') {
    console.log(`새 키보드 ${Object.keys(keys).length}개는 그림과 스킨 정보가 필요해서 따로 넣어요: ${Object.keys(keys).join(', ')}`);
    continue;
  }
  if (!boards[skin]) { console.warn(`없는 스킨 건너뜀: ${skin}`); continue; }
  // '_legend': { 키: '#rrggbb' 또는 null(원래대로) } → legendColors
  const legend = keys._legend ?? {};
  delete keys._legend;
  for (const [key, color] of Object.entries(legend)) {
    if (!(key in boards[skin].keys)) continue;
    boards[skin].legendColors ??= {};
    if (color == null) delete boards[skin].legendColors[key];
    else if (/^#[0-9a-f]{6}$/i.test(color)) { boards[skin].legendColors[key] = color.toLowerCase(); changed++; }
  }
  if (boards[skin].legendColors && !Object.keys(boards[skin].legendColors).length) delete boards[skin].legendColors;
  for (const [key, box] of Object.entries(keys)) {
    if (!(key in boards[skin].keys)) { console.warn(`${skin}: 없는 키 건너뜀 ${key}`); continue; }
    if (!validBox(box)) { console.warn(`${skin}: 잘못된 좌표 건너뜀 ${key}`); continue; }
    boards[skin].keys[key] = box;
    changed++;
  }
}
writeFileSync(MODULE_PATH, `${header}${marker}${JSON.stringify(boards, null, 2)});\n`);
console.log(`키 ${changed}개 반영`);
