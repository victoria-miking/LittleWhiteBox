import { eventSource } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { getLocalVariable, setLocalVariable } from '../../../../../variables.js';
import { applyStateForMessage, restoreStateV2ToFloor, trimStateV2FromFloor } from '../variables/state2/index.js';
import { YunxuanCanonProvider } from './canon-provider.js';
import { filterYunxuanRecallResult, getLastYunxuanRecallDebug, getLastYunxuanRecallMetrics } from './knowledge-filter.js';

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
        async initializeRuntime(nextState) {
            if (getRuntimeSnapshotSync()) return getRuntimeSnapshotSync();
            if (!nextState?.yunxuan || nextState.yunxuan_author) throw new Error('非法初始 Runtime。');
            saveBaseState(nextState);
            setLocalVariable('yunxuan', JSON.stringify(nextState.yunxuan));
            getContext()?.saveMetadataDebounced?.();
            return getRuntimeSnapshotSync();
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
