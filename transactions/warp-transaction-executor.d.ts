import { BlockhashWithExpiryBlockHeight, Keypair, VersionedTransaction } from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
export declare class WarpTransactionExecutor implements TransactionExecutor {
    private readonly warpFee;
    private readonly warpFeeWallet;
    constructor(warpFee: string);
    executeAndConfirm(transaction: VersionedTransaction, payer: Keypair, latestBlockhash: BlockhashWithExpiryBlockHeight): Promise<{
        confirmed: boolean;
        signature?: string;
        error?: string;
    }>;
}
//# sourceMappingURL=warp-transaction-executor.d.ts.map