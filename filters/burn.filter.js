"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BurnFilter = void 0;
const helpers_1 = require("../helpers");
class BurnFilter {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async execute(poolKeys) {
        try {
            const amount = await this.connection.getTokenSupply(poolKeys.lpMint, this.connection.commitment);
            const burned = amount.value.uiAmount === 0;
            return { ok: burned, message: burned ? undefined : "Burned -> Creator didn't burn LP" };
        }
        catch (e) {
            if (e.code == -32602) {
                return { ok: true };
            }
            helpers_1.logger.error({ mint: poolKeys.baseMint }, `Failed to check if LP is burned`);
        }
        return { ok: false, message: 'Failed to check if LP is burned' };
    }
}
exports.BurnFilter = BurnFilter;
//# sourceMappingURL=burn.filter.js.map