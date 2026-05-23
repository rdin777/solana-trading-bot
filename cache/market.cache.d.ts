import { Connection } from '@solana/web3.js';
import { MinimalMarketLayoutV3 } from '../helpers';
import { Token } from '@raydium-io/raydium-sdk';
export declare class MarketCache {
    private readonly connection;
    private readonly keys;
    constructor(connection: Connection);
    init(config: {
        quoteToken: Token;
    }): Promise<void>;
    save(marketId: string, keys: MinimalMarketLayoutV3): void;
    get(marketId: string): Promise<MinimalMarketLayoutV3>;
    private fetch;
}
//# sourceMappingURL=market.cache.d.ts.map