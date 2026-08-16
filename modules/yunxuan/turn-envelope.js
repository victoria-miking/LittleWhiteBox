export const YUNXUAN_TURN_PATTERN = /<yx_turn\b[^>]*>[\s\S]*?<\/yx_turn>/gi;

export function stripYunxuanTurnEnvelope(text) {
    return String(text || '').replace(YUNXUAN_TURN_PATTERN, '').trimEnd();
}
