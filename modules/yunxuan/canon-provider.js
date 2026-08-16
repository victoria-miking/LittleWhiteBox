function normalizePath(path) {
    const value = String(path || '').replace(/^yunxuan\./, '');
    if (value === 'yunxuan_author' || value.startsWith('yunxuan_author.')) throw new Error('author_only path');
    return value;
}

function matches(pattern, path) {
    const expected = String(pattern).split('.');
    const actual = String(path).split('.');
    return expected.length <= actual.length && expected.every((part, index) => part === '*' || part === actual[index]);
}

export class YunxuanCanonProvider {
    constructor(manifest = {}) {
        this.manifest = manifest;
        this.policies = manifest.policies || [];
        this.defaultPolicy = manifest.default_policy || 'runtime_mutable';
    }

    getPolicy(path) {
        const normalized = normalizePath(path);
        return [...this.policies]
            .filter(rule => matches(rule.path, normalized))
            .sort((a, b) => b.path.split('.').length - a.path.split('.').length)[0]?.policy || this.defaultPolicy;
    }

    validateOperations(operations = []) {
        const errors = [];
        for (const operation of operations) {
            let policy;
            try { policy = this.getPolicy(operation.path); } catch { policy = 'author_only'; }
            if (policy !== 'runtime_mutable') errors.push(`${operation.path}: ${policy}`);
        }
        return { valid: errors.length === 0, errors };
    }
}
