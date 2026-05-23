"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultTransactionExecutor = void 0;
const helpers_1 = require("../helpers");
class DefaultTransactionExecutor {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async executeAndConfirm(transaction, payer, latestBlockhash) {
        helpers_1.logger.debug('Executing transaction...');
        const signature = await this.execute(transaction);
        helpers_1.logger.debug({ signature }, 'Confirming transaction...');
        return this.confirm(signature, latestBlockhash);
    }
    async execute(transaction) {
        return this.connection.sendRawTransaction(transaction.serialize(), {
            preflightCommitment: this.connection.commitment,
        });
    }
    async confirm(signature, latestBlockhash) {
        const confirmation = await this.connection.confirmTransaction({
            signature,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            blockhash: latestBlockhash.blockhash,
        }, this.connection.commitment);
        return { confirmed: !confirmation.value.err, signature };
    }
}
exports.DefaultTransactionExecutor = DefaultTransactionExecutor;
//# sourceMappingURL=default-transaction-executor.js.map