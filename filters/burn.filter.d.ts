import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
export declare class BurnFilter implements Filter {
    private readonly connection;
    constructor(connection: Connection);
    execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult>;
}
//# sourceMappingURL=burn.filter.d.ts.map