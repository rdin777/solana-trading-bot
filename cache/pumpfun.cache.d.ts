import { PublicKey } from '@solana/web3.js';
import { BondingCurveState } from '../helpers';
export interface PumpFunPoolEntry {
    mint: PublicKey;
    bondingCurve: PublicKey;
    associatedBondingCurve: PublicKey;
    state: BondingCurveState;
}
export declare class PumpFunCache {
    private readonly keys;
    has(mint: string): boolean;
    save(entry: PumpFunPoolEntry): void;
    update(mint: string, state: BondingCurveState): void;
    get(mint: string): PumpFunPoolEntry | undefined;
}
//# sourceMappingURL=pumpfun.cache.d.ts.map