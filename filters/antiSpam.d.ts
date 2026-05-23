import { Connection } from '@solana/web3.js';
interface FilterResult {
    isSafe: boolean;
    reason?: string;
    name?: string;
    symbol?: string;
}
export declare function checkTokenAntiSpam(connection: Connection, mintAddress: string, txLogs?: string[]): Promise<FilterResult>;
export {};
//# sourceMappingURL=antiSpam.d.ts.map