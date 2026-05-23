"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PumpFunCache = void 0;
class PumpFunCache {
    keys = new Map();
    has(mint) {
        return this.keys.has(mint);
    }
    save(entry) {
        this.keys.set(entry.mint.toString(), entry);
    }
    update(mint, state) {
        const existing = this.keys.get(mint);
        if (existing)
            existing.state = state;
    }
    get(mint) {
        return this.keys.get(mint);
    }
}
exports.PumpFunCache = PumpFunCache;
//# sourceMappingURL=pumpfun.cache.js.map