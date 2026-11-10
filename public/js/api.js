// 서버 API 호출과, 서버를 못 쓸 때의 로컬 랭킹 대체 저장소.
import { getWeekLabel } from './week.js';

const API_TIMEOUT_MS = 6000;
const LOCAL_BOARD_PREFIX = 'typecode:lb:';
const BOARD_SIZE = 10;

export class ApiError extends Error {
  constructor(message, status = 0, code = 'network_error') {
    super(message);
    this.status = status;
    this.code = code;
  }

  // 같은 요청을 다시 보내도 결과가 바뀌지 않는 오류(서명·검증·중복)
  get isFinal() {
    return [401, 409, 422].includes(this.status);
  }
}

// fetch를 타임아웃·HTTP 오류·JSON 파싱 실패까지 ApiError 하나로 정리한다.
async function callApi(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(payload.message || `HTTP ${response.status}`, response.status, payload.error);
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') throw new ApiError('서버 응답 시간 초과', 0, 'timeout');
    throw new ApiError(error?.message || '네트워크 오류');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestSession({ mode = 'practice', language, durationSeconds }) {
  const result = await callApi('/api/session', { method: 'POST', body: { mode, language, durationSeconds } });
  if (typeof result.token !== 'string') throw new ApiError('세션 응답 형식 오류', 0, 'bad_response');
  return result.token;
}

export function submitScore(payload) {
  return callApi('/api/scores', { method: 'POST', body: payload });
}

export function fetchBoard(mode = 'practice') {
  return callApi(`/api/scores?mode=${encodeURIComponent(mode)}`);
}

function readStorage(key, fallbackValue) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw == null ? fallbackValue : JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

function writeStorage(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

export const preferences = {
  get: (key, fallbackValue) => readStorage(`typecode:${key}`, fallbackValue),
  set: (key, value) => writeStorage(`typecode:${key}`, value)
};

// 모드별 로컬 랭킹. practice는 예전 키를 그대로 써서 기존 기록을 유지한다.
const localBoardKey = mode => `${LOCAL_BOARD_PREFIX}${mode === 'practice' ? '' : `${mode}:`}${getWeekLabel()}`;

export const localBoard = {
  load(mode = 'practice') {
    const entries = readStorage(localBoardKey(mode), []);
    return Array.isArray(entries) ? entries.filter(entry => entry && Number.isFinite(entry.score)) : [];
  },
  save(entry, mode = 'practice') {
    const entries = [...this.load(mode), entry]
      .sort((first, second) => second.score - first.score || first.achievedAt - second.achievedAt)
      .slice(0, BOARD_SIZE);
    writeStorage(localBoardKey(mode), entries);
    return entries;
  }
};
