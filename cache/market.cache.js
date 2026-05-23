"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketCache = void 0;
const web3_js_1 = require("@solana/web3.js");
const helpers_1 = require("../helpers");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
class MarketCache {
    connection;
    keys = new Map();
    constructor(connection) {
        this.connection = connection;
    }
    async init(config) {
        helpers_1.logger.debug({}, `Fetching all existing ${config.quoteToken.symbol} markets...`);
        const accounts = await this.connection.getProgramAccounts(raydium_sdk_1.MAINNET_PROGRAM_ID.OPENBOOK_MARKET, {
            commitment: this.connection.commitment,
            dataSlice: {
                offset: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
                length: helpers_1.MINIMAL_MARKET_STATE_LAYOUT_V3.span,
            },
            filters: [
                { dataSize: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.span },
                {
                    memcmp: {
                        offset: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
                        bytes: config.quoteToken.mint.toBase58(),
                    },
                },
            ],
        });
        for (const account of accounts) {
            const market = helpers_1.MINIMAL_MARKET_STATE_LAYOUT_V3.decode(account.account.data);
            this.keys.set(account.pubkey.toString(), market);
        }
        helpers_1.logger.debug({}, `Cached ${this.keys.size} markets`);
    }
    save(marketId, keys) {
        if (!this.keys.has(marketId)) {
            helpers_1.logger.trace({}, `Caching new market: ${marketId}`);
            this.keys.set(marketId, keys);
        }
    }
    async get(marketId) {
        if (this.keys.has(marketId)) {
            return this.keys.get(marketId);
        }
        helpers_1.logger.trace({}, `Fetching new market keys for ${marketId}`);
        const market = await this.fetch(marketId);
        this.keys.set(marketId, market);
        return market;
    }
    fetch(marketId) {
        return (0, helpers_1.getMinimalMarketV3)(this.connection, new web3_js_1.PublicKey(marketId), this.connection.commitment);
    }
}
exports.MarketCache = MarketCache;
//# sourceMappingURL=market.cache.js.map