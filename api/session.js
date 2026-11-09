import { DURATIONS, LANGUAGES, HttpError, issueSessionToken, jsonResponse, readJsonBody, withErrorHandling } from './_lib.js';

// 게임 시작 시 서버 시각으로 세션을 발급한다. 경과 시간은 이후 서버 기준으로만 계산한다.
export const POST = withErrorHandling(async request => {
  const body = await readJsonBody(request);
  const durationSeconds = Number(body.durationSeconds);
  if (!LANGUAGES.includes(body.language)) throw new HttpError(422, 'invalid_language', '지원하지 않는 언어입니다');
  if (!DURATIONS.includes(durationSeconds)) throw new HttpError(422, 'invalid_duration', '지원하지 않는 시간입니다');
  const { token, session } = issueSessionToken({ language: body.language, durationSeconds });
  return jsonResponse({ token, startedAt: session.startedAt });
});
