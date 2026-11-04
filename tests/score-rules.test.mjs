import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeTotals,studentCohorts,validScore} from '../web/score-rules.mjs';
const rows=[80,90,95,95].map((score,i)=>({id:String(i),studentId:'TEST',batch:'A',start:'2026-11-01',end:'2026-12-31',unit:'外科',included:true,record:{pairing_status:'paired',score}}));
test('physician 80% plus the average of two OSCE scores at 20%',()=>{const r=gradeTotals(rows,{suture:80,dressing:100});assert.equal(r.average,90);assert.equal(r.physicianWeighted,72);assert.equal(r.osceAverage,90);assert.equal(r.osceWeighted,18);assert.equal(r.subtotal,90);});
test('missing components are not zero; genuine zero and decimal scores are valid',()=>{for(const osce of [{},{suture:80},{suture:null,dressing:100}])assert.equal(gradeTotals(rows,osce).subtotal,null);assert.equal(gradeTotals(rows,{suture:0,dressing:0}).subtotal,72);assert.equal(gradeTotals(rows,{suture:88.5,dressing:91.5}).osceAverage,90);assert.equal(gradeTotals(rows.slice(0,1).map(r=>({...r,record:null})),{suture:100,dressing:100}).subtotal,null);for(const v of [-1,101,NaN,Infinity,'90',undefined])assert.equal(validScore(v),false);});
test('unpaired, missing, or changed doctor results block the subtotal; excluded units do not count',()=>{for(const change of [{record:null},{selectionChanged:true},{unit:''},{record:{pairing_status:'unpaired',score:90}}])assert.equal(gradeTotals([{...rows[0],...change},...rows.slice(1)],{suture:80,dressing:100}).subtotal,null);assert.equal(gradeTotals([...rows,{unit:'影像',included:false}],{suture:80,dressing:100}).subtotal,90);});
test('OSCE belongs to a full student batch and remains separate across batches',()=>{const cohorts=studentCohorts([...rows,{...rows[0],batch:'B',start:'2027-01-01',end:'2027-02-28'}]);assert.equal(cohorts.length,2);assert.notEqual(cohorts[0].id,cohorts[1].id);assert.equal(cohorts[0].rows.length,4);assert.equal(studentCohorts([...rows].reverse())[0].id,cohorts[0].id);});
test('passport below 90 deducts exactly 10 after weighting; exactly 90 does not deduct',()=>{
  for(const completion of [0,80,89.99,89.9999]){const t=gradeTotals(rows,{suture:80,dressing:100,passport_completion:completion});assert.equal(t.subtotal,90);assert.equal(t.passportDeduction,10);assert.equal(t.finalScore,80);}
  for(const completion of [90,90.01,100]){const t=gradeTotals(rows,{suture:80,dressing:100,passport_completion:completion});assert.equal(t.passportDeduction,0);assert.equal(t.finalScore,90);}
});
test('unknown passport or incomplete assessment never produces a final score',()=>{
  for(const completion of [undefined,null,'90',-1,101,NaN]){const t=gradeTotals(rows,{suture:80,dressing:100,passport_completion:completion});assert.equal(t.passportDeduction,null);assert.equal(t.finalScore,null);}
  assert.equal(gradeTotals(rows,{suture:80,dressing:null,passport_completion:90}).finalScore,null);
  assert.equal(gradeTotals([{...rows[0],record:null}],{suture:80,dressing:100,passport_completion:90}).finalScore,null);
  // Apply the requested subtraction without silently adding a zero floor.
  assert.equal(gradeTotals(rows.map(r=>({...r,record:{pairing_status:'paired',score:0}})),{suture:0,dressing:0,passport_completion:0}).finalScore,-10);
});
