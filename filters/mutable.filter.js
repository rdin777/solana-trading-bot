"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MutableFilter = void 0;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const helpers_1 = require("../helpers");
class MutableFilter {
    connection;
    metadataSerializer;
    checkMutable;
    checkSocials;
    errorMessage = [];
    constructor(connection, metadataSerializer, checkMutable, checkSocials) {
        this.connection = connection;
        this.metadataSerializer = metadataSerializer;
        this.checkMutable = checkMutable;
        this.checkSocials = checkSocials;
        if (this.checkMutable) {
            this.errorMessage.push('mutable');
        }
        if (this.checkSocials) {
            this.errorMessage.push('socials');
        }
    }
    async execute(poolKeys) {
        try {
            const metadataPDA = (0, raydium_sdk_1.getPdaMetadataKey)(poolKeys.baseMint);
            const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey, this.connection.commitment);
            if (!metadataAccount?.data) {
                return { ok: false, message: 'Mutable -> Failed to fetch account data' };
            }
            const deserialize = this.metadataSerializer.deserialize(metadataAccount.data);
            const mutable = !this.checkMutable || deserialize[0].isMutable;
            const hasSocials = !this.checkSocials || (await this.hasSocials(deserialize[0]));
            const ok = !mutable && hasSocials;
            const message = [];
            if (mutable) {
                message.push('metadata can be changed');
            }
            if (!hasSocials) {
                message.push('has no socials');
            }
            return { ok: ok, message: ok ? undefined : `MutableSocials -> Token ${message.join(' and ')}` };
        }
        catch (e) {
            helpers_1.logger.error({ mint: poolKeys.baseMint }, `MutableSocials -> Failed to check ${this.errorMessage.join(' and ')}`);
        }
        return {
            ok: false,
            message: `MutableSocials -> Failed to check ${this.errorMessage.join(' and ')}`,
        };
    }
    async hasSocials(metadata) {
        const response = await fetch(metadata.uri);
        const data = await response.json();
        return Object.values(data?.extensions ?? {}).some((value) => value !== null && value.length > 0);
    }
}
exports.MutableFilter = MutableFilter;
//# sourceMappingURL=mutable.filter.js.map