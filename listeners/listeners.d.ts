/// <reference types="node" />
import { Token } from '@raydium-io/raydium-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
export declare class Listeners extends EventEmitter {
    private readonly connection;
    private subscriptions;
    constructor(connection: Connection);
    start(config: {
        walletPublicKey: PublicKey;
        quoteToken: Token;
        autoSell: boolean;
        cacheNewMarkets: boolean;
        enableRaydium?: boolean;
        enablePumpFun?: boolean;
    }): Promise<void>;
    private subscribeToPumpFun;
    private subscribeToOpenBookMarkets;
    private subscribeToRaydiumPools;
    private subscribeToWalletChanges;
    stop(): Promise<void>;
}
//# sourceMappingURL=listeners.d.ts.map