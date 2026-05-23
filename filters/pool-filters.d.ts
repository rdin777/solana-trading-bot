import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
export interface Filter {
    execute(poolKeysV4: LiquidityPoolKeysV4): Promise<FilterResult>;
}
export interface FilterResult {
    ok: boolean;
    message?: string;
}
export interface PoolFilterArgs {
    minPoolSize: TokenAmount;
    maxPoolSize: TokenAmount;
    quoteToken: Token;
}
export declare class PoolFilters {
    readonly connection: Connection;
    readonly args: PoolFilterArgs;
    private readonly filters;
    constructor(connection: Connection, args: PoolFilterArgs);
    execute(poolKeys: LiquidityPoolKeysV4): Promise<boolean>;
}
//# sourceMappingURL=pool-filters.d.ts.map