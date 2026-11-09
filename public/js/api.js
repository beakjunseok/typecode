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

export async function requestSession(language, durationSeconds) {
  const result = await callApi('/api/session', { method: 'POST', body: { language, durationSeconds } });
  if (typeof result.token !== 'string') throw new ApiError('세션 응답 형식 오류', 0, 'bad_response');
  return result.token;
}

export function submitScore(payload) {
  return callApi('/api/scores', { method: 'POST', body: payload });
}

export function fetchBoard() {
  return callApi('/api/scores');
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

export const localBoard = {
  load() {
    const entries = readStorage(LOCAL_BOARD_PREFIX + getWeekLabel(), []);
    return Array.isArray(entries) ? entries.filter(entry => entry && Number.isFinite(entry.score)) : [];
  },
  save(entry) {
    const entries = [...this.load(), entry]
      .sort((first, second) => second.score - first.score || first.achievedAt - second.achievedAt)
      .slice(0, BOARD_SIZE);
    writeStorage(LOCAL_BOARD_PREFIX + getWeekLabel(), entries);
    return entries;
  }
};
