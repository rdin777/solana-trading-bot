import { BlockhashWithExpiryBlockHeight, Keypair, Connection, VersionedTransaction } from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
export declare class JitoTransactionExecutor implements TransactionExecutor {
    private readonly jitoFee;
    private readonly connection;
    private jitpTipAccounts;
    private JitoFeeWallet;
    constructor(jitoFee: string, connection: Connection);
    private getRandomValidatorKey;
    executeAndConfirm(transaction: VersionedTransaction, payer: Keypair, latestBlockhash: BlockhashWithExpiryBlockHeight): Promise<{
        confirmed: boolean;
        signature?: string;
        error?: string;
    }>;
    private confirm;
}
//# sourceMappingURL=jito-rpc-transaction-executor.d.ts.map