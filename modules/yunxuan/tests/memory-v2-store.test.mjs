import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  getYunxuanMemoryV2Info,
  importYunxuanMemoryV2Bundle,
  queryYunxuanMemoryV2Context,
  validateYunxuanMemoryV2Bundle,
} from '../memory-v2-store.js';

const bundle = JSON.parse(fs.readFileSync(process.env.YX_MEMORY_V2_BUNDLE, 'utf8'));
function store() {
  return {
    json: {
      events: [{ id: 'legacy-M11', memory_metadata: { authority: 'runtime', visibility: 'limited', known_by: ['ning_yunxi'], witnesses: [], source_message_ids: [], conflict_status: 'none' } }],
      keywords: [], characters: { main: [] }, arcs: [], facts: [],
    },
  };
}

test('bundle validates and imports idempotently while superseding legacy-M', () => {
  assert.equal(validateYunxuanMemoryV2Bundle(bundle).valid, true);
  const s = store();
  const first = importYunxuanMemoryV2Bundle(s, bundle);
  assert.equal(first.nodes, 49);
  assert.equal(first.legacy_superseded, 1);
  assert.equal(s.json.events[0].memory_metadata.conflict_status, 'superseded');
  const second = importYunxuanMemoryV2Bundle(s, bundle);
  assert.equal(second.status, 'already_imported');
  assert.equal(getYunxuanMemoryV2Info(s).nodes, 49);
});

test('recent raw window suppresses first handholding at current record 115', () => {
  const s = store(); importYunxuanMemoryV2Bundle(s, bundle);
  const result = queryYunxuanMemoryV2Context(s, {
    query: '凌雪衣 牵手', currentRecordIndex: 115, mode: 'narrative', perspective: 'assistant', viewerAliases: ['ning_yunxi', '宁云曦'], limit: 12,
  });
  assert.equal(result.suppressed_recent_ids.includes('SCN-LX-007'), true);
  assert.equal(result.selected_ids.includes('SCN-LX-007'), false);
});

test('handholding becomes recallable after it leaves recent raw window', () => {
  const s = store(); importYunxuanMemoryV2Bundle(s, bundle);
  const result = queryYunxuanMemoryV2Context(s, {
    query: '凌雪衣 牵手 下次再问', currentRecordIndex: 140, mode: 'narrative', perspective: 'assistant', viewerAliases: ['ning_yunxi', '宁云曦'], limit: 12,
  });
  assert.equal(result.selected_ids.includes('SCN-LX-007'), true);
});

test('narrative mode never injects OOC reflection/coach', () => {
  const s = store(); importYunxuanMemoryV2Bundle(s, bundle);
  const result = queryYunxuanMemoryV2Context(s, {
    query: '恋爱 现实 关系', currentRecordIndex: 140, mode: 'narrative', perspective: 'assistant', viewerAliases: ['宁云曦'], limit: 20,
  });
  assert.equal(result.sections.reflection_coach.length, 0);
});

test('hybrid assistant mode can recall OOC reflection/coach', () => {
  const s = store(); importYunxuanMemoryV2Bundle(s, bundle);
  const result = queryYunxuanMemoryV2Context(s, {
    query: '我的恋爱想法 点评 指引 现实', currentRecordIndex: 140, mode: 'hybrid', perspective: 'assistant', viewerAliases: ['宁云曦'], limit: 12,
  });
  assert.ok(result.sections.reflection_coach.length > 0);
  assert.ok(result.selected_ids.some(id => id.startsWith('REF-') || id.startsWith('COACH-')));
});

test('NPC perspective physically blocks OOC and respects known_by', () => {
  const s = store(); importYunxuanMemoryV2Bundle(s, bundle);
  const result = queryYunxuanMemoryV2Context(s, {
    query: '研究生 家庭 恋爱 听竹院', currentRecordIndex: 140, mode: 'hybrid', perspective: 'npc', perspectiveAliases: ['qingxiao', '清宵'], viewerAliases: ['宁云曦'], limit: 20,
  });
  assert.equal(result.sections.reflection_coach.length, 0);
  assert.equal(result.removed_visibility_ids.some(id => id.startsWith('REF-') || id.startsWith('COACH-')), true);
});


test('ST message floor is converted to provenance record index using bundle offset', () => {
  const s = store(); importYunxuanMemoryV2Bundle(s, bundle);
  const info = getYunxuanMemoryV2Info(s);
  assert.equal(info.record_index_offset, 1);
  const result = queryYunxuanMemoryV2Context(s, {
    query: '凌雪衣 牵手', currentMessageId: 114, mode: 'narrative', perspective: 'assistant', viewerAliases: ['宁云曦'], limit: 12,
  });
  assert.deepEqual(result.recent_window, [96, 115]);
  assert.equal(result.suppressed_recent_ids.includes('SCN-LX-007'), true);
});
