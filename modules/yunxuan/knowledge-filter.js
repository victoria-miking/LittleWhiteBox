import { normalizeYunxuanMemoryMetadata } from './memory-metadata.js';

let lastRecallMetrics = { candidates: 0, accepted: 0, removed: 0, author_removed: 0, conflict_removed: 0 };
let lastRecallDebug = { accepted_ids: [], removed_ids: [] };

function metadataOf(candidate) {
    return normalizeYunxuanMemoryMetadata(candidate?.memory_metadata || candidate?.metadata || candidate?.event?.memory_metadata || candidate?.atom?.memory_metadata || {});
}

function isVisible(candidate, viewerId, allowAuthor = false) {
    const metadata = metadataOf(candidate);
    if (metadata.visibility === 'author') return allowAuthor;
    if (metadata.visibility === 'public') return true;
    return !!viewerId && metadata.known_by.includes(viewerId);
}

export function filterYunxuanMemoryCandidates(candidates = [], options = {}) {
    const viewerId = options.viewerId || '';
    const allowAuthor = options.allowAuthor === true;
    const acceptedAuthorities = options.acceptedAuthorities || ['runtime', 'canon_ref'];
    return candidates
        .filter(candidate => Number(candidate?.relevance ?? candidate?.similarity ?? 1) >= Number(options.relevanceThreshold ?? -Infinity))
        .filter(candidate => acceptedAuthorities.includes(metadataOf(candidate).authority))
        .filter(candidate => metadataOf(candidate).visibility !== 'author' || allowAuthor)
        .filter(candidate => isVisible(candidate, viewerId, allowAuthor))
        .filter(candidate => !['canon_conflict', 'superseded'].includes(metadataOf(candidate).conflict_status));
}

function filterMapValues(map, viewer) {
    if (!(map instanceof Map)) return map;
    const result = new Map();
    for (const [key, values] of map) {
        const filtered = filterYunxuanMemoryCandidates(values || [], viewer);
        if (filtered.length) result.set(key, filtered);
    }
    return result;
}

export function getYunxuanViewer() {
    const snapshot = globalThis.LittleWhiteBoxYunxuan?.getRuntimeSnapshotSync?.();
    const runtime = snapshot?.yunxuan || null;
    return {
        viewerId: runtime?.meta?.viewer?.primary_character_id || '',
        allowAuthor: false,
    };
}

export function filterYunxuanRecallResult(result) {
    if (!result || typeof result !== 'object') return result;
    const viewer = getYunxuanViewer();
    const buckets = [
        ...(result.events || []),
        ...(result.causalChain || []),
        ...(result.l0Selected || []),
        ...([...((result.l1ByFloor instanceof Map) ? result.l1ByFloor.values() : [])].flat()),
    ];
    const filtered = {
        ...result,
        events: filterYunxuanMemoryCandidates(result.events || [], viewer),
        causalChain: filterYunxuanMemoryCandidates(result.causalChain || [], viewer),
        l0Selected: filterYunxuanMemoryCandidates(result.l0Selected || [], viewer),
        l1ByFloor: filterMapValues(result.l1ByFloor, viewer),
    };
    const acceptedBuckets = [
        ...(filtered.events || []),
        ...(filtered.causalChain || []),
        ...(filtered.l0Selected || []),
        ...([...((filtered.l1ByFloor instanceof Map) ? filtered.l1ByFloor.values() : [])].flat()),
    ];
    const acceptedSet = new Set(acceptedBuckets);
    const idOf = item => String(item?.id || item?.event?.id || item?.atom?.id || 'anonymous');
    const removed = buckets.filter(item => !acceptedSet.has(item));
    lastRecallMetrics = {
        candidates: buckets.length,
        accepted: acceptedBuckets.length,
        removed: removed.length,
        author_removed: removed.filter(item => metadataOf(item).visibility === 'author').length,
        conflict_removed: removed.filter(item => ['canon_conflict', 'superseded'].includes(metadataOf(item).conflict_status)).length,
    };
    lastRecallDebug = {
        accepted_ids: acceptedBuckets.map(idOf),
        removed_ids: removed.map(idOf),
    };
    return filtered;
}

export function getLastYunxuanRecallMetrics() {
    return structuredClone(lastRecallMetrics);
}

export function getLastYunxuanRecallDebug() {
    return structuredClone(lastRecallDebug);
}
