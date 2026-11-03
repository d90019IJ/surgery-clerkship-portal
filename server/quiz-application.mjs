export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const satisfaction = ['非常滿意', '滿意', '普通', '不滿意', '非常不滿意'];
export const SURVEY = [
  { id: 's1', text: '老師教學表達技巧', options: satisfaction },
  { id: 's2', text: '教材內容之實用性', options: satisfaction },
  { id: 's3', text: '教材內容之難易度', options: ['非常簡單', '簡單', '適中', '困難', '非常困難'] },
  { id: 's4', text: '時間掌控方面', options: satisfaction },
  { id: 's5', text: '考試方式', options: satisfaction }
];
export function normalizeIdentity(name, studentId) {
  if (typeof name !== 'string' || typeof studentId !== 'string') throw new ApiError(400, '請填寫姓名與學號。');
  const cleanName = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const cleanId = studentId.normalize('NFKC').trim().toUpperCase();
  if (!cleanName || cleanName.length > 60 || /[\p{Cc}\p{Cf}]/u.test(cleanName)) throw new ApiError(400, '請輸入有效姓名（最多 60 字）。');
  if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(cleanId)) throw new ApiError(400, '學號限 1–32 碼英文字母、數字或連字號，請勿包含空格。');
  return { name: cleanName, studentId: cleanId };
}
export function validateAnswers(answers, questions) {
  const invalid = () => { throw new ApiError(400, '請完成所有題目，複選題至少選擇一個選項。'); };
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== questions.length) invalid();
  const result = {};
  for (const q of questions) {
    const value = answers[q.id], valid = n => Number.isInteger(n) && n >= 0 && n < q.options.length;
    if (!Object.hasOwn(answers,q.id)) invalid();
    if (q.type === 'multiple') {
      if (!Array.isArray(value) || !value.length || value.length > q.options.length || !value.every(valid) || new Set(value).size !== value.length) invalid();
      result[q.id] = [...value].sort((a,b)=>a-b);
    } else {
      if (!valid(value)) invalid();
      result[q.id] = value;
    }
  }
  return result;
}
export function answersEqual(value,key) {
  if(Array.isArray(value) && Array.isArray(key)) return value.length === key.length && value.every(n=>key.includes(n));
  return value === key;
}
export function examWindow(exam) {
  const now = Date.parse(exam.server_now);
  let state = 'unscheduled';
  if (exam.opens_at && exam.closes_at && Number.isFinite(now)) {
    if (now >= Date.parse(exam.closes_at)) state = 'closed';
    else if (!exam.open) state = 'paused';
    else if (now < Date.parse(exam.opens_at)) state = 'before';
    else state = 'open';
  }
  return { state, serverNow: exam.server_now, opensAt: exam.opens_at || null, closesAt: exam.closes_at || null };
}
export function requireOpen(exam) {
  const state = examWindow(exam).state;
  const messages = { unscheduled: '尚未設定考試日期，請聯絡講師。', before: '尚未到開放時間，請於頁面顯示的開放時間再進入。', closed: '已超過 19:30，考試與問卷皆已截止。', paused: '講師已暫停收件，請聯絡講師。' };
  if (state !== 'open') throw new ApiError(409, messages[state]);
}
export function scheduleForDate(date, opensTime = '18:30') {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, '請選擇有效的考試日期。');
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new ApiError(400, '請選擇有效的考試日期。');
  if (typeof opensTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(opensTime) || opensTime >= '19:30') throw new ApiError(400, '開放時間須早於當天 19:30。');
  return { opens_at: date + 'T' + opensTime + ':00+08:00', closes_at: date + 'T19:30:00+08:00' };
}
export async function sha256(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function equalDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function publicQuestions(questions) {
  return questions.map(q=>({id:q.id,text:q.text,options:q.options,...(q.type==='multiple'?{type:'multiple'}:{}),...(q.table?{table:q.table}:{}),...(q.image?{image:q.image}:{})}));
}
export function createHandler(repository) {
  return async function handle(request) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    try {
      const settings = await repository.settings();
      const origin = request.headers.get('Origin');
      if (origin) {
        if (!settings.allowed_origins.includes(origin)) throw new ApiError(403, '此網站尚未獲准使用測驗服務。');
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'content-type, x-teacher-code';
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new ApiError(405, '僅接受測驗頁面送出的請求。');
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new ApiError(415, '不支援的資料格式。');
      const text = await request.text();
      if (text.length > 16384) throw new ApiError(413, '送出的資料過長。');
      let body;
      try { body = JSON.parse(text); } catch { throw new ApiError(400, '資料格式不正確。'); }
      if (!body || typeof body !== 'object' || typeof body.examId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.examId)) throw new ApiError(400, '無效的測驗場次。');
      const admin = ['admin-list', 'admin-toggle', 'admin-schedule', 'admin-survey', 'admin-roster', 'admin-roster-add', 'admin-open-now', 'admin-preview', 'admin-bank'].includes(body.action);
      if (admin) {
        const code = request.headers.get('X-Teacher-Code') || '';
        if (code.length < 32 || code.length > 150 || !equalDigest(await sha256(code), settings.admin_hash)) throw new ApiError(401, '管理碼不正確。');
      } else if (!['info', 'start', 'submit', 'survey-submit'].includes(body.action)) throw new ApiError(400, '無效的操作。');
      const exam = await repository.exam(body.examId);
      if (!exam) throw new ApiError(404, '找不到此場測驗，請確認講師提供的網址。');
      const window = examWindow(exam);
      if (body.action === 'info') return reply({ title: exam.title, questionCount: exam.assignment_rules ? exam.assignment_rules.reduce((sum,rule)=>sum+rule.count,0) : exam.questions.length, window });
      if (admin) {
        if (body.action === 'admin-preview') {
          const selected = exam.assignment_rules ? await repository.previewQuestions(exam.id) : exam.questions;
          return reply({title:exam.title,randomized:!!exam.assignment_rules,questions:publicQuestions(selected)});
        }
        if (body.action === 'admin-bank') {
          const keys=await repository.answerKey(exam.id);
          return reply({title:exam.title,bank:true,randomized:!!exam.assignment_rules,questions:exam.questions.map(q=>({...publicQuestions([q])[0],review:{...q.review,answer:keys[q.id]}}))});
        }
        if (body.action === 'admin-roster-add') {
          const identity = normalizeIdentity(body.name, body.studentId);
          await repository.addRoster(exam.id, identity);
          return reply({ ok: true });
        }
        if (body.action === 'admin-roster') return reply({ rows: await repository.roster(exam.id) });
        if (body.action === 'admin-open-now') {
          await repository.openNow(exam.id);
          return reply({ ok: true });
        }
        if (body.action === 'admin-schedule') {
          await repository.setSchedule(exam.id, scheduleForDate(body.date, body.opensTime));
          return reply({ ok: true });
        }
        if (body.action === 'admin-toggle') {
          if (typeof body.open !== 'boolean') throw new ApiError(400, '請指定收卷狀態。');
          await repository.setOpen(exam.id, body.open);
          return reply({ ok: true });
        }
        if (body.action === 'admin-survey') {
          // Only release aggregate distributions after the deadline to avoid
          // identifying a respondent by watching statistics change in real time.
          const available = window.state === 'closed';
          return reply({ available, questions: SURVEY, counts: available ? await repository.surveyStats(exam.id) : [] });
        }
        const offset = body.offset ?? 0;
        if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new ApiError(400, '無效的分頁。');
        const rows = await repository.list(exam.id, offset, 501);
        return reply({ exam: { id: exam.id, title: exam.title, open: exam.open, window }, rows: rows.slice(0, 500), hasMore: rows.length > 500 });
      }
      const identity = normalizeIdentity(body.name, body.studentId);
      const canonicalName = await repository.authorize(exam.id, identity);
      if (!canonicalName) throw new ApiError(403, '姓名或學號不符合本場 B 組名單，請確認資料或聯絡講師。');
      identity.name = canonicalName;
      let record = await repository.submission(exam.id, identity.studentId);
      const receipt = async () => {
        const latestExam = await repository.exam(exam.id);
        const latestWindow = examWindow(latestExam);
        const result = { submitted: true, surveyComplete: !!record.survey_complete, identity, window: latestWindow };
        if (!record.survey_complete && latestWindow.state === 'open') result.survey = SURVEY;
        return reply(result);
      };
      if (body.action === 'survey-submit') {
        if (!record) throw new ApiError(409, '請先完成考試並交卷，再填寫問卷。');
        if (!record.survey_complete) {
          requireOpen(exam);
          await repository.submitSurvey(exam.id, identity.studentId, validateAnswers(body.answers, SURVEY));
          record = await repository.submission(exam.id, identity.studentId);
        }
        return receipt();
      }
      if (record) return receipt();
      requireOpen(exam);
      const selected = exam.assignment_rules ? await repository.assignedQuestions(exam.id, identity) : exam.questions;
      if (body.action === 'start') return reply({title:exam.title,identity,window,questions:publicQuestions(selected)});
      await repository.submit(exam.id, identity, validateAnswers(body.answers, selected));
      record = await repository.submission(exam.id, identity.studentId);
      return receipt();
    } catch (error) {
      if (error instanceof ApiError) return reply({ error: error.message }, error.status);
      return reply({ error: '服務暫時無法處理，請保留此頁並稍後重試。' }, 503);
    }
  };
}
