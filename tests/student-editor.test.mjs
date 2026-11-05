import test from 'node:test';
import assert from 'node:assert/strict';
import {rowValues,assessmentValues,changedRow,changedAssessment} from '../web/student-editor.mjs';
test('existing teacher, zero score, notes and passport are preserved as editable defaults',()=>{
  const row={record:{pairing_status:'paired',actual_teacher:'原有老師',score:0,note:'保留說明'}};
  const original=rowValues(row),draft={values:{...original},original,reconfirm:false};
  assert.deepEqual(draft.values,{pairingStatus:'paired',actualTeacher:'原有老師',score:0,note:'保留說明'});
  assert.equal(changedRow(draft),false);draft.values.score=88;assert.equal(changedRow(draft),true);assert.equal(row.record.score,0);
  const record={suture:0,dressing:98,passport_completion:89.5,note:'原有備註'},a=assessmentValues(record);
  assert.deepEqual(a,{suture:0,dressing:98,passportCompletion:89.5,note:'原有備註'});
  assert.equal(changedAssessment({values:{...a},original:a}),false);
});
test('empty untouched records produce no changes and reconfirmation is explicit',()=>{
  const a=rowValues({record:null});assert.equal(changedRow({values:{...a},original:a,reconfirm:false}),false);
  assert.equal(changedRow({values:{...a},original:a,reconfirm:true}),true);
  const b=assessmentValues(undefined);assert.equal(changedAssessment({values:{...b},original:b}),false);
});
