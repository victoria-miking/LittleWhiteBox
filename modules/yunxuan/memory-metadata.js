export const DEFAULT_YUNXUAN_MEMORY_METADATA = Object.freeze({
    authority: 'runtime',
    visibility: 'public',
    known_by: [],
    witnesses: [],
    source_message_ids: [],
    conflict_status: 'none',
});

export function normalizeYunxuanMemoryMetadata(metadata = {}, defaults = {}) {
    const merged = { ...DEFAULT_YUNXUAN_MEMORY_METADATA, ...defaults, ...(metadata || {}) };
    const authority = ['runtime', 'canon_ref'].includes(merged.authority) ? merged.authority : 'runtime';
    const visibility = ['public', 'known', 'limited', 'author'].includes(merged.visibility) ? merged.visibility : 'public';
    const conflictStatus = ['none', 'canon_conflict', 'superseded'].includes(merged.conflict_status) ? merged.conflict_status : 'none';
    return {
        authority,
        visibility,
        known_by: [...new Set((merged.known_by || []).map(String).filter(Boolean))],
        witnesses: [...new Set((merged.witnesses || []).map(String).filter(Boolean))],
        source_message_ids: [...new Set((merged.source_message_ids || []).map(Number).filter(Number.isInteger))],
        conflict_status: conflictStatus,
    };
}

export function attachYunxuanMemoryMetadata(record, defaults = {}) {
    if (!record || typeof record !== 'object') return record;
    return { ...record, memory_metadata: normalizeYunxuanMemoryMetadata(record.memory_metadata, defaults) };
}
