function isEmptyObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

export function isBlankYunxuanRuntime(snapshot) {
    const runtime = snapshot?.yunxuan;
    if (!runtime || typeof runtime !== 'object') return false;
    return runtime.meta?.revision === 0
        && runtime.meta?.branch?.last_committed_message_id === -1
        && !runtime.meta?.phase_id
        && runtime.scene?.location_id == null
        && (runtime.scene?.present_character_ids || []).length === 0
        && isEmptyObject(runtime.entities?.characters)
        && isEmptyObject(runtime.relationships)
        && isEmptyObject(runtime.commitments)
        && isEmptyObject(runtime.events)
        && isEmptyObject(runtime.knowledge?.facts)
        && isEmptyObject(runtime.flags);
}
