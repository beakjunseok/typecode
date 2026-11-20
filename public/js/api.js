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

export async function requestSession({ mode = 'practice', language, durationSeconds, level }) {
  const result = await callApi('/api/session', { method: 'POST', body: { mode, language, durationSeconds, level } });
  if (typeof result.token !== 'string') throw new ApiError('세션 응답 형식 오류', 0, 'bad_response');
  return result.token;
}

// 밸런스 통계 보내기: 페이지를 떠나는 중에도 끝까지 가도록 keepalive. 실패해도 게임엔 영향 없음
export async function submitBalanceReport(token, report) {
  try {
    await fetch('/api/balance', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, report }) });
    return true;
  } catch {
    return false;
  }
}

export function submitScore(payload) {
  return callApi('/api/scores', { method: 'POST', body: payload });
}

// level: 난이도별 랭킹 모드(throw·battery)일 때만. language: 그 언어 기록만
export function fetchBoard(mode = 'practice', level = null, language = null) {
  const query = new URLSearchParams({ mode });
  if (level) query.set('level', level);
  if (language) query.set('language', language);
  return callApi(`/api/scores?${query}`);
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

// 모드별 로컬 랭킹. practice는 예전 키를 그대로 써서 기존 기록을 유지한다. 난이도별 모드는 Lv.2 외에 :L레벨을 붙인다
const localBoardKey = (mode, level) => `${LOCAL_BOARD_PREFIX}${mode === 'practice' ? '' : `${mode}:`}${level && level !== 2 ? `L${level}:` : ''}${getWeekLabel()}`;

export const localBoard = {
  // 저장은 언어를 섞어 두고(기록마다 language가 있다) 읽을 때 language로 거른다
  loadAll(mode = 'practice', level = null) {
    const entries = readStorage(localBoardKey(mode, level), []);
    return Array.isArray(entries) ? entries.filter(entry => entry && Number.isFinite(entry.score)) : [];
  },
  load(mode = 'practice', level = null, language = null) {
    const entries = this.loadAll(mode, level);
    return language ? entries.filter(entry => entry.language === language) : entries;
  },
  // 언어마다 상위 BOARD_SIZE개씩 남긴다
  save(entry, mode = 'practice', level = null) {
    const sorted = [...this.loadAll(mode, level), entry]
      .sort((first, second) => second.score - first.score || first.achievedAt - second.achievedAt);
    const perLanguage = new Map();
    const kept = sorted.filter(item => {
      const count = perLanguage.get(item.language) ?? 0;
      perLanguage.set(item.language, count + 1);
      return count < BOARD_SIZE;
    });
    writeStorage(localBoardKey(mode, level), kept);
    return kept.filter(item => item.language === entry.language);
  }
};
