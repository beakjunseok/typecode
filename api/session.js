import { DURATIONS, LANGUAGES, MODES, HttpError, resolveMode, issueSessionToken, jsonResponse, readJsonBody, withErrorHandling } from './_lib.js';

// 게임 시작 시 서버 시각으로 세션을 발급한다. 경과 시간은 이후 서버 기준으로만 계산한다.
// practice는 제한 시간(30·60·120초)이 필수, 아케이드 모드(throw·battery)는 시간 제한이 없다.
export const POST = withErrorHandling(async request => {
  const body = await readJsonBody(request);
  const mode = resolveMode(body.mode);
  if (!LANGUAGES.includes(body.language)) throw new HttpError(422, 'invalid_language', '지원하지 않는 언어입니다');
  let durationSeconds = null;
  if (MODES[mode].timed) {
    durationSeconds = Number(body.durationSeconds);
    if (!DURATIONS.includes(durationSeconds)) throw new HttpError(422, 'invalid_duration', '지원하지 않는 시간입니다');
  }
  const { token, session } = issueSessionToken({ mode, language: body.language, durationSeconds });
  return jsonResponse({ token, mode, startedAt: session.startedAt });
});
