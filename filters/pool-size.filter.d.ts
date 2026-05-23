import { Filter, FilterResult } from './pool-filters';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { Connection } from '@solana/web3.js';
export declare class PoolSizeFilter implements Filter {
    private readonly connection;
    private readonly quoteToken;
    private readonly minPoolSize;
    private readonly maxPoolSize;
    constructor(connection: Connection, quoteToken: Token, minPoolSize: TokenAmount, maxPoolSize: TokenAmount);
    execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult>;
}
//# sourceMappingURL=pool-size.filter.d.ts.map