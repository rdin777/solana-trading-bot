import { BlockhashWithExpiryBlockHeight, Keypair, VersionedTransaction } from '@solana/web3.js';
export interface TransactionExecutor {
    executeAndConfirm(transaction: VersionedTransaction, payer: Keypair, latestBlockHash: BlockhashWithExpiryBlockHeight): Promise<{
        confirmed: boolean;
        signature?: string;
        error?: string;
    }>;
}
//# sourceMappingURL=transaction-executor.interface.d.ts.map