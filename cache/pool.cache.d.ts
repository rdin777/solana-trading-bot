import { LiquidityStateV4 } from '@raydium-io/raydium-sdk';
export declare class PoolCache {
    private readonly keys;
    save(id: string, state: LiquidityStateV4): void;
    get(mint: string): Promise<{
        id: string;
        state: LiquidityStateV4;
    }>;
}
//# sourceMappingURL=pool.cache.d.ts.map