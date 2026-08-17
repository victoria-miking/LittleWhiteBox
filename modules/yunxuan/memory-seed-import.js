import { normalizeYunxuanMemoryMetadata } from './memory-metadata.js';

function assertMemory(memory) {
    if (!memory || typeof memory !== 'object') throw new TypeError('Memory seed item must be an object.');
    if (!String(memory.id || '').trim()) throw new TypeError('Memory seed item id is required.');
    if (!String(memory.text || '').trim()) throw new TypeError(`Memory seed item ${memory.id} text is required.`);
    const metadata = normalizeYunxuanMemoryMetadata(memory.metadata || memory.memory_metadata || {});
    if (metadata.authority !== 'runtime') throw new Error(`Memory seed item ${memory.id} must use runtime authority.`);
    if (metadata.visibility === 'author') throw new Error(`Memory seed item ${memory.id} cannot use author visibility.`);
    return metadata;
}

export function projectMemoryToStoryEvent(memory, boundaryMessageId = -1) {
    const metadata = assertMemory(memory);
    const boundary = Number.isInteger(boundaryMessageId) ? boundaryMessageId : -1;
    return {
        id: String(memory.id).trim(),
        title: String(memory.id).trim(),
        timeLabel: '',
        summary: String(memory.text),
        participants: [...metadata.witnesses],
        type: '连续性',
        weight: '核心',
        causedBy: [],
        relevance: Number(memory.relevance ?? 1),
        _addedAt: boundary,
        memory_metadata: metadata,
    };
}

export function listProjectMemoryIds(store, { prefix = '' } = {}) {
    const expectedPrefix = String(prefix || '');
    return (store?.json?.events || [])
        .map(event => String(event?.id || ''))
        .filter(id => id && (!expectedPrefix || id.startsWith(expectedPrefix)));
}

export function importProjectMemorySeed(store, memories, { boundaryMessageId = -1 } = {}) {
    if (!store || typeof store !== 'object') throw new Error('Story Summary store unavailable.');
    if (!Array.isArray(memories)) throw new TypeError('Memory seed must be an array.');

    store.json ||= {
        keywords: [],
        events: [],
        characters: { main: [] },
        arcs: [],
        facts: [],
    };
    store.json.events ||= [];

    const existingIds = new Set(listProjectMemoryIds(store));
    const insertedEvents = [];
    const skippedIds = [];

    for (const memory of memories) {
        const id = String(memory?.id || '').trim();
        if (existingIds.has(id)) {
            skippedIds.push(id);
            continue;
        }
        const event = projectMemoryToStoryEvent(memory, boundaryMessageId);
        store.json.events.push(event);
        existingIds.add(event.id);
        insertedEvents.push(event);
    }

    if (insertedEvents.length) store.updatedAt = Date.now();
    return {
        inserted: insertedEvents.length,
        skipped: skippedIds.length,
        inserted_ids: insertedEvents.map(event => event.id),
        skipped_ids: skippedIds,
        total_project_memories: memories.filter(memory => existingIds.has(String(memory?.id || '').trim())).length,
        inserted_events: insertedEvents,
    };
}
