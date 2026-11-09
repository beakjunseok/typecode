import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { list, put } from '@vercel/blob';

export const LANGUAGES = ['javascript', 'python', 'java', 'c', 'go', 'rust', 'sql'];
export const DURATIONS = [30, 60, 120];
export const BOARD_SIZE = 10;
const MAX_SUBMIT_DELAY_MS = 10 * 60 * 1000;
const START_TOLERANCE_MS = 3000;
const MAX_CHARS_PER_SECOND = 25;
const MAX_MULTIPLIER = 2;
const BASE_POINTS = 10;
const BOARD_PREFIX = 'lb';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// 핸들러를 감싸 HttpError는 의도한 상태 코드로, 나머지는 500으로 변환한다.
export function withErrorHandling(handler) {
  return async request => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse({ error: error.code, message: error.message }, error.status);
      console.error('[typecode] unhandled', error);
      return jsonResponse({ error: 'internal_error', message: '서버 오류' }, 500);
    }
  };
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'invalid_json', '요청 본문이 JSON이 아닙니다');
  }
}

// KST 기준 ISO 주차 라벨(예: 2026-W46). 주가 바뀌면 새 prefix에 쓰므로 초기화 배치가 없다.
export function getWeekLabel(timestamp = Date.now()) {
  const kstDate = new Date(timestamp + 9 * 3600 * 1000);
  const isoDay = kstDate.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(kstDate.getUTCFullYear(), kstDate.getUTCMonth(), kstDate.getUTCDate() + 4 - isoDay));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const weekNumber = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

// 서명 키: 별도 비밀값이 있으면 사용, 없으면 서버에만 있는 Blob 토큰에서 파생한다.
function getSigningKey() {
  const source = process.env.TYPECODE_SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!source) throw new HttpError(500, 'missing_secret', '서버 서명 키가 설정되지 않았습니다');
  return createHash('sha256').update(`typecode-session:${source}`).digest();
}

function sign(payloadEncoded) {
  return createHmac('sha256', getSigningKey()).update(payloadEncoded).digest('base64url');
}

export function issueSessionToken({ language, durationSeconds }) {
  const payload = { sid: randomBytes(9).toString('hex'), language, durationSeconds, startedAt: Date.now() };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${payloadEncoded}.${sign(payloadEncoded)}`, session: payload };
}

// 서명이 틀리면 401. 상수 시간 비교로 타이밍 공격을 피한다.
export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) throw new HttpError(401, 'invalid_token', '세션 토큰이 없습니다');
  const [payloadEncoded, signature] = token.split('.');
  const expected = Buffer.from(sign(payloadEncoded));
  const received = Buffer.from(signature || '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new HttpError(401, 'invalid_signature', '세션 서명 검증 실패');
  }
  try {
    return JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(401, 'invalid_token', '세션 토큰 형식 오류');
  }
}

export function sanitizeName(rawName) {
  const cleaned = String(rawName ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return cleaned || 'anonymous';
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// 클라이언트 값은 상한 검증만 하고, WPM·정확도는 서버가 다시 계산한다.
export function validateSubmission(session, body, now = Date.now()) {
  const { correctKeystrokes, wrongKeystrokes, score, maxCombo } = body;
  if (![correctKeystrokes, wrongKeystrokes, score, maxCombo].every(isNonNegativeInteger)) {
    throw new HttpError(422, 'invalid_fields', 'correctKeystrokes·wrongKeystrokes·score·maxCombo는 0 이상 정수여야 합니다');
  }
  const elapsedMs = now - session.startedAt;
  if (elapsedMs < session.durationSeconds * 1000 - START_TOLERANCE_MS) {
    throw new HttpError(422, 'too_early', '제한 시간이 끝나기 전에 제출됐습니다');
  }
  if (elapsedMs > session.durationSeconds * 1000 + MAX_SUBMIT_DELAY_MS) {
    throw new HttpError(422, 'session_expired', '세션이 만료됐습니다');
  }
  if (correctKeystrokes > session.durationSeconds * MAX_CHARS_PER_SECOND) {
    throw new HttpError(422, 'implausible_speed', '입력 속도가 비정상적입니다');
  }
  if (score > correctKeystrokes * BASE_POINTS * MAX_MULTIPLIER) {
    throw new HttpError(422, 'implausible_score', '점수가 입력량과 맞지 않습니다');
  }
  const totalKeystrokes = correctKeystrokes + wrongKeystrokes;
  return {
    score,
    maxCombo,
    wpm: Math.round(correctKeystrokes / 5 / (session.durationSeconds / 60)),
    accuracy: totalKeystrokes === 0 ? 0 : Math.round((correctKeystrokes / totalKeystrokes) * 1000) / 10
  };
}

// 점수 1건 = blob 1개(append-only). 데이터는 경로에 인코딩해 list 한 번으로 보드를 만든다.
function encodeEntryPath(week, sid, entry) {
  const payload = Buffer.from(JSON.stringify(entry)).toString('base64url');
  return `${BOARD_PREFIX}/${week}/${sid}.${payload}.json`;
}

function decodeEntryPath(pathname) {
  try {
    const fileName = pathname.split('/').pop();
    const [sid, payload] = fileName.split('.');
    const entry = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(entry.score) ? { ...entry, sid } : null;
  } catch {
    return null;
  }
}

export async function sessionAlreadySubmitted(week, sid) {
  const { blobs } = await list({ prefix: `${BOARD_PREFIX}/${week}/${sid}.`, limit: 1 });
  return blobs.length > 0;
}

export async function storeEntry(week, sid, entry) {
  await put(encodeEntryPath(week, sid, entry), '{}', {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json'
  });
}

// 점수 내림차순, 동점은 먼저 달성한 기록 우선. 세션당 1건만 인정. O(n log n)
export function rankEntries(entries) {
  const uniqueBySession = new Map();
  for (const entry of entries) {
    const existing = uniqueBySession.get(entry.sid);
    if (!existing || entry.achievedAt < existing.achievedAt) uniqueBySession.set(entry.sid, entry);
  }
  return [...uniqueBySession.values()].sort((first, second) => second.score - first.score || first.achievedAt - second.achievedAt);
}

export async function loadWeeklyEntries(week, maxPages = 5) {
  const entries = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const result = await list({ prefix: `${BOARD_PREFIX}/${week}/`, limit: 1000, cursor });
    for (const blob of result.blobs) {
      const entry = decodeEntryPath(blob.pathname);
      if (entry) entries.push(entry);
    }
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  return entries;
}

export function toPublicEntry(entry, index) {
  return {
    rank: index + 1, id: entry.sid, name: entry.name, language: entry.language,
    score: entry.score, wpm: entry.wpm, accuracy: entry.accuracy, maxCombo: entry.maxCombo, achievedAt: entry.achievedAt
  };
}
