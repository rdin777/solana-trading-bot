"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoolCache = void 0;
const helpers_1 = require("../helpers");
class PoolCache {
    keys = new Map();
    save(id, state) {
        if (!this.keys.has(state.baseMint.toString())) {
            helpers_1.logger.trace(`Caching new pool for mint: ${state.baseMint.toString()}`);
            this.keys.set(state.baseMint.toString(), { id, state });
        }
    }
    async get(mint) {
        return this.keys.get(mint);
    }
}
exports.PoolCache = PoolCache;
//# sourceMappingURL=pool.cache.js.map