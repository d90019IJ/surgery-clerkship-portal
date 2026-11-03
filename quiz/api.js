export async function request(action, data = {}, adminCode = '') {
  const config = window.QUIZ_CONFIG || {};
  if (!config.apiUrl) throw new Error('測驗尚未開放，請聯絡講師。');
  const headers = { 'Content-Type': 'application/json' };
  if (adminCode) headers['X-Teacher-Code'] = adminCode;
  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST', headers, cache: 'no-store',
      body: JSON.stringify({ action, examId: config.examId, ...data }),
      signal: AbortSignal.timeout(25000)
    });
  } catch {
    throw new Error('連線中斷，尚未確認送出結果。請保留此頁並重試或重新查詢完成狀態；系統不會重複計入。');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('服務暫時無法回應，請稍後重試。'); }
  if (!response.ok) throw new Error(result.error || '操作未完成，請稍後重試。');
  return result;
}

export function currentExam() {
  const value = new URLSearchParams(location.search).get('exam');
  if (value && /^[a-zA-Z0-9-]{1,80}$/.test(value)) window.QUIZ_CONFIG.examId = value;
}
