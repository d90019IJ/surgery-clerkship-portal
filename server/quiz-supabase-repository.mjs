import { ApiError } from './quiz-application.mjs';
export function supabaseRepository(url, key) {
  if (!url || !key) throw new Error('Missing server configuration');
  async function query(path, options = {}) {
    const response = await fetch(url + '/rest/v1/' + path, {
      ...options, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.code === '23505') throw new ApiError(409, '此學號已在應考名單中，請先核對現有資料。');
      const known = {
        OPEN_NOW_UNAVAILABLE: [409, '僅能在考試當天、截止前立即開放；請先確認已儲存的考試日期。'],
        ASSIGNMENT_REQUIRED: [409, '請重新進入本場考試以載入固定題組。'],
        ROSTER_DENIED: [403, '姓名或學號不符合本場 B 組名單，請確認資料或聯絡講師。'],
        EXAM_CLOSED: [409, '考試與問卷未開放或已超過 19:30 截止時間。'],
        INVALID_ANSWERS: [400, '請完成所有題目後再送出。'],
        QUIZ_REQUIRED: [409, '請先完成考試並交卷，再填寫問卷。']
      };
      if (known[error.message]) throw new ApiError(...known[error.message]);
      throw new Error('Database operation failed');
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const eq = encodeURIComponent;
  const rpc = (name, body) => query('rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
  return {
    async settings() {
      const rows = await query('core_quiz_settings?select=admin_hash,allowed_origins&id=eq.1');
      if (!rows?.length) throw new Error('Quiz not configured');
      return rows[0];
    },
    async answerKey(id) { return (await query('core_quiz_exams?select=answer_key&id=eq.'+eq(id)+'&limit=1'))[0].answer_key; },
    async previewQuestions(id) { return rpc('core_quiz_pick_questions',{p_exam_id:id}); },
    async assignedQuestions(id,identity) { return rpc('core_quiz_assign',{p_exam_id:id,p_student_id:identity.studentId,p_name:identity.name}); },
    async exam(id) { return rpc('core_quiz_context', { p_exam_id: id }); },
    async addRoster(examId, identity) {
      await query('core_quiz_roster', {method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({exam_id:examId,student_id:identity.studentId,name:identity.name,group_name:'B'})});
    },
    async authorize(examId, identity) { return rpc('core_quiz_authorize', {p_exam_id:examId,p_student_id:identity.studentId,p_name:identity.name}); },
    async roster(examId) { return query('core_quiz_roster?select=student_id,name,group_name&exam_id=eq.' + eq(examId) + '&order=student_id.asc&limit=1000'); },
    async submission(examId, studentId) {
      return (await query('core_quiz_submissions?select=survey_complete&exam_id=eq.' + eq(examId) + '&student_id=eq.' + eq(studentId) + '&limit=1'))[0];
    },
    async submit(examId, identity, answers) {
      await rpc('core_quiz_submit', { p_exam_id: examId, p_student_id: identity.studentId, p_name: identity.name, p_answers: answers });
    },
    async submitSurvey(examId, studentId, answers) {
      await rpc('core_quiz_survey_submit', { p_exam_id: examId, p_student_id: studentId, p_answers: answers });
    },
    async list(examId, offset, limit) {
      return query('core_quiz_submissions?select=name,student_id,submitted_at,score,answers,survey_complete,question_ids&exam_id=eq.' + eq(examId) + '&order=submitted_at.asc,student_id.asc&offset=' + offset + '&limit=' + limit);
    },
    async surveyStats(examId) {
      return query('core_quiz_survey_counts?select=item_id,choice,response_count&exam_id=eq.' + eq(examId) + '&order=item_id.asc,choice.asc');
    },
    async openNow(id) { await rpc('core_quiz_open_now', {p_exam_id:id}); },
    async setOpen(id, open) { await query('core_quiz_exams?id=eq.' + eq(id), { method: 'PATCH', body: JSON.stringify({ open }) }); },
    async setSchedule(id, schedule) { await query('core_quiz_exams?id=eq.' + eq(id), { method: 'PATCH', body: JSON.stringify(schedule) }); }
  };
}
