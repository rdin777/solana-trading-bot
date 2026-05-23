"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenouncedFreezeFilter = void 0;
const spl_token_1 = require("@solana/spl-token");
const helpers_1 = require("../helpers");
class RenouncedFreezeFilter {
    connection;
    checkRenounced;
    checkFreezable;
    errorMessage = [];
    constructor(connection, checkRenounced, checkFreezable) {
        this.connection = connection;
        this.checkRenounced = checkRenounced;
        this.checkFreezable = checkFreezable;
        if (this.checkRenounced) {
            this.errorMessage.push('mint');
        }
        if (this.checkFreezable) {
            this.errorMessage.push('freeze');
        }
    }
    async execute(poolKeys) {
        try {
            const accountInfo = await this.connection.getAccountInfo(poolKeys.baseMint, this.connection.commitment);
            if (!accountInfo?.data) {
                return { ok: false, message: 'RenouncedFreeze -> Failed to fetch account data' };
            }
            const deserialize = spl_token_1.MintLayout.decode(accountInfo.data);
            const renounced = !this.checkRenounced || deserialize.mintAuthorityOption === 0;
            const freezable = !this.checkFreezable || deserialize.freezeAuthorityOption !== 0;
            const ok = renounced && !freezable;
            const message = [];
            if (!renounced) {
                message.push('mint');
            }
            if (freezable) {
                message.push('freeze');
            }
            return { ok: ok, message: ok ? undefined : `RenouncedFreeze -> Creator can ${message.join(' and ')} tokens` };
        }
        catch (e) {
            helpers_1.logger.error({ mint: poolKeys.baseMint }, `RenouncedFreeze -> Failed to check if creator can ${this.errorMessage.join(' and ')} tokens`);
        }
        return {
            ok: false,
            message: `RenouncedFreeze -> Failed to check if creator can ${this.errorMessage.join(' and ')} tokens`,
        };
    }
}
exports.RenouncedFreezeFilter = RenouncedFreezeFilter;
//# sourceMappingURL=renounced.filter.js.map