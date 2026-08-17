import { eventSource } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { getLocalVariable, setLocalVariable } from '../../../../../variables.js';
import { applyStateForMessage, restoreStateV2ToFloor, trimStateV2FromFloor } from '../variables/state2/index.js';
import { getSummaryStore, saveSummaryStore } from '../story-summary/data/store.js';
import { addEventDocuments, warmupIndex } from '../story-summary/vector/retrieval/lexical-index.js';
import { YunxuanCanonProvider } from './canon-provider.js';
import { filterYunxuanRecallResult, getLastYunxuanRecallDebug, getLastYunxuanRecallMetrics } from './knowledge-filter.js';
import { importProjectMemorySeed, listProjectMemoryIds } from './memory-seed-import.js';
import { getYunxuanMemoryV2Info, importYunxuanMemoryV2Bundle, queryYunxuanMemoryV2Context } from './memory-v2-store.js';
import { isBlankYunxuanRuntime } from './runtime-seed-guard.js';

function parseValue(value) {
    if (value && typeof value === 'object') return structuredClone(value);
    try { return JSON.parse(String(value || '')); } catch { return null; }
}

function getRuntimeSnapshotSync() {
    const runtime = parseValue(getLocalVariable('yunxuan'));
    return runtime ? { yunxuan: runtime } : null;
}

const BASE_STATE_KEY = 'yunxuanRuntimeBaseV1';

function getBaseState() {
    return getContext()?.chatMetadata?.extensions?.LittleWhiteBox?.[BASE_STATE_KEY] || null;
}

function saveBaseState(state) {
    const context = getContext();
    if (!context) throw new Error('SillyTavern context unavailable.');
    const metadata = context.chatMetadata || (context.chatMetadata = {});
    metadata.extensions ||= {};
    metadata.extensions.LittleWhiteBox ||= {};
    metadata.extensions.LittleWhiteBox[BASE_STATE_KEY] = structuredClone(state);
    context?.saveMetadataDebounced?.();
}

function restoreBaseState() {
    const base = getBaseState();
    if (!base?.yunxuan) return null;
    setLocalVariable('yunxuan', JSON.stringify(base.yunxuan));
    getContext()?.saveMetadataDebounced?.();
    return getRuntimeSnapshotSync();
}

function stateBlock(nextState) {
    if (!nextState?.yunxuan || nextState.yunxuan_author) throw new Error('只允许写入普通 yunxuan Runtime。');
    return `<state>\nyunxuan: ${JSON.stringify(nextState.yunxuan)}\n</state>`;
}

function saveMetadataSoon() {
    setTimeout(() => {
        Promise.resolve(getContext()?.saveMetadata?.()).catch(error => {
            console.error('[LittleWhiteBox/Yunxuan] Runtime metadata save failed.', error);
        });
    }, 0);
}

export function createYunxuanRuntimeApi({ fieldPolicy = null } = {}) {
    let canonProvider = fieldPolicy ? new YunxuanCanonProvider(fieldPolicy) : null;
    const transactions = [];
    const rollbacks = [];
    let lastMemoryV2Debug = null;
    return Object.freeze({
        getRuntimeSnapshotSync,
        async getRuntimeSnapshot() {
            return getRuntimeSnapshotSync();
        },
        configureCanonPolicy(nextFieldPolicy) {
            canonProvider = new YunxuanCanonProvider(nextFieldPolicy || {});
            return true;
        },
        filterRecallForViewer(result) {
            return filterYunxuanRecallResult(result);
        },
        getLastRecallMetrics() {
            return getLastYunxuanRecallMetrics();
        },
        getLastRecallDebug() {
            return getLastYunxuanRecallDebug();
        },
        getTransactionDebug() {
            return structuredClone(transactions);
        },
        getRollbackDebug() {
            return structuredClone(rollbacks);
        },
        async initializeRuntime(nextState, _messageRef = null, options = {}) {
            const current = getRuntimeSnapshotSync();
            if (current && options.replaceEmptyRuntime !== true) return current;
            if (current && !isBlankYunxuanRuntime(current)) throw new Error('existing_runtime_detected');
            if (!nextState?.yunxuan || nextState.yunxuan_author) throw new Error('非法初始 Runtime。');
            saveBaseState(nextState);
            setLocalVariable('yunxuan', JSON.stringify(nextState.yunxuan));
            getContext()?.saveMetadataDebounced?.();
            return getRuntimeSnapshotSync();
        },
        getProjectMemoryIds(options = {}) {
            return listProjectMemoryIds(getSummaryStore(), options);
        },
        async importMemorySeed(memories, options = {}) {
            const store = getSummaryStore();
            const memoryV2Active = !!getYunxuanMemoryV2Info(store);
            const importItems = memoryV2Active
                ? (memories || []).map(memory => /^legacy-M\d+$/u.test(String(memory?.id || ''))
                    ? { ...structuredClone(memory), metadata: { ...(structuredClone(memory.metadata || memory.memory_metadata || {})), conflict_status: 'superseded' } }
                    : memory)
                : memories;
            const result = importProjectMemorySeed(store, importItems, options);
            if (result.inserted > 0) {
                saveSummaryStore();
                addEventDocuments(result.inserted_events);
                warmupIndex();
            }
            const { inserted_events: _insertedEvents, ...summary } = result;
            return summary;
        },
        getMemoryV2Info() {
            return getYunxuanMemoryV2Info(getSummaryStore());
        },
        getMemoryV2Audit() {
            const store = getSummaryStore();
            const bundle = store?.json?.yunxuan_memory_v2 ?? null;
            const legacy = (store?.json?.events ?? [])
                .filter(event => /^legacy-M\d+$/u.test(String(event?.id ?? '')))
                .map(event => ({
                    id: event.id,
                    conflict_status: event?.memory_metadata?.conflict_status ?? null,
                }));
            return {
                bundle_id: bundle?.bundle_id ?? null,
                nodes: bundle?.nodes?.length ?? 0,
                legacy,
            };
        },
        async importMemoryV2Bundle(bundle, options = {}) {
            const store = getSummaryStore();
            const result = importYunxuanMemoryV2Bundle(store, bundle, options);
            if (result.imported || result.legacy_superseded > 0) saveSummaryStore();
            return result;
        },
        queryMemoryV2Context(request = {}) {
            const result = queryYunxuanMemoryV2Context(getSummaryStore(), request);
            lastMemoryV2Debug = {
                bundle_id: result.bundle_id ?? null,
                mode: result.mode ?? request.mode ?? null,
                perspective: result.perspective ?? request.perspective ?? null,
                selected_ids: [...(result.selected_ids || [])],
                suppressed_recent_ids: [...(result.suppressed_recent_ids || [])],
                removed_visibility_ids: [...(result.removed_visibility_ids || [])],
                counts: structuredClone(result.counts || {}),
                recent_window: result.recent_window ? [...result.recent_window] : null,
            };
            return result;
        },
        getMemoryV2Debug() {
            return lastMemoryV2Debug ? structuredClone(lastMemoryV2Debug) : null;
        },
        async applyRuntimeTransaction(transactionEnvelope, nextState) {
            const transaction = transactionEnvelope?.transaction;
            if (!transaction || !Number.isInteger(transaction.message_ref?.message_id)) throw new Error('非法 Runtime Transaction。');
            if (transaction.operations.some(operation => String(operation.path || '').startsWith('yunxuan_author'))) throw new Error('普通 Bridge 禁止写入 yunxuan_author。');
            if (canonProvider) {
                const validation = canonProvider.validateOperations(transaction.operations);
                if (!validation.valid) throw new Error(`Canon Guard：${validation.errors.join('；')}`);
            }
            const result = applyStateForMessage(transaction.message_ref.message_id, stateBlock(nextState));
            if (result.errors?.length) throw new Error(`Variables 2.0 Guard：${result.errors.join('；')}`);
            transactions.push({
                message_id: transaction.message_ref.message_id,
                swipe_id: transaction.message_ref.swipe_id ?? 0,
                transaction_id: transaction.transaction_id,
                revision: nextState.yunxuan.meta.revision,
            });
            if (transactions.length > 50) transactions.shift();
            saveMetadataSoon();
            return { state: getRuntimeSnapshotSync(), atoms: result.atoms || [], skipped: !!result.skipped };
        },
        async rollbackRuntime(messageId, swipeId = null) {
            const floor = Number(messageId);
            if (!Number.isInteger(floor) || floor < 0) throw new Error('messageId 非法。');
            await restoreStateV2ToFloor(floor - 1);
            await trimStateV2FromFloor(floor);
            rollbacks.push({ message_id: floor, swipe_id: swipeId ?? 0 });
            if (rollbacks.length > 50) rollbacks.shift();
            saveMetadataSoon();
            return getRuntimeSnapshotSync() || restoreBaseState();
        },
        async emit(eventName, payload) {
            await eventSource.emit(eventName, payload);
        },
    });
}

export function installYunxuanRuntimeBridge(options = {}) {
    if (globalThis.LittleWhiteBoxYunxuan) return globalThis.LittleWhiteBoxYunxuan;
    globalThis.LittleWhiteBoxYunxuan = createYunxuanRuntimeApi(options);
    return globalThis.LittleWhiteBoxYunxuan;
}
