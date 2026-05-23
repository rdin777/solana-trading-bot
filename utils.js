"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeSolOutForTokens = exports.decodeBondingCurve = exports.BONDING_CURVE_STRUCT = void 0;
const borsh_1 = require("@coral-xyz/borsh"); // или используй обычный Buffer.read
// Структура данных Bonding Curve на Pump.fun
exports.BONDING_CURVE_STRUCT = (0, borsh_1.struct)([
    (0, borsh_1.u64)('virtualTokenReserves'),
    (0, borsh_1.u64)('virtualSolReserves'),
    (0, borsh_1.u64)('realTokenReserves'),
    (0, borsh_1.u64)('realSolReserves'),
    (0, borsh_1.u64)('tokenTotalSupply'),
    (0, borsh_1.bool)('complete'),
]);
function decodeBondingCurve(data) {
    // Пропускаем первые 8 байт (дискриминатор Anchor)
    return exports.BONDING_CURVE_STRUCT.decode(data.slice(8));
}
exports.decodeBondingCurve = decodeBondingCurve;
function computeSolOutForTokens(curve, tokensIn) {
    // Упрощенная формула цены x * y = k
    // Цена = (Virtual SOL Reserves / Virtual Token Reserves) * tokensIn
    const solOut = (BigInt(curve.virtualSolReserves) * tokensIn) / BigInt(curve.virtualTokenReserves);
    return solOut;
}
exports.computeSolOutForTokens = computeSolOutForTokens;
//# sourceMappingURL=utils.js.map