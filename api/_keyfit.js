// 키 위치 편집기(/keyfit.html)가 고친 그림 스킨의 키 좌표·글씨 색을 서버에 저장하고, 게임이 시작할 때 받아 덮어쓴다.
// 저장소는 주입식(테스트는 메모리). 저장은 비밀번호로 보호: 처음 저장할 때 정한 비밀번호의 해시(scrypt + salt)를 남긴다.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError, jsonResponse, readJsonBody, withErrorHandling } from './_lib.js';
import { SKIN_BOARDS } from '../public/js/skin-boards.js';

const OVERRIDES_PREFIX = 'keyfit/overrides-';
const ADMIN_PREFIX = 'keyfit/admin-';
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 100;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// 비밀번호 해시(scrypt). 같은 salt면 같은 결과
function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 32).toString('hex');
}

function checkPasswordShape(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(422, 'invalid_password', `비밀번호는 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자로 정해 주세요`);
  }
}

// 좌표 [x, y, w, h]: 그림 대비 비율, 조금 밖(-5%~105%)까지 허용
export function isValidBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(value => Number.isFinite(value) && value >= -0.05 && value <= 1.05) && box[2] > 0 && box[3] > 0;
}

const roundBox = box => box.map(value => Math.round(value * 100000) / 100000);

// 고친 내용 하나를 지금 덮어쓰기 목록에 합친다. changes = { 스킨: { keys: { 키: box }, legend: { 키: '#hex' | null } } }.
// null 글씨 색 = 덮어쓰기 지우기(원래 색). 없는 스킨·키·잘못된 값은 건너뛰고 수를 센다. O(바뀐 키 수)
export function mergeChanges(current, changes, boards = SKIN_BOARDS) {
  if (!changes || typeof changes !== 'object') throw new HttpError(422, 'invalid_changes', '바뀐 내용이 없습니다');
  const next = JSON.parse(JSON.stringify(current ?? {}));
  let applied = 0, skipped = 0;
  for (const [skin, change] of Object.entries(changes)) {
    const board = boards[skin];
    if (!board || !change || typeof change !== 'object') { skipped++; continue; }
    const entry = next[skin] ?? { keys: {}, legend: {} };
    entry.keys ??= {};
    entry.legend ??= {};
    for (const [key, box] of Object.entries(change.keys ?? {})) {
      if (!(key in board.keys) || !isValidBox(box)) { skipped++; continue; }
      entry.keys[key] = roundBox(box);
      applied++;
    }
    for (const [key, color] of Object.entries(change.legend ?? {})) {
      if (!(key in board.keys)) { skipped++; continue; }
      if (color === null) {
        entry.legend[key] = null;
        applied++;
      } else if (typeof color === 'string' && HEX_COLOR.test(color)) {
        entry.legend[key] = color.toLowerCase();
        applied++;
      } else skipped++;
    }
    if (Object.keys(entry.keys).length || Object.keys(entry.legend).length) next[skin] = entry;
  }
  return { overrides: next, applied, skipped };
}

export function createKeyfitRoutes(storage) {
  async function newest(prefix) {
    const files = await storage.list(prefix);
    if (!files.length) return { data: null, files };
    files.sort((first, second) => second.uploadedAt - first.uploadedAt);
    return { data: await storage.readJson(files[0]), files };
  }

  // 비밀번호 확인. 저장된 비밀번호가 없으면 이번 비밀번호를 처음 비밀번호로 정한다(반환 created = true)
  async function authorize(password) {
    checkPasswordShape(password);
    const { data } = await newest(ADMIN_PREFIX);
    if (!data?.hash || !data?.salt) {
      const salt = randomBytes(16).toString('hex');
      await storage.putJson(`${ADMIN_PREFIX}`, { salt, hash: hashPassword(password, salt), createdAt: Date.now() });
      return { created: true };
    }
    const expected = Buffer.from(data.hash, 'hex');
    const actual = Buffer.from(hashPassword(password, data.salt), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new HttpError(401, 'wrong_password', '비밀번호가 맞지 않아요');
    }
    return { created: false };
  }

  // 새 덮어쓰기 목록을 쓰고 예전 것은 지운다(최신 하나만 남김)
  async function save(overrides, previousFiles) {
    await storage.putJson(OVERRIDES_PREFIX, { overrides, savedAt: Date.now() });
    const stale = previousFiles.map(file => file.url);
    if (stale.length) await storage.remove(stale).catch(() => {});
  }

  // GET: 지금 덮어쓰기 목록 { overrides: { 스킨: { keys, legend } } }. 게임이 시작할 때 부른다
  const GET = withErrorHandling(async () => {
    const { data } = await newest(OVERRIDES_PREFIX);
    return jsonResponse({ overrides: data?.overrides ?? {}, savedAt: data?.savedAt ?? null }, 200, { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30' });
  });

  // POST { password, changes } → 합쳐서 저장. { password, reset: '스킨' } → 그 스킨의 덮어쓰기를 지워 원래대로
  const POST = withErrorHandling(async request => {
    const body = await readJsonBody(request);
    const { created } = await authorize(body.password);
    const { data, files } = await newest(OVERRIDES_PREFIX);
    const current = data?.overrides ?? {};
    if (typeof body.reset === 'string') {
      if (!current[body.reset]) return jsonResponse({ ok: true, created, overrides: current, applied: 0, skipped: 0 });
      const next = { ...current };
      delete next[body.reset];
      await save(next, files);
      return jsonResponse({ ok: true, created, overrides: next, applied: 1, skipped: 0 });
    }
    const { overrides, applied, skipped } = mergeChanges(current, body.changes);
    if (!applied) throw new HttpError(422, 'nothing_applied', '넣을 수 있는 바뀐 키가 없어요');
    await save(overrides, files);
    return jsonResponse({ ok: true, created, overrides, applied, skipped });
  });

  return { GET, POST };
}
