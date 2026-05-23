import { struct, u64, bool } from '@coral-xyz/borsh'; // или используй обычный Buffer.read
import { PublicKey } from '@solana/web3.js';

// Структура данных Bonding Curve на Pump.fun
export const BONDING_CURVE_STRUCT = struct([
    u64('virtualTokenReserves'),
    u64('virtualSolReserves'),
    u64('realTokenReserves'),
    u64('realSolReserves'),
    u64('tokenTotalSupply'),
    bool('complete'),
]);

export function decodeBondingCurve(data: Buffer) {
    // Пропускаем первые 8 байт (дискриминатор Anchor)
    return BONDING_CURVE_STRUCT.decode(data.slice(8));
}

export function computeSolOutForTokens(curve: any, tokensIn: bigint): bigint {
    // Упрощенная формула цены x * y = k
    // Цена = (Virtual SOL Reserves / Virtual Token Reserves) * tokensIn
    const solOut = (BigInt(curve.virtualSolReserves) * tokensIn) / BigInt(curve.virtualTokenReserves);
    return solOut;
}
