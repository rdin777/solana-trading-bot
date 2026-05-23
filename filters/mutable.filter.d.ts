import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { MetadataAccountData, MetadataAccountDataArgs } from '@metaplex-foundation/mpl-token-metadata';
import { Serializer } from '@metaplex-foundation/umi/serializers';
export declare class MutableFilter implements Filter {
    private readonly connection;
    private readonly metadataSerializer;
    private readonly checkMutable;
    private readonly checkSocials;
    private readonly errorMessage;
    constructor(connection: Connection, metadataSerializer: Serializer<MetadataAccountDataArgs, MetadataAccountData>, checkMutable: boolean, checkSocials: boolean);
    execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult>;
    private hasSocials;
}
//# sourceMappingURL=mutable.filter.d.ts.map