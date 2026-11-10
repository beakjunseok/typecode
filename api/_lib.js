import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { list, put } from '@vercel/blob';
// 클라이언트와 같은 모듈을 그대로 가져와 규칙·상수가 어긋나지 않게 한다.
import { LANGUAGE_KEYS } from '../public/js/tokens.js';
import { DURATIONS, SCORING, MAX_MULTIPLIER, calculateWordsPerMinute, calculateAccuracy } from '../public/js/engine.js';
import { getWeekLabel } from '../public/js/week.js';
import { MAX_POINTS_PER_CHARACTER as THROW_MAX_POINTS_PER_CHARACTER } from '../public/js/throw-engine.js';
import { BATTERY_MAX_POINTS_PER_CHARACTER } from '../public/js/battery-engine.js';

export { DURATIONS, getWeekLabel };
export const LANGUAGES = LANGUAGE_KEYS;
export const BOARD_SIZE = 10;
const MAX_SUBMIT_DELAY_MS = 10 * 60 * 1000;
const START_TOLERANCE_MS = 3000;
const MAX_CHARS_PER_SECOND = 25;
const MIN_ARCADE_SECONDS = 3;
const MAX_ARCADE_SECONDS = 60 * 60;

// 모드별 랭킹 저장 경로와 글자당 점수 상한. practice는 기존 경로(lb/)를 그대로 쓴다.
export const MODES = Object.freeze({
  practice: Object.freeze({ prefix: 'lb', timed: true, maxPointsPerCharacter: SCORING.basePoints * MAX_MULTIPLIER }),
  throw: Object.freeze({ prefix: 'lb-throw', timed: false, maxPointsPerCharacter: THROW_MAX_POINTS_PER_CHARACTER }),
  battery: Object.freeze({ prefix: 'lb-battery', timed: false, maxPointsPerCharacter: BATTERY_MAX_POINTS_PER_CHARACTER })
});

export function resolveMode(rawMode) {
  const mode = rawMode ?? 'practice';
  if (!Object.hasOwn(MODES, mode)) throw new HttpError(422, 'invalid_mode', '지원하지 않는 모드입니다');
  return mode;
}

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

// 서명 키: 별도 비밀값이 있으면 사용, 없으면 서버에만 있는 Blob 토큰에서 파생한다.
function getSigningKey() {
  const source = process.env.TYPECODE_SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!source) throw new HttpError(500, 'missing_secret', '서버 서명 키가 설정되지 않았습니다');
  return createHash('sha256').update(`typecode-session:${source}`).digest();
}

function sign(payloadEncoded) {
  return createHmac('sha256', getSigningKey()).update(payloadEncoded).digest('base64url');
}

export function issueSessionToken({ language, durationSeconds = null, mode = 'practice' }) {
  const payload = { sid: randomBytes(9).toString('hex'), mode, language, durationSeconds, startedAt: Date.now() };
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

// 클라이언트 값은 상한 검증만 하고, WPM·정확도는 서버가 다시 계산한다. 모드별로 시간 기준이 다르다.
export function validateSubmission(session, body, now = Date.now()) {
  const mode = resolveMode(session.mode);
  const { correctKeystrokes, wrongKeystrokes, score, maxCombo } = body;
  if (![correctKeystrokes, wrongKeystrokes, score, maxCombo].every(isNonNegativeInteger)) {
    throw new HttpError(422, 'invalid_fields', 'correctKeystrokes·wrongKeystrokes·score·maxCombo는 0 이상 정수여야 합니다');
  }
  const elapsedMs = now - session.startedAt;
  const playedSeconds = MODES[mode].timed ? session.durationSeconds : validateArcadeTime(body.survivedSeconds, elapsedMs);
  if (MODES[mode].timed) {
    if (elapsedMs < session.durationSeconds * 1000 - START_TOLERANCE_MS) {
      throw new HttpError(422, 'too_early', '제한 시간이 끝나기 전에 제출됐습니다');
    }
    if (elapsedMs > session.durationSeconds * 1000 + MAX_SUBMIT_DELAY_MS) {
      throw new HttpError(422, 'session_expired', '세션이 만료됐습니다');
    }
  }
  if (correctKeystrokes > playedSeconds * MAX_CHARS_PER_SECOND) {
    throw new HttpError(422, 'implausible_speed', '입력 속도가 비정상적입니다');
  }
  if (score > correctKeystrokes * MODES[mode].maxPointsPerCharacter) {
    throw new HttpError(422, 'implausible_score', '점수가 입력량과 맞지 않습니다');
  }
  return {
    score,
    maxCombo,
    wpm: calculateWordsPerMinute(correctKeystrokes, playedSeconds),
    accuracy: calculateAccuracy(correctKeystrokes, wrongKeystrokes),
    ...(MODES[mode].timed ? {} : { survivedSeconds: playedSeconds })
  };
}

// 아케이드 모드: 클라이언트가 보낸 생존 시간은 서버가 잰 경과 시간을 넘을 수 없다.
function validateArcadeTime(survivedSeconds, elapsedMs) {
  if (!Number.isInteger(survivedSeconds) || survivedSeconds < MIN_ARCADE_SECONDS) {
    throw new HttpError(422, 'invalid_survived_seconds', `survivedSeconds는 ${MIN_ARCADE_SECONDS} 이상 정수여야 합니다`);
  }
  if (survivedSeconds * 1000 > elapsedMs + START_TOLERANCE_MS) {
    throw new HttpError(422, 'too_early', '생존 시간이 서버 경과 시간보다 깁니다');
  }
  if (elapsedMs > (MAX_ARCADE_SECONDS * 1000) + MAX_SUBMIT_DELAY_MS) {
    throw new HttpError(422, 'session_expired', '세션이 만료됐습니다');
  }
  return survivedSeconds;
}

// 점수 1건 = blob 1개(append-only). 데이터는 경로에 인코딩해 list 한 번으로 보드를 만든다.
function boardPrefix(mode, week) {
  return `${MODES[resolveMode(mode)].prefix}/${week}/`;
}

function encodeEntryPath(mode, week, sid, entry) {
  const payload = Buffer.from(JSON.stringify(entry)).toString('base64url');
  return `${boardPrefix(mode, week)}${sid}.${payload}.json`;
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

export async function sessionAlreadySubmitted(mode, week, sid) {
  const { blobs } = await list({ prefix: `${boardPrefix(mode, week)}${sid}.`, limit: 1 });
  return blobs.length > 0;
}

export async function storeEntry(mode, week, sid, entry) {
  await put(encodeEntryPath(mode, week, sid, entry), '{}', {
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

export async function loadWeeklyEntries(mode, week, maxPages = 5) {
  const entries = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const result = await list({ prefix: boardPrefix(mode, week), limit: 1000, cursor });
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
    score: entry.score, wpm: entry.wpm, accuracy: entry.accuracy, maxCombo: entry.maxCombo, achievedAt: entry.achievedAt,
    ...(entry.survivedSeconds ? { survivedSeconds: entry.survivedSeconds } : {})
  };
}
