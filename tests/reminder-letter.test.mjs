import test from 'node:test';
import assert from 'node:assert/strict';
import {REMINDER_SUBJECT,reminderLetterHTML,reminderTemplateHTML} from '../web/reminder-letter.mjs';
test('approved letter lists every student placement in one teacher letter with month guidance and signature',()=>{
 const group={contact:{name:'示範老師'},students:[{studentId:'001',name:'學生甲',placements:[{unit:'一般外科',start:'2026-09-28',end:'2026-10-09'},{unit:'胸腔外科',start:'2026-10-12',end:'2026-10-23'}]},{studentId:'002',name:'學生乙',placements:[{unit:'一般外科',start:'2026-10-26',end:'2026-11-06'}]}]},before=structuredClone(group),html=reminderLetterHTML(group);
 assert.ok(html.includes(REMINDER_SUBJECT));assert.equal((html.match(/<tbody>/g)||[]).length,1);assert.equal((html.match(/<tr>/g)||[]).length,4);assert.ok(html.includes('2026/09/28～2026/10/09'));assert.ok(html.includes('2026/10/26～2026/11/06'));assert.ok(html.includes('分別切換月份'));assert.ok(html.includes('林憶柔<br>醫學系外科學科'));assert.deepEqual(group,before);
});
test('dynamic names, IDs, units and dates are escaped; fixed template remains readable without current recipients',()=>{
 const html=reminderLetterHTML({contact:{name:'<script>test</script>'},students:[{studentId:'<x>',name:'<img onerror=x>',placements:[{unit:'&test',start:'<start>',end:'<end>'}]}]});assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&amp;test'));assert.ok(reminderTemplateHTML().includes('【老師姓名】'));assert.ok(reminderTemplateHTML().includes('【學號】'));
});
