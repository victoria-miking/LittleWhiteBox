import { eventSource } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { getLocalVariable, setLocalVariable } from '../../../../../variables.js';
import { applyStateForMessage, restoreStateV2ToFloor, trimStateV2FromFloor } from '../variables/state2/index.js';
import { YunxuanCanonProvider } from './canon-provider.js';

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

export function createYunxuanRuntimeApi({ fieldPolicy = null } = {}) {
    let canonProvider = fieldPolicy ? new YunxuanCanonProvider(fieldPolicy) : null;
    return Object.freeze({
        getRuntimeSnapshotSync,
        async getRuntimeSnapshot() {
            return getRuntimeSnapshotSync();
        },
        configureCanonPolicy(nextFieldPolicy) {
            canonProvider = new YunxuanCanonProvider(nextFieldPolicy || {});
            return true;
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
            return { state: getRuntimeSnapshotSync(), atoms: result.atoms || [], skipped: !!result.skipped };
        },
        async rollbackRuntime(messageId, swipeId = null) {
            const floor = Number(messageId);
            if (!Number.isInteger(floor) || floor < 0) throw new Error('messageId 非法。');
            await restoreStateV2ToFloor(floor - 1);
            await trimStateV2FromFloor(floor);
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
