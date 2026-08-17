import test from 'node:test';
import assert from 'node:assert/strict';

import { YunxuanCanonProvider } from '../canon-provider.js';
import { filterYunxuanMemoryCandidates, filterYunxuanRecallResult, getLastYunxuanRecallMetrics } from '../knowledge-filter.js';
import { normalizeYunxuanMemoryMetadata } from '../memory-metadata.js';
import { importProjectMemorySeed, listProjectMemoryIds } from '../memory-seed-import.js';
import { YUNXUAN_PLANNER_BLOCKS } from '../planner-preset.js';
import { isBlankYunxuanRuntime } from '../runtime-seed-guard.js';
import { stripYunxuanTurnEnvelope } from '../turn-envelope.js';

test('Story Summary metadata 提供完整安全默认值', () => {
    assert.deepEqual(normalizeYunxuanMemoryMetadata({}, { source_message_ids: [3] }), {
        authority: 'runtime',
        visibility: 'public',
        known_by: [],
        witnesses: [],
        source_message_ids: [3],
        conflict_status: 'none',
    });
});

test('recall metrics count author and canon-conflict removals without retaining content', () => {
    globalThis.LittleWhiteBoxYunxuan = { getRuntimeSnapshotSync: () => ({ yunxuan: { meta: { viewer: { primary_character_id: 'ning_yunxi' } } } }) };
    const author = { id: 'author-sentinel', memory_metadata: { authority: 'runtime', visibility: 'author', known_by: [], conflict_status: 'clean' } };
    const conflict = { id: 'wrong-canon', memory_metadata: { authority: 'runtime', visibility: 'public', known_by: [], conflict_status: 'canon_conflict' } };
    const publicMemory = { id: 'public-memory', memory_metadata: { authority: 'runtime', visibility: 'public', known_by: [], conflict_status: 'clean' } };
    const result = filterYunxuanRecallResult({ events: [author, conflict, publicMemory], causalChain: [], l0Selected: [], l1ByFloor: new Map() });
    assert.deepEqual(result.events.map(item => item.id), ['public-memory']);
    assert.deepEqual(getLastYunxuanRecallMetrics(), { candidates: 3, accepted: 1, removed: 2, author_removed: 1, conflict_removed: 1 });
    delete globalThis.LittleWhiteBoxYunxuan;
});

test('Knowledge Filter 在普通模式彻底移除 author 与冲突项', () => {
    const candidates = [
        { id: 'public', memory_metadata: { visibility: 'public', authority: 'runtime' } },
        { id: 'author', memory_metadata: { visibility: 'author', authority: 'canon_ref' } },
        { id: 'conflict', memory_metadata: { visibility: 'public', authority: 'runtime', conflict_status: 'canon_conflict' } },
        { id: 'known', memory_metadata: { visibility: 'known', authority: 'runtime', known_by: ['ning_yunxi'] } },
    ];
    assert.deepEqual(filterYunxuanMemoryCandidates(candidates, { viewerId: 'ning_yunxi' }).map(item => item.id), ['public', 'known']);
});

test('Canon Guard 按字段策略拒绝 immutable/author_only', () => {
    const provider = new YunxuanCanonProvider({
        default_policy: 'runtime_mutable',
        policies: [
            { path: 'entities.characters.*.identity', policy: 'immutable' },
            { path: 'entities.characters.*.true_realm', policy: 'author_only' },
        ],
    });
    assert.equal(provider.validateOperations([{ path: 'scene.location_id' }]).valid, true);
    assert.equal(provider.validateOperations([{ path: 'entities.characters.qingxiao.true_realm' }]).valid, false);
});

test('总结清洗移除 yx_turn 且保留剧情正文', () => {
    const text = '剧情正文。\n<yx_turn>{"schema_version":"1.0.0"}</yx_turn>';
    assert.equal(stripYunxuanTurnEnvelope(text), '剧情正文。');
});

test('ENA 内置云璇 Planner 不含旧璇花宫与成人规则', () => {
    const text = YUNXUAN_PLANNER_BLOCKS.map(block => block.content).join('\n');
    assert.match(text, /Runtime/);
    assert.match(text, /知识域/);
    assert.doesNotMatch(text, /色情事件推进槽/);
});

test('受控 Memory Seed import 按 id 补缺并保留人工修订', () => {
    const store = { json: { keywords: [], events: [], characters: { main: [] }, arcs: [], facts: [] } };
    const memories = [{
        id: 'legacy-M01',
        text: '已审核原文',
        relevance: 1,
        metadata: {
            authority: 'runtime',
            visibility: 'limited',
            known_by: ['ning_yunxi'],
            witnesses: ['ning_yunxi'],
            source_message_ids: [],
            conflict_status: 'none',
        },
    }];

    const first = importProjectMemorySeed(store, memories, { boundaryMessageId: 8 });
    assert.deepEqual({ inserted: first.inserted, skipped: first.skipped }, { inserted: 1, skipped: 0 });
    assert.deepEqual(listProjectMemoryIds(store, { prefix: 'legacy-' }), ['legacy-M01']);
    assert.equal(store.json.events[0].summary, '已审核原文');
    assert.deepEqual(store.json.events[0].memory_metadata.source_message_ids, []);

    store.json.events[0].summary = '人工修订后文本';
    const second = importProjectMemorySeed(store, memories, { boundaryMessageId: 9 });
    assert.deepEqual({ inserted: second.inserted, skipped: second.skipped }, { inserted: 0, skipped: 1 });
    assert.equal(store.json.events[0].summary, '人工修订后文本');
});

test('空白 Runtime Guard 只接受未发生剧情的 revision 0 状态', () => {
    const blank = {
        yunxuan: {
            meta: { revision: 0, phase_id: '', branch: { last_committed_message_id: -1 } },
            scene: { location_id: null, present_character_ids: [] },
            entities: { characters: {} },
            relationships: {},
            commitments: {},
            events: {},
            knowledge: { facts: {} },
            flags: {},
        },
    };
    assert.equal(isBlankYunxuanRuntime(blank), true);
    blank.yunxuan.scene.location_id = 'student_registry';
    assert.equal(isBlankYunxuanRuntime(blank), false);
});
