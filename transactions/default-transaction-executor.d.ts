import { BlockhashWithExpiryBlockHeight, Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
export declare class DefaultTransactionExecutor implements TransactionExecutor {
    private readonly connection;
    constructor(connection: Connection);
    executeAndConfirm(transaction: VersionedTransaction, payer: Keypair, latestBlockhash: BlockhashWithExpiryBlockHeight): Promise<{
        confirmed: boolean;
        signature?: string;
        error?: string;
    }>;
    private execute;
    private confirm;
}
//# sourceMappingURL=default-transaction-executor.d.ts.map