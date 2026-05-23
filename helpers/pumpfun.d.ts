/// <reference types="node" />
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
export declare const PUMP_FUN_PROGRAM_ID: PublicKey;
export declare const PUMP_FUN_GLOBAL: PublicKey;
export declare const PUMP_FUN_FEE_RECIPIENT: PublicKey;
export declare const PUMP_FUN_EVENT_AUTHORITY: PublicKey;
export declare const BONDING_CURVE_DISCRIMINATOR: Buffer;
export declare const BONDING_CURVE_DISCRIMINATOR_B58: string;
export declare const BONDING_CURVE_ACCOUNT_SIZE: number;
export interface BondingCurveState {
    virtualTokenReserves: bigint;
    virtualSolReserves: bigint;
    realTokenReserves: bigint;
    realSolReserves: bigint;
    tokenTotalSupply: bigint;
    complete: boolean;
}
export declare function decodeBondingCurve(data: Buffer): BondingCurveState;
export declare function getBondingCurvePDA(mint: PublicKey): PublicKey;
export declare function getAssociatedBondingCurve(bondingCurve: PublicKey, mint: PublicKey): PublicKey;
export declare function computeTokensOutForSol(curve: BondingCurveState, solIn: bigint): bigint;
export declare function computeSolOutForTokens(curve: BondingCurveState, tokensIn: bigint): bigint;
export interface PumpFunIxParams {
    mint: PublicKey;
    user: PublicKey;
    bondingCurve: PublicKey;
    associatedBondingCurve: PublicKey;
    associatedUser: PublicKey;
}
export declare function createPumpFunBuyInstruction(params: PumpFunIxParams & {
    amount: bigint;
    maxSolCost: bigint;
}): TransactionInstruction;
export declare function createPumpFunSellInstruction(params: PumpFunIxParams & {
    amount: bigint;
    minSolOutput: bigint;
}): TransactionInstruction;
export declare const PUMP_TOKEN_DECIMALS = 6;
//# sourceMappingURL=pumpfun.d.ts.map