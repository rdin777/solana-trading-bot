"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUMP_TOKEN_DECIMALS = exports.createPumpFunSellInstruction = exports.createPumpFunBuyInstruction = exports.computeSolOutForTokens = exports.computeTokensOutForSol = exports.getAssociatedBondingCurve = exports.getBondingCurvePDA = exports.decodeBondingCurve = exports.BONDING_CURVE_ACCOUNT_SIZE = exports.BONDING_CURVE_DISCRIMINATOR_B58 = exports.BONDING_CURVE_DISCRIMINATOR = exports.PUMP_FUN_EVENT_AUTHORITY = exports.PUMP_FUN_FEE_RECIPIENT = exports.PUMP_FUN_GLOBAL = exports.PUMP_FUN_PROGRAM_ID = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const bs58_1 = __importDefault(require("bs58"));
exports.PUMP_FUN_PROGRAM_ID = new web3_js_1.PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
exports.PUMP_FUN_GLOBAL = new web3_js_1.PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
exports.PUMP_FUN_FEE_RECIPIENT = new web3_js_1.PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
exports.PUMP_FUN_EVENT_AUTHORITY = new web3_js_1.PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
// anchor account discriminator for BondingCurve: sha256("account:BondingCurve")[0..8]
exports.BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 93, 172, 108]);
exports.BONDING_CURVE_DISCRIMINATOR_B58 = bs58_1.default.encode(exports.BONDING_CURVE_DISCRIMINATOR);
// anchor instruction discriminators
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
exports.BONDING_CURVE_ACCOUNT_SIZE = 8 + 8 * 5 + 1; // 49
function decodeBondingCurve(data) {
    return {
        virtualTokenReserves: data.readBigUInt64LE(8),
        virtualSolReserves: data.readBigUInt64LE(16),
        realTokenReserves: data.readBigUInt64LE(24),
        realSolReserves: data.readBigUInt64LE(32),
        tokenTotalSupply: data.readBigUInt64LE(40),
        complete: data.readUInt8(48) === 1,
    };
}
exports.decodeBondingCurve = decodeBondingCurve;
function getBondingCurvePDA(mint) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], exports.PUMP_FUN_PROGRAM_ID)[0];
}
exports.getBondingCurvePDA = getBondingCurvePDA;
function getAssociatedBondingCurve(bondingCurve, mint) {
    return (0, spl_token_1.getAssociatedTokenAddressSync)(mint, bondingCurve, true);
}
exports.getAssociatedBondingCurve = getAssociatedBondingCurve;
// constant-product: tokensOut = vTok - (vTok*vSol)/(vSol + solIn)
function computeTokensOutForSol(curve, solIn) {
    if (solIn <= 0n)
        return 0n;
    const k = curve.virtualTokenReserves * curve.virtualSolReserves;
    const newSol = curve.virtualSolReserves + solIn;
    const newTok = k / newSol;
    const out = curve.virtualTokenReserves - newTok;
    return out < curve.realTokenReserves ? out : curve.realTokenReserves;
}
exports.computeTokensOutForSol = computeTokensOutForSol;
// solOut = vSol - (vSol*vTok)/(vTok + tokensIn); apply 1% fee
function computeSolOutForTokens(curve, tokensIn) {
    if (tokensIn <= 0n)
        return 0n;
    const k = curve.virtualTokenReserves * curve.virtualSolReserves;
    const newTok = curve.virtualTokenReserves + tokensIn;
    const newSol = k / newTok;
    const gross = curve.virtualSolReserves - newSol;
    const fee = gross / 100n;
    return gross - fee;
}
exports.computeSolOutForTokens = computeSolOutForTokens;
function encodeBuyData(amount, maxSolCost) {
    const data = Buffer.alloc(24);
    BUY_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    data.writeBigUInt64LE(maxSolCost, 16);
    return data;
}
function encodeSellData(amount, minSolOutput) {
    const data = Buffer.alloc(24);
    SELL_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    data.writeBigUInt64LE(minSolOutput, 16);
    return data;
}
function createPumpFunBuyInstruction(params) {
    return new web3_js_1.TransactionInstruction({
        programId: exports.PUMP_FUN_PROGRAM_ID,
        keys: [
            { pubkey: exports.PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
            { pubkey: exports.PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: params.mint, isSigner: false, isWritable: false },
            { pubkey: params.bondingCurve, isSigner: false, isWritable: true },
            { pubkey: params.associatedBondingCurve, isSigner: false, isWritable: true },
            { pubkey: params.associatedUser, isSigner: false, isWritable: true },
            { pubkey: params.user, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: exports.PUMP_FUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
            { pubkey: exports.PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: encodeBuyData(params.amount, params.maxSolCost),
    });
}
exports.createPumpFunBuyInstruction = createPumpFunBuyInstruction;
function createPumpFunSellInstruction(params) {
    return new web3_js_1.TransactionInstruction({
        programId: exports.PUMP_FUN_PROGRAM_ID,
        keys: [
            { pubkey: exports.PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
            { pubkey: exports.PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: params.mint, isSigner: false, isWritable: false },
            { pubkey: params.bondingCurve, isSigner: false, isWritable: true },
            { pubkey: params.associatedBondingCurve, isSigner: false, isWritable: true },
            { pubkey: params.associatedUser, isSigner: false, isWritable: true },
            { pubkey: params.user, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: exports.PUMP_FUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
            { pubkey: exports.PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: encodeSellData(params.amount, params.minSolOutput),
    });
}
exports.createPumpFunSellInstruction = createPumpFunSellInstruction;
exports.PUMP_TOKEN_DECIMALS = 6;
//# sourceMappingURL=pumpfun.js.map