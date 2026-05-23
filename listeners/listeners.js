"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Listeners = void 0;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const bs58_1 = __importDefault(require("bs58"));
const spl_token_1 = require("@solana/spl-token");
const events_1 = require("events");
const pumpfun_1 = require("../helpers/pumpfun");
class Listeners extends events_1.EventEmitter {
    connection;
    subscriptions = [];
    constructor(connection) {
        super();
        this.connection = connection;
    }
    async start(config) {
        if (config.cacheNewMarkets) {
            const openBookSubscription = await this.subscribeToOpenBookMarkets(config);
            this.subscriptions.push(openBookSubscription);
        }
        if (config.enableRaydium !== false) {
            const raydiumSubscription = await this.subscribeToRaydiumPools(config);
            this.subscriptions.push(raydiumSubscription);
        }
        if (config.enablePumpFun) {
            const pumpSubscription = await this.subscribeToPumpFun();
            this.subscriptions.push(pumpSubscription);
        }
        if (config.autoSell) {
            const walletSubscription = await this.subscribeToWalletChanges(config);
            this.subscriptions.push(walletSubscription);
        }
    }
    async subscribeToPumpFun() {
        return this.connection.onLogs(pumpfun_1.PUMP_FUN_PROGRAM_ID, (logs) => {
            if (logs.err)
                return;
            if (!logs.logs.some((l) => l.includes('Instruction: Create')))
                return;
            this.emit('pumpfun-create', logs);
        }, this.connection.commitment);
    }
    async subscribeToOpenBookMarkets(config) {
        return this.connection.onProgramAccountChange(raydium_sdk_1.MAINNET_PROGRAM_ID.OPENBOOK_MARKET, async (updatedAccountInfo) => {
            this.emit('market', updatedAccountInfo);
        }, this.connection.commitment, [
            { dataSize: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.span },
            {
                memcmp: {
                    offset: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
                    bytes: config.quoteToken.mint.toBase58(),
                },
            },
        ]);
    }
    async subscribeToRaydiumPools(config) {
        return this.connection.onProgramAccountChange(raydium_sdk_1.MAINNET_PROGRAM_ID.AmmV4, async (updatedAccountInfo) => {
            this.emit('pool', updatedAccountInfo);
        }, this.connection.commitment, [
            { dataSize: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.span },
            {
                memcmp: {
                    offset: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
                    bytes: config.quoteToken.mint.toBase58(),
                },
            },
            {
                memcmp: {
                    offset: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
                    bytes: raydium_sdk_1.MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
                },
            },
            {
                memcmp: {
                    offset: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
                    bytes: bs58_1.default.encode([6, 0, 0, 0, 0, 0, 0, 0]),
                },
            },
        ]);
    }
    async subscribeToWalletChanges(config) {
        return this.connection.onProgramAccountChange(spl_token_1.TOKEN_PROGRAM_ID, async (updatedAccountInfo) => {
            this.emit('wallet', updatedAccountInfo);
        }, this.connection.commitment, [
            {
                dataSize: 165,
            },
            {
                memcmp: {
                    offset: 32,
                    bytes: config.walletPublicKey.toBase58(),
                },
            },
        ]);
    }
    async stop() {
        for (let i = this.subscriptions.length - 1; i >= 0; --i) {
            const subscription = this.subscriptions[i];
            await this.connection.removeAccountChangeListener(subscription);
            this.subscriptions.splice(i, 1);
        }
    }
}
exports.Listeners = Listeners;
//# sourceMappingURL=listeners.js.map