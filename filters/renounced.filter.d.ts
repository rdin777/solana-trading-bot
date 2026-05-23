import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
export declare class RenouncedFreezeFilter implements Filter {
    private readonly connection;
    private readonly checkRenounced;
    private readonly checkFreezable;
    private readonly errorMessage;
    constructor(connection: Connection, checkRenounced: boolean, checkFreezable: boolean);
    execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult>;
}
//# sourceMappingURL=renounced.filter.d.ts.map