// Offline audit probes: these assert observed defects, not desired behavior.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { consensus, engineDivergence, movement, standings, theSnub } from '../../lib/metrics.ts';

const answer = (engine, brand, run_index) => ({
  engine, question_id: 'q1', run_index,
  brands: [{ name: brand, position: 1 }], sources: [], error: null, refused: false,
});
const run = { category: 'example', run_date: '2026-09-01', method_version: 1,
  runs_per_question: 2, engines: ['a', 'b', 'c'], extractions: [] };
const tied = { ...run, extractions: run.engines.flatMap(e => [answer(e, 'Alpha', 0), answer(e, 'Beta', 1)]) };
const tiedRows = consensus(tied, {q1:'Example?'});
assert.equal(tiedRows[0].settled, true);
assert.equal(tiedRows[0].picks[0].share, 0.5);
const split = { ...run, extractions: run.engines.map((e,i) => answer(e, ['Alpha','Beta','Gamma'][i], 0)) };
const divergence = engineDivergence(consensus(split, {}));
assert.equal(divergence.find(d => d.engine === 'a').differs, 0);
assert.equal(divergence.find(d => d.engine === 'b').differs, 1);
const before = standings({...run, extractions: [answer('a','Rare',0)]});
const after = standings({...run, extractions: [answer('a','Other',0)]});
const snub = theSnub(movement(after, before));
assert.equal(snub.brand, 'Rare');
assert.equal(snub.significant, true);
const evidence = {tied_question_reported_settled:tiedRows[0], no_majority_divergence:divergence, one_sample_dropout_called_significant:snub};
writeFileSync(new URL('./metrics-evidence.json', import.meta.url), JSON.stringify(evidence,null,2)+'\n');
console.log('Three statistical presentation defects reproduced.');
