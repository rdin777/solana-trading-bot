"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoolSizeFilter = void 0;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const helpers_1 = require("../helpers");
class PoolSizeFilter {
    connection;
    quoteToken;
    minPoolSize;
    maxPoolSize;
    constructor(connection, quoteToken, minPoolSize, maxPoolSize) {
        this.connection = connection;
        this.quoteToken = quoteToken;
        this.minPoolSize = minPoolSize;
        this.maxPoolSize = maxPoolSize;
    }
    async execute(poolKeys) {
        try {
            const response = await this.connection.getTokenAccountBalance(poolKeys.quoteVault, this.connection.commitment);
            const poolSize = new raydium_sdk_1.TokenAmount(this.quoteToken, response.value.amount, true);
            let inRange = true;
            if (!this.maxPoolSize?.isZero()) {
                inRange = poolSize.raw.lte(this.maxPoolSize.raw);
                if (!inRange) {
                    return { ok: false, message: `PoolSize -> Pool size ${poolSize.toFixed()} > ${this.maxPoolSize.toFixed()}` };
                }
            }
            if (!this.minPoolSize?.isZero()) {
                inRange = poolSize.raw.gte(this.minPoolSize.raw);
                if (!inRange) {
                    return { ok: false, message: `PoolSize -> Pool size ${poolSize.toFixed()} < ${this.minPoolSize.toFixed()}` };
                }
            }
            return { ok: inRange };
        }
        catch (error) {
            helpers_1.logger.error({ mint: poolKeys.baseMint }, `Failed to check pool size`);
        }
        return { ok: false, message: 'PoolSize -> Failed to check pool size' };
    }
}
exports.PoolSizeFilter = PoolSizeFilter;
//# sourceMappingURL=pool-size.filter.js.map