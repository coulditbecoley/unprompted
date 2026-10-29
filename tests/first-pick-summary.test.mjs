import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPickSummary } from '../app/questions/first-pick-summary.ts';
const answer = (first, extra={}) => ({brands: first ? [{name:first,position:1}] : [],...extra});
test('question first pick counts answered runs, includes brandless answers and excludes failures',()=>{
 const rows=[answer('A'),answer('A'),answer('B'),answer(null),answer('B',{error:'timeout'}),answer('B',{refused:true})];
 assert.equal(firstPickSummary(rows),'Named first most often: A (2 of 4 answers with these filters).');
});
test('question first pick shows every tied leader',()=>{
 assert.equal(firstPickSummary([answer('B'),answer('A'),answer('C')]),'Tied for most first picks: A, B, and C (1 each out of 3 answers with these filters).');
});
test('question first pick handles absence and counts a first brand once per answer',()=>{
 assert.match(firstPickSummary([]),/^No answers/);
 assert.match(firstPickSummary([answer('A',{refused:true})]),/^No answers/);
 assert.equal(firstPickSummary([answer(null)]),'No brand was named first in 1 answer with these filters.');
 assert.equal(firstPickSummary([{brands:[{name:'A',position:1},{name:'A',position:1},{name:'B',position:2}]}]),'Named first most often: A (1 of 1 answer with these filters).');
});
