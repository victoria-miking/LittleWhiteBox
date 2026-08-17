const STORE_KEY = 'yunxuan_memory_v2';
const RECENT_TYPES = new Set(['scene_memory', 'reflection_memory', 'coach_memory']);
const STATE_TYPES = new Set(['relationship_memory', 'fact_memory']);
const VALID_MODES = new Set(['narrative', 'coach', 'hybrid']);
const VALID_PERSPECTIVES = new Set(['assistant', 'npc']);
const PRIORITY_SCORE = Object.freeze({ critical: 8, high: 5, normal: 2, low: 0 });

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function textTokens(value) {
  const text = normalizeText(value);
  const latin = text.match(/[a-z0-9_\-]{2,}/g) || [];
  const cjkRuns = text.match(/[\p{Script=Han}]{2,}/gu) || [];
  const cjk = [];
  for (const run of cjkRuns) {
    cjk.push(run);
    for (let i = 0; i < run.length - 1; i += 1) cjk.push(run.slice(i, i + 2));
  }
  return [...new Set([...latin, ...cjk])];
}

function nodeSearchText(node) {
  const retrieval = node?.retrieval || {};
  const parts = [
    node?.memory_id,
    node?.title,
    ...(retrieval.entities || []),
    ...(retrieval.semantic_tags || []),
    ...(retrieval.trigger_phrases || []),
  ];
  if (node?.memory_type === 'relationship_memory') {
    parts.push(...(node?.pair || []));
    parts.push(JSON.stringify(node?.state || {}));
  } else if (node?.memory_type === 'fact_memory') {
    parts.push(node?.subject, node?.predicate, typeof node?.value === 'string' ? node.value : JSON.stringify(node?.value));
  } else if (node?.memory_type === 'reflection_memory') {
    parts.push(node?.explicit_user_insight, node?.emotional_context, node?.growth_direction);
  } else if (node?.memory_type === 'coach_memory') {
    parts.push(node?.principle, ...(node?.context_conditions || []), ...(node?.procedure || []), ...(node?.caveats || []));
  } else if (node?.memory_type === 'scene_memory') {
    parts.push(node?.entry_state?.immediate_context, node?.relationship_delta?.after, ...(node?.evidence_chain || []));
    for (const beat of node?.beats || []) parts.push(beat.actor, beat.action, beat.dialogue, beat.reaction);
    for (const anchor of node?.dialogue_anchors || []) parts.push(anchor.speaker, anchor.text);
  }
  return normalizeText(parts.filter(Boolean).join(' '));
}

function validateNode(node) {
  if (!isObject(node)) throw new TypeError('Memory v2 node must be an object.');
  if (!String(node.memory_id || '').trim()) throw new TypeError('Memory v2 memory_id is required.');
  if (!String(node.memory_type || '').trim()) throw new TypeError(`Memory v2 ${node.memory_id}: memory_type is required.`);
  if (!isObject(node.visibility)) throw new TypeError(`Memory v2 ${node.memory_id}: visibility is required.`);
  if (!['in_world', 'ooc', 'author'].includes(node.visibility.layer)) throw new Error(`Memory v2 ${node.memory_id}: invalid visibility.layer.`);
  if (!Array.isArray(node.visibility.known_by)) throw new Error(`Memory v2 ${node.memory_id}: visibility.known_by must be an array.`);
  if (!isObject(node.provenance) || !Array.isArray(node.provenance.source_records)) throw new Error(`Memory v2 ${node.memory_id}: provenance.source_records is required.`);
}

export function validateYunxuanMemoryV2Bundle(bundle) {
  const errors = [];
  if (!isObject(bundle)) return { valid: false, errors: ['bundle_not_object'] };
  if (String(bundle.schema_version) !== '2.0') errors.push('schema_version');
  if (!String(bundle.bundle_id || '').trim()) errors.push('bundle_id');
  if (!Array.isArray(bundle.nodes)) errors.push('nodes');
  const ids = new Set();
  for (const node of bundle.nodes || []) {
    try { validateNode(node); } catch (error) { errors.push(error.message); continue; }
    if (ids.has(node.memory_id)) errors.push(`duplicate:${node.memory_id}`);
    ids.add(node.memory_id);
  }
  return { valid: errors.length === 0, errors };
}

function ensureSummaryJson(store) {
  if (!store || typeof store !== 'object') throw new Error('Story Summary store unavailable.');
  store.json ||= { keywords: [], events: [], characters: { main: [] }, arcs: [], facts: [] };
  store.json.events ||= [];
  return store.json;
}

export function getYunxuanMemoryV2Store(store) {
  const json = ensureSummaryJson(store);
  return json[STORE_KEY] || null;
}

function markLegacyEventsSuperseded(json) {
  let changed = 0;
  for (const event of json.events || []) {
    if (!/^legacy-M\d+$/u.test(String(event?.id || ''))) continue;
    event.memory_metadata ||= {};
    if (event.memory_metadata.conflict_status !== 'superseded') {
      event.memory_metadata.conflict_status = 'superseded';
      changed += 1;
    }
  }
  return changed;
}

export function importYunxuanMemoryV2Bundle(store, bundle, { force = false, supersedeLegacy = true } = {}) {
  const validation = validateYunxuanMemoryV2Bundle(bundle);
  if (!validation.valid) throw new Error(`memory_v2_bundle_invalid:${validation.errors.join(',')}`);
  const json = ensureSummaryJson(store);
  const current = json[STORE_KEY];
  const historyHash = bundle?.generated_from?.history_sha256 || null;
  if (!force && current?.bundle_id === bundle.bundle_id && current?.generated_from?.history_sha256 === historyHash) {
    const legacySuperseded = supersedeLegacy ? markLegacyEventsSuperseded(json) : 0;
    return { status: 'already_imported', imported: false, bundle_id: bundle.bundle_id, nodes: current.nodes?.length || 0, legacy_superseded: legacySuperseded };
  }
  if (current && !force) throw new Error(`memory_v2_existing_bundle:${current.bundle_id || 'unknown'}`);
  json[STORE_KEY] = structuredClone(bundle);
  const legacySuperseded = supersedeLegacy ? markLegacyEventsSuperseded(json) : 0;
  store.updatedAt = Date.now();
  return { status: current ? 'replaced' : 'imported', imported: true, bundle_id: bundle.bundle_id, nodes: bundle.nodes.length, legacy_superseded: legacySuperseded };
}

export function getYunxuanMemoryV2Info(store) {
  const bundle = getYunxuanMemoryV2Store(store);
  if (!bundle) return null;
  const counts = {};
  for (const node of bundle.nodes || []) counts[node.memory_type] = (counts[node.memory_type] || 0) + 1;
  return {
    schema_version: bundle.schema_version,
    bundle_id: bundle.bundle_id,
    history_sha256: bundle?.generated_from?.history_sha256 || null,
    nodes: bundle.nodes?.length || 0,
    counts,
    recent_raw_history_floors: bundle?.runtime_policy?.recent_raw_history_floors ?? 20,
    history_records: bundle?.generated_from?.history_records ?? null,
    history_messages: bundle?.generated_from?.history_messages ?? null,
    record_index_offset: Number.isInteger(bundle?.generated_from?.history_records) && Number.isInteger(bundle?.generated_from?.history_messages)
      ? bundle.generated_from.history_records - bundle.generated_from.history_messages
      : 0,
  };
}

function aliasesContain(knownBy, aliases) {
  const known = new Set(uniqueStrings(knownBy).map(normalizeText));
  return uniqueStrings(aliases).some(alias => known.has(normalizeText(alias)));
}

function visibleForRequest(node, request) {
  const visibility = node.visibility || {};
  if (visibility.available_to_assistant === false) return false;
  if (visibility.layer === 'author') return false;
  const mode = VALID_MODES.has(request.mode) ? request.mode : 'narrative';
  const perspective = VALID_PERSPECTIVES.has(request.perspective) ? request.perspective : 'assistant';
  if (visibility.layer === 'ooc') return perspective === 'assistant' && (mode === 'coach' || mode === 'hybrid');
  if (visibility.layer !== 'in_world') return false;
  if (perspective === 'npc') {
    if (visibility.inject_into_npc_pov !== true) return false;
    return aliasesContain(visibility.known_by, request.perspectiveAliases || []);
  }
  const aliases = request.viewerAliases || [];
  if (!aliases.length) return true;
  return aliasesContain(visibility.known_by, aliases)
    || (node.memory_type === 'relationship_memory' && (node.pair || []).some(item => aliasesContain([item], aliases)))
    || (node.memory_type === 'fact_memory' && aliasesContain([node.subject], aliases));
}

function recentOverlap(node, currentRecordIndex, recentWindow) {
  if (!RECENT_TYPES.has(node.memory_type)) return false;
  if (!Number.isInteger(currentRecordIndex) || currentRecordIndex < 0) return false;
  const start = Math.max(0, currentRecordIndex - recentWindow + 1);
  return (node?.provenance?.source_records || []).some(record => Number.isInteger(record) && record >= start && record <= currentRecordIndex);
}

function typeModeBoost(node, mode) {
  if (mode === 'coach') {
    if (node.memory_type === 'reflection_memory') return 8;
    if (node.memory_type === 'coach_memory') return 8;
    if (node.memory_type === 'relationship_memory') return 3;
    if (node.memory_type === 'scene_memory') return 1;
  }
  if (mode === 'hybrid') {
    if (node.memory_type === 'relationship_memory' || node.memory_type === 'fact_memory') return 6;
    if (node.memory_type === 'scene_memory') return 5;
    if (node.memory_type === 'reflection_memory' || node.memory_type === 'coach_memory') return 5;
  }
  if (node.memory_type === 'relationship_memory' || node.memory_type === 'fact_memory') return 7;
  if (node.memory_type === 'scene_memory') return 6;
  return -8;
}

function lexicalScore(node, query) {
  const q = normalizeText(query);
  if (!q) return 0;
  const haystack = nodeSearchText(node);
  let score = 0;
  if (haystack.includes(q)) score += 12;
  for (const token of textTokens(q)) {
    if (!token) continue;
    if (haystack.includes(token)) score += token.length >= 4 ? 2.5 : 1.25;
  }
  for (const entity of node?.retrieval?.entities || []) {
    if (q.includes(normalizeText(entity))) score += 4;
  }
  for (const trigger of node?.retrieval?.trigger_phrases || []) {
    if (q.includes(normalizeText(trigger))) score += 5;
  }
  return score;
}

function compactNode(node) {
  const common = {
    memory_id: node.memory_id,
    memory_type: node.memory_type,
    title: node.title,
    visibility: structuredClone(node.visibility),
    provenance: { source_records: [...(node?.provenance?.source_records || [])] },
  };
  if (node.memory_type === 'scene_memory') return {
    ...common,
    tier: node?.preservation?.tier || 'compact',
    participants: [...(node?.identity?.participants || [])],
    location: node?.identity?.location || '',
    time: node?.identity?.in_world_time || '',
    entry_context: node?.entry_state?.immediate_context || '',
    beats: (node?.beats || []).filter(beat => beat.required_for_recall !== false).map(beat => ({ actor: beat.actor, action: beat.action, dialogue: beat.dialogue || '', reaction: beat.reaction || '' })),
    dialogue_anchors: (node?.dialogue_anchors || []).filter(anchor => anchor.importance === 'high' || anchor.verbatim).map(anchor => ({ speaker: anchor.speaker, text: anchor.text })),
    relationship_after: node?.relationship_delta?.after || '',
    not_implied: [...(node?.relationship_delta?.not_implied || [])],
    aftertaste: [...(node?.texture?.ending_aftertaste || [])],
    unresolved: [...(node?.closure?.unresolved || [])],
  };
  if (node.memory_type === 'relationship_memory') return { ...common, pair: [...(node.pair || [])], as_of_scene: node.as_of_scene, state: structuredClone(node.state || {}) };
  if (node.memory_type === 'fact_memory') return { ...common, subject: node.subject, predicate: node.predicate, value: structuredClone(node.value), effective_from: node.effective_from, effective_until: node.effective_until };
  if (node.memory_type === 'reflection_memory') return { ...common, insight: node.explicit_user_insight, emotional_context: node.emotional_context, growth_direction: node.growth_direction, not_in_world_fact: true };
  if (node.memory_type === 'coach_memory') return { ...common, principle: node.principle, context_conditions: [...(node.context_conditions || [])], procedure: [...(node.procedure || [])], caveats: [...(node.caveats || [])], not_world_law: true };
  return common;
}

function sectionFor(node) {
  if (STATE_TYPES.has(node.memory_type)) return 'relationship_fact';
  if (node.memory_type === 'scene_memory') return 'scenes';
  return 'reflection_coach';
}

export function queryYunxuanMemoryV2Context(store, request = {}) {
  const bundle = getYunxuanMemoryV2Store(store);
  if (!bundle) return { status: 'not_installed', sections: { relationship_fact: [], scenes: [], reflection_coach: [] }, selected_ids: [], suppressed_recent_ids: [], removed_visibility_ids: [] };
  const mode = VALID_MODES.has(request.mode) ? request.mode : 'narrative';
  const perspective = VALID_PERSPECTIVES.has(request.perspective) ? request.perspective : 'assistant';
  const recentWindow = Math.max(1, Number(request.recentRawHistoryFloors ?? bundle?.runtime_policy?.recent_raw_history_floors ?? 20));
  const recordIndexOffset = Number.isInteger(bundle?.generated_from?.history_records) && Number.isInteger(bundle?.generated_from?.history_messages)
    ? bundle.generated_from.history_records - bundle.generated_from.history_messages
    : 0;
  const currentRecordIndex = Number.isInteger(request.currentRecordIndex)
    ? request.currentRecordIndex
    : Number.isInteger(request.currentMessageId)
      ? request.currentMessageId + recordIndexOffset
      : null;
  const limit = Math.max(1, Math.min(24, Number(request.limit ?? 8)));
  const query = String(request.query || '');
  const removedVisibility = [];
  const suppressedRecent = [];
  const supersededIds = new Set((bundle.nodes || []).flatMap(node => node?.lifecycle?.supersedes || []));
  const ranked = [];
  for (const node of bundle.nodes || []) {
    if (supersededIds.has(node.memory_id)) continue;
    if (!visibleForRequest(node, { ...request, mode, perspective })) { removedVisibility.push(node.memory_id); continue; }
    if (recentOverlap(node, currentRecordIndex, recentWindow)) { suppressedRecent.push(node.memory_id); continue; }
    const priority = PRIORITY_SCORE[node?.retrieval?.priority] ?? 2;
    const score = priority + typeModeBoost(node, mode) + lexicalScore(node, query);
    if (score < 0) continue;
    ranked.push({ node, score });
  }
  ranked.sort((a, b) => b.score - a.score || String(a.node.memory_id).localeCompare(String(b.node.memory_id)));

  // Keep section diversity deterministic: hybrid must actually surface Reflection/Coach,
  // while narrative must never spend budget on OOC nodes.
  const stateNodes = ranked.filter(item => STATE_TYPES.has(item.node.memory_type));
  const sceneNodes = ranked.filter(item => item.node.memory_type === 'scene_memory');
  const oocNodes = ranked.filter(item => item.node.memory_type === 'reflection_memory' || item.node.memory_type === 'coach_memory');
  const chosen = [];
  const add = (items, count) => {
    for (const item of items) {
      if (chosen.length >= limit || count <= 0) break;
      if (chosen.includes(item)) continue;
      chosen.push(item);
      count -= 1;
    }
  };
  if (mode === 'coach') {
    add(stateNodes, Math.min(2, limit));
    add(oocNodes, Math.max(1, limit - chosen.length - 1));
    add(sceneNodes, limit - chosen.length);
  } else if (mode === 'hybrid') {
    const oocQuota = Math.min(2, Math.max(1, Math.floor(limit / 4)));
    const stateQuota = Math.min(3, Math.max(1, Math.floor(limit / 3)));
    add(stateNodes, stateQuota);
    add(oocNodes, oocQuota);
    add(sceneNodes, limit - chosen.length);
    add(stateNodes, limit - chosen.length);
    add(oocNodes, limit - chosen.length);
  } else {
    add(stateNodes, Math.min(4, limit));
    add(sceneNodes, limit - chosen.length);
  }
  const sections = { relationship_fact: [], scenes: [], reflection_coach: [] };
  for (const item of chosen) sections[sectionFor(item.node)].push({ ...compactNode(item.node), retrieval_score: Number(item.score.toFixed(3)) });
  return {
    status: 'ok',
    bundle_id: bundle.bundle_id,
    mode,
    perspective,
    recent_window: currentRecordIndex == null ? null : [Math.max(0, currentRecordIndex - recentWindow + 1), currentRecordIndex],
    sections,
    selected_ids: chosen.map(item => item.node.memory_id),
    suppressed_recent_ids: suppressedRecent,
    removed_visibility_ids: removedVisibility,
    counts: {
      candidate_nodes: bundle.nodes?.length || 0,
      selected: chosen.length,
      suppressed_recent: suppressedRecent.length,
      removed_visibility: removedVisibility.length,
    },
  };
}
