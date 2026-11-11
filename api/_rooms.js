// 배터리 구조 PvP 방(WebRTC 시그널링). 서버는 두 기기의 연결 정보(SDP offer/answer)만 잠깐 전달하고,
// 게임 데이터는 기기끼리 직접(P2P) 주고받는다. 저장소는 주입식이라 테스트·로컬 서버는 메모리 저장소를 쓴다.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { HttpError, jsonResponse, readJsonBody, sanitizeName, withErrorHandling } from './_lib.js';
import { LANGUAGE_KEYS } from '../public/js/tokens.js';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 I·L·O·0·1 제외
export const ROOM_CODE_LENGTH = 4;
export const ROOM_TTL_MS = 10 * 60 * 1000;
const ROOM_PREFIX = 'rooms/';
const MAX_SDP_LENGTH = 16_000;
const CLEANUP_AGE_MS = 60 * 60 * 1000;
const CODE_ATTEMPTS = 6;
const LEVELS = [1, 2, 3, 4];

export function normalizeRoomCode(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const valid = code.length === ROOM_CODE_LENGTH && [...code].every(character => ROOM_CODE_ALPHABET.includes(character));
  if (!valid) throw new HttpError(422, 'invalid_code', '방 코드는 4자리입니다');
  return code;
}

function generateRoomCode() {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
}

function hashKey(key) {
  return createHash('sha256').update(`typecode-room:${key}`).digest('hex');
}

// WebRTC 세션 설명은 'v=0'으로 시작하는 텍스트. 크기 상한으로 저장소 남용을 막는다
function validateDescription(description, expectedType) {
  if (!description || typeof description !== 'object') throw new HttpError(422, 'invalid_sdp', '연결 정보가 없습니다');
  const { type, sdp } = description;
  if (type !== expectedType || typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > MAX_SDP_LENGTH) {
    throw new HttpError(422, 'invalid_sdp', '연결 정보 형식이 올바르지 않습니다');
  }
  return { type, sdp };
}

function validateSettings(raw) {
  const language = LANGUAGE_KEYS.includes(raw?.language) ? raw.language : 'javascript';
  const level = LEVELS.includes(Number(raw?.level)) ? Number(raw.level) : 2;
  return { language, level };
}

// 방 하나의 파일들(offer, answer)을 읽어 상태를 만든다. 만료된 방은 없는 것으로 본다. O(파일 수)
async function loadRoom(storage, code, now) {
  const files = await storage.list(`${ROOM_PREFIX}${code}/`);
  const offerFile = files.filter(file => file.pathname.includes('/offer')).sort((first, second) => second.uploadedAt - first.uploadedAt)[0];
  if (!offerFile || now - offerFile.uploadedAt > ROOM_TTL_MS) return null;
  const answerFile = files.filter(file => file.pathname.includes('/answer') && file.uploadedAt >= offerFile.uploadedAt)
    .sort((first, second) => first.uploadedAt - second.uploadedAt)[0] ?? null;
  return { offerFile, answerFile };
}

// 오래된 방 파일 정리(방 만들 때 가끔). 실패해도 방 만들기에는 영향 없음
async function cleanupOldRooms(storage, now) {
  try {
    const files = await storage.list(ROOM_PREFIX, 200);
    const stale = files.filter(file => now - file.uploadedAt > CLEANUP_AGE_MS).map(file => file.url);
    if (stale.length) await storage.remove(stale);
  } catch (error) {
    console.warn('[typecode] room cleanup failed', error?.message);
  }
}

export function createRoomRoutes(storage, { now = () => Date.now() } = {}) {
  // POST {action:'create', offer, name, settings} → {code, key}
  // POST {action:'answer', code, answer, name} → {ok}
  const POST = withErrorHandling(async request => {
    const body = await readJsonBody(request);
    const time = now();
    if (body.action === 'create') {
      const offer = validateDescription(body.offer, 'offer');
      if (Math.random() < 0.2) await cleanupOldRooms(storage, time);
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        if (await loadRoom(storage, code, time)) continue;
        const key = randomBytes(16).toString('hex');
        await storage.putJson(`${ROOM_PREFIX}${code}/offer.json`, {
          offer, hostName: sanitizeName(body.name), settings: validateSettings(body.settings), keyHash: hashKey(key), createdAt: time
        });
        return jsonResponse({ code, key, expiresAt: time + ROOM_TTL_MS });
      }
      throw new HttpError(503, 'no_room_code', '방 코드를 만들지 못했습니다. 다시 시도해 주세요');
    }
    if (body.action === 'answer') {
      const code = normalizeRoomCode(body.code);
      const answer = validateDescription(body.answer, 'answer');
      const room = await loadRoom(storage, code, time);
      if (!room) throw new HttpError(404, 'room_not_found', '방을 찾을 수 없습니다(코드 확인 또는 만료)');
      if (room.answerFile) throw new HttpError(409, 'room_full', '이미 다른 사람이 들어간 방입니다');
      await storage.putJson(`${ROOM_PREFIX}${code}/answer.json`, { answer, guestName: sanitizeName(body.name), createdAt: time });
      return jsonResponse({ ok: true });
    }
    throw new HttpError(400, 'invalid_action', '알 수 없는 요청입니다');
  });

  // GET ?code=XXXX → 손님: {offer, hostName, settings}
  // GET ?code=XXXX&key=… → 방장: {answer|null, guestName}
  const GET = withErrorHandling(async request => {
    const params = new URL(request.url).searchParams;
    const code = normalizeRoomCode(params.get('code'));
    const room = await loadRoom(storage, code, now());
    if (!room) throw new HttpError(404, 'room_not_found', '방을 찾을 수 없습니다(코드 확인 또는 만료)');
    const offerData = await storage.readJson(room.offerFile);
    const key = params.get('key');
    if (key !== null) {
      if (hashKey(key) !== offerData.keyHash) throw new HttpError(403, 'not_host', '방장만 볼 수 있습니다');
      if (!room.answerFile) return jsonResponse({ answer: null });
      const answerData = await storage.readJson(room.answerFile);
      return jsonResponse({ answer: answerData.answer, guestName: answerData.guestName });
    }
    if (room.answerFile) throw new HttpError(409, 'room_full', '이미 다른 사람이 들어간 방입니다');
    return jsonResponse({ offer: offerData.offer, hostName: offerData.hostName, settings: offerData.settings });
  });

  return { GET, POST };
}

// 메모리 저장소: 테스트·로컬 개발 서버용(Blob과 같은 인터페이스)
export function createMemoryRoomStorage({ now = () => Date.now() } = {}) {
  const files = new Map();
  let sequence = 0;
  return {
    files,
    async putJson(pathname, data) {
      const stored = `${pathname.replace(/\.json$/, '')}-${++sequence}.json`;
      files.set(stored, { pathname: stored, url: `memory://${stored}`, uploadedAt: now() + sequence * 1e-3, body: JSON.stringify(data) });
    },
    async list(prefix, limit = 1000) {
      return [...files.values()].filter(file => file.pathname.startsWith(prefix)).slice(0, limit);
    },
    async readJson(file) {
      return JSON.parse(files.get(file.pathname).body);
    },
    async remove(urls) {
      for (const [pathname, file] of files) if (urls.includes(file.url)) files.delete(pathname);
    }
  };
}
