"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoolFilters = void 0;
const mpl_token_metadata_1 = require("@metaplex-foundation/mpl-token-metadata");
const burn_filter_1 = require("./burn.filter");
const mutable_filter_1 = require("./mutable.filter");
const renounced_filter_1 = require("./renounced.filter");
const pool_size_filter_1 = require("./pool-size.filter");
const helpers_1 = require("../helpers");
class PoolFilters {
    connection;
    args;
    filters = [];
    constructor(connection, args) {
        this.connection = connection;
        this.args = args;
        if (helpers_1.CHECK_IF_BURNED) {
            this.filters.push(new burn_filter_1.BurnFilter(connection));
        }
        if (helpers_1.CHECK_IF_MINT_IS_RENOUNCED || helpers_1.CHECK_IF_FREEZABLE) {
            this.filters.push(new renounced_filter_1.RenouncedFreezeFilter(connection, helpers_1.CHECK_IF_MINT_IS_RENOUNCED, helpers_1.CHECK_IF_FREEZABLE));
        }
        if (helpers_1.CHECK_IF_MUTABLE || helpers_1.CHECK_IF_SOCIALS) {
            this.filters.push(new mutable_filter_1.MutableFilter(connection, (0, mpl_token_metadata_1.getMetadataAccountDataSerializer)(), helpers_1.CHECK_IF_MUTABLE, helpers_1.CHECK_IF_SOCIALS));
        }
        if (!args.minPoolSize.isZero() || !args.maxPoolSize.isZero()) {
            this.filters.push(new pool_size_filter_1.PoolSizeFilter(connection, args.quoteToken, args.minPoolSize, args.maxPoolSize));
        }
    }
    async execute(poolKeys) {
        if (this.filters.length === 0) {
            return true;
        }
        const result = await Promise.all(this.filters.map((f) => f.execute(poolKeys)));
        const pass = result.every((r) => r.ok);
        if (pass) {
            return true;
        }
        for (const filterResult of result.filter((r) => !r.ok)) {
            helpers_1.logger.trace(filterResult.message);
        }
        return false;
    }
}
exports.PoolFilters = PoolFilters;
//# sourceMappingURL=pool-filters.js.map