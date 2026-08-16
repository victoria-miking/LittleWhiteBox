import test from 'node:test';
import assert from 'node:assert/strict';

import { YunxuanCanonProvider } from '../canon-provider.js';
import { filterYunxuanMemoryCandidates } from '../knowledge-filter.js';
import { normalizeYunxuanMemoryMetadata } from '../memory-metadata.js';
import { YUNXUAN_PLANNER_BLOCKS } from '../planner-preset.js';
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
