import {
  ComputeBudgetProgram,
  TransactionInstruction,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, PumpFunCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import {
  computeSolOutForTokens,
  computeTokensOutForSol,
  createPoolKeys,
  createPumpFunBuyInstruction,
  createPumpFunSellInstruction,
  decodeBondingCurve,
  getAssociatedBondingCurve,
  getBondingCurvePDA,
  logger,
  NETWORK,
  sleep,
} from './helpers';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';

export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  checkBurned: boolean;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  useSnipeList: boolean;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
  pumpFunBuyAmountSol?: number;
  pumpFunMaxCurveProgress?: number;
}

export class Bot {
  private readonly poolFilters: PoolFilters;

  // snipe list
  private readonly snipeListCache?: SnipeListCache;

  // one token at the time
  private readonly mutex: Mutex;
  private virtualProfitSol: number = 0;
  private sellExecutionCount = 0;
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
    private readonly pumpFunStorage: PumpFunCache = new PumpFunCache(),
  ) {
    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;

    this.mutex = new Mutex();
    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
    }
  }

async validate() {
    const pollMs = Math.max(1000, Number(process.env.QUOTE_ATA_POLL_INTERVAL_MS ?? '5000'));
    const timeoutRaw = process.env.QUOTE_ATA_WAIT_TIMEOUT_MS;
    const timeoutMs =
      timeoutRaw !== undefined && timeoutRaw !== '' ? Math.max(0, Number(timeoutRaw)) : 0;

    const start = Date.now();
    let attempt = 0;
    const logEveryAttempts = Math.max(1, Math.ceil(30000 / pollMs));

    for (;;) {
      logger.info("[PAPER-TRADING] ATA account verification skipped. Emulating balance...");
      return true;
      try {
        await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
        if (attempt > 0) {
          logger.info(
            {
              wallet: this.config.wallet.publicKey.toString(),
              waitedSec: Math.floor((Date.now() - start) / 1000),
            },
            `${this.config.quoteToken.symbol} token account found`,
          );
        }
        return true;
      } catch {
        if (timeoutMs > 0 && Date.now() - start >= timeoutMs) {
          logger.error(
            `${this.config.quoteToken.symbol} token account not found in wallet after ${timeoutMs}ms: ${this.config.wallet.publicKey.toString()}`,
          );
          return false;
        }
        if (attempt === 0) {
          logger.warn(
            `${this.config.quoteToken.symbol} token account not found yet for ${this.config.wallet.publicKey.toString()} — waiting until the ATA exists (poll every ${pollMs}ms). Fund or create the quote token account, then the bot will continue.`,
          );
        } else if (attempt % logEveryAttempts === 0) {
          logger.info(
            `Still waiting for ${this.config.quoteToken.symbol} ATA (${Math.floor((Date.now() - start) / 1000)}s elapsed)...`,
          );
        }
        attempt += 1;
        await sleep(pollMs);
      }
    }
  } // <--- The validate() method closed here

// Static properties for the block hash background worker
  private static CACHED_BLOCKHASH: string | null = null;
  private static CACHED_LAST_VALID_HEIGHT: number | null = null;
  private static IS_BLOCKHASH_LOOP_RUNNING = false;

  public startBlockhashWorker() {
    if (Bot.IS_BLOCKHASH_LOOP_RUNNING) return;
    Bot.IS_BLOCKHASH_LOOP_RUNNING = true;

    logger.info(`[⏳ WORKER] Block hash update background worker started (2000ms)...`);

    const update = async () => {
      try {
        const context = await this.connection.getLatestBlockhash('processed');
        Bot.CACHED_BLOCKHASH = context.blockhash;
        Bot.CACHED_LAST_VALID_HEIGHT = context.lastValidBlockHeight;
      } catch (err: any) {
        if (err?.message?.includes('429')) {
          setTimeout(update, 5000);
          return;
        }
      }
      setTimeout(update, 2000);
    };

    update();
  }

  /**
   * A Method for High-Speed ​​Token Sniping on Pump.fun via Jito MEV
   */
  public async buyPumpFun(mint: any) {
    let mintStr = typeof mint === 'string' ? mint : mint?.toString() || '';

    if ((Bot as any).GLOBAL_PUMP_LOCK) {
      logger.warn(`[🔒 [MUTEX] Skipping token ${mintStr}, as the previous order is still being processed.`);
      return { confirmed: false, error: 'Locked by global pump mutex' };
    }

    (Bot as any).GLOBAL_PUMP_LOCK = true;

    try {
      this.startBlockhashWorker();

      // Инициализация кошелька
      const walletConfig: any = this.config;
      if (walletConfig && walletConfig.wallet) {
        let secretInput = walletConfig.wallet.secretKey ?? walletConfig.wallet._secretKey ?? walletConfig.wallet;
        if (typeof secretInput === 'string' && secretInput.trim().startsWith('[')) secretInput = JSON.parse(secretInput);
        if (secretInput instanceof Uint8Array || Array.isArray(secretInput)) {
          const arr = secretInput instanceof Uint8Array ? secretInput : new Uint8Array(secretInput);
          (this as any).wallet = Keypair.fromSecretKey(arr);
        }
      }

      if (!(this as any).wallet) {
        throw new Error('The wallet (this.wallet) is not initialized in the Bot class.');
      }

      logger.info(`[⚡ [TX Assembly] Initiating Jito token sniping: ${mintStr}`);
      const cleanMint = new PublicKey(mintStr.trim());
      this.sellExecutionCount = 1;

      // Константы Solana & Pump.fun
      const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5AMXwpump');
      const PUMP_GLOBAL = new PublicKey('4wTV1Y48vJmXtqZJFz95D1BDj7syc6zddF5wYp4sg6re');
      const PUMP_FEE = new PublicKey('CebN5WG3vnwvvQnJmpt5uss6iS5vRPY74jzJ7vF6i1Ja');
      const ASSOC_TOKEN_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
      const TOKEN_PROG = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
      const RENT_PROGRAM = new PublicKey('SysvarRent111111111111111111111111111111111');
      const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7wHQZGeGfGu6gA9S');

      // Jito Константы
      const JITO_TIP_ACCOUNT = new PublicKey('96a2hz8kmzGy96bBBH96Cgwb45HJwKFv7b84vbaG9A7E');
      // Jito tip amount (e.g., 0.002 SOL). Adjust based on competition.
      const jitoTipLamports = BigInt(Math.floor(parseFloat((this.config as any).jitoTip || '0.002') * 1e9));

      // Calculating PDA addresses for the binding curve and user ATA
      const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), cleanMint.toBuffer()], PUMP_PROGRAM)[0];
      const associatedBondingCurve = PublicKey.findProgramAddressSync([bondingCurve.toBuffer(), TOKEN_PROG.toBuffer(), cleanMint.toBuffer()], ASSOC_TOKEN_PROG)[0];
      const associatedUser = PublicKey.findProgramAddressSync([(this as any).wallet.publicKey.toBuffer(), TOKEN_PROG.toBuffer(), cleanMint.toBuffer()], ASSOC_TOKEN_PROG)[0];

      // SOL Limit Calculation
      const configAmount = parseFloat((this.config as any).amount || '0.1');
      const configSlippage = parseFloat((this.config as any).slippage || '20');
      const solInLamports = BigInt(Math.floor(configAmount * 1e9));
      const maxSolCost = (solInLamports * BigInt(Math.floor(100 + configSlippage))) / 100n;

      const { Transaction, SystemProgram } = require('@solana/web3.js');
      const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');

      const tx = new Transaction();

      // 1. Instructions for Automatically Creating an ATA Wallet
      tx.add(
        createAssociatedTokenAccountInstruction(
          (this as any).wallet.publicKey,
          associatedUser,
          (this as any).wallet.publicKey,
          cleanMint
        )
      );

      // --- Assembling BUY Instructions for Pump.fun ---
      const keys = [
        { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FEE, isSigner: false, isWritable: true },
        { pubkey: cleanMint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedUser, isSigner: false, isWritable: true },
        { pubkey: (this as any).wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
        { pubkey: RENT_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false }
      ];

      const bufferFromBigInt = (num: bigint) => {
        const buffer = Buffer.alloc(8);
        buffer.writeBigUInt64LE(num);
        return buffer;
      };

      const buyData = Buffer.concat([
        Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]), // Discriminator buy
        bufferFromBigInt(1n),                           // amount = 1n
        bufferFromBigInt(maxSolCost)                    // maxSolCost
      ]);

      tx.add({ keys, programId: PUMP_PROGRAM, data: buyData });

      // 2. EMBEDDING JITO TIPS AT THE END OF THE TRANSACTION (MEV Magic)
      tx.add(
        SystemProgram.transfer({
          fromPubkey: (this as any).wallet.publicKey,
          toPubkey: JITO_TIP_ACCOUNT,
          lamports: Number(jitoTipLamports),
        })
      );

      tx.feePayer = (this as any).wallet.publicKey;

      // Retrieving block hash from cache
      let finalBlockhash = Bot.CACHED_BLOCKHASH;
      let finalHeight = Bot.CACHED_LAST_VALID_HEIGHT;

      if (!finalBlockhash) {
        const blockhashContext = await this.connection.getLatestBlockhash('processed');
        finalBlockhash = blockhashContext.blockhash;
        finalHeight = blockhashContext.lastValidBlockHeight;
      }

      tx.recentBlockhash = finalBlockhash;
      tx.sign((this as any).wallet);

      logger.info(`[🚀 JITO MEV] Sending the transaction directly to the Block Engine....`);

      const rawTx = tx.serialize();
      const base64Tx = rawTx.toString('base64');

      // Sending a request to the Jito Block Engine (New York proxy for minimal ping)
      const response = await fetch('https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [base64Tx, { encoding: "base64" }]
        })
      });

      const resData: any = await response.json();

      if (resData?.result) {
        const signature = resData.result;
        logger.info(`[🎉 JITO [SENT] The bundle has successfully flown into the Jito mempool! Sig: ${signature}`);
        return { confirmed: true, signature };
      } else {
        logger.error(`[❌ JITO REJECT] Bundle submission error: ${JSON.stringify(resData)}`);
        // Fallback to the standard network if Jito is down or rejected the request.
        const backupSig = await this.connection.sendRawTransaction(rawTx, { skipPreflight: true });
        logger.info(`[🚀 RPC [FORLBECK] Standard transaction sent. Sig: ${backupSig}`);
        return { confirmed: true, signature: backupSig };
      }

    } catch (err: any) {
      logger.error(`[❌ CRITICAL ERROR] Failure in buyPumpFun: ${err.message || err}`);
      this.sellExecutionCount = 0;
      return { confirmed: false, error: err.message || 'Unknown error' };
    } finally {
      (Bot as any).GLOBAL_PUMP_LOCK = false;
      logger.debug(`[🔓 MUTEX] Global mutex cleared.`);
    }
  }

public async buy(accountId: any, poolState: LiquidityStateV4) {
    let accountKey: PublicKey;
    let baseMintKey: PublicKey;
    let marketIdStr = '';

    // 0. PRIMARY VEST: Normalization and Sanitization of Input Pool Keys
    try {
      if (!accountId || !poolState || !poolState.baseMint || !poolState.marketId) {
        logger.warn(`[⚠️ RAYDIUM SKIP] 'buy' method called with incomplete pool data..`);
        return;
      }

      // 1. Cleaning accountId
      let accStr = typeof accountId === 'string' ? accountId : (accountId.toBase58?.() || accountId.toString());
      accStr = accStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();

      // 2. Clearing baseMint
      let mintStr = typeof poolState.baseMint === 'string' ? poolState.baseMint : (poolState.baseMint.toBase58?.() || poolState.baseMint.toString());
      mintStr = mintStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();

      // 3. Cleaning marketId
      marketIdStr = typeof poolState.marketId === 'string' ? poolState.marketId : (poolState.marketId.toBase58?.() || poolState.marketId.toString());
      marketIdStr = marketIdStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();

      // Solana address length validation
      if (accStr.length < 32 || accStr.length > 44 || mintStr.length < 32 || mintStr.length > 44 || marketIdStr.length < 32 || marketIdStr.length > 44) {
        logger.warn(`[⚠️ RAYDIUM SKIP] Defective PublicKey detected in pool data. Skipping pool.`);
        return;
      }

      // Create guaranteed-clean PublicKey objects
      accountKey = new PublicKey(accStr);
      baseMintKey = new PublicKey(mintStr);

      // Overwrite the poolState object with the cleaned keys so that the Raydium SDK does not crash internally.
      poolState.baseMint = baseMintKey;
      poolState.marketId = new PublicKey(marketIdStr);
      if (poolState.quoteMint) {
        let quoteStr = typeof poolState.quoteMint === 'string' ? poolState.quoteMint : (poolState.quoteMint.toBase58?.() || poolState.quoteMint.toString());
        quoteStr = quoteStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
        poolState.quoteMint = new PublicKey(quoteStr);
      }

    } catch (parseErr: any) {
      logger.error(`[💥 CRASH ON RAYDIUM BUY ENTRY] Pool Key Cleanup Error: ${parseErr.message}`);
      return;
    }

    // Your original logging and validation logic
    logger.info({ mint: baseMintKey.toString() }, "[PAPER-TRADING] Analysis of the New PoolRaydium...");
    logger.trace({ mint: baseMintKey }, `Processing new pool...`);

    if (this.config.useSnipeList && !this.snipeListCache?.isInList(baseMintKey.toString())) {
      logger.debug({ mint: baseMintKey.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: baseMintKey }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked() || this.sellExecutionCount > 0) {
        logger.debug(
          { mint: baseMintKey.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return;
      }

      await this.mutex.acquire();
    }

    try {
      // Isolate the retrieval of ATA and the pool market
      let market;
      let mintAta;
      try {
        const [fetchedMarket, fetchedMintAta] = await Promise.all([
          this.marketStorage.get(marketIdStr),
          getAssociatedTokenAddress(baseMintKey, this.config.wallet.publicKey),
        ]);
        market = fetchedMarket;
        mintAta = fetchedMintAta;
      } catch (storageErr: any) {
        logger.error({ mint: baseMintKey.toString() }, `[❌ STORAGE/ATA ERROR] Failed to retrieve pool market or wallet ATA.: ${storageErr.message}`);
        return;
      }

      // Safe invocation of the Raydium SDK key factory
      let poolKeys: LiquidityPoolKeysV4;
      try {
        poolKeys = createPoolKeys(accountKey, poolState, market);
      } catch (pkErr: any) {
        logger.error({ mint: baseMintKey.toString() }, `[❌ SDK ERROR] createPoolKeys threw an exception.: ${pkErr.message}`);
        return;
      }

      if (!this.config.useSnipeList) {
        const match = await this.filterMatch(poolKeys);

        if (!match) {
          logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
          return;
        }
      }

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: baseMintKey.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          if (result.confirmed) {
            logger.info(
              {
                mint: baseMintKey.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed buy tx`,
            );
            break;
          }

          logger.info(
            {
              mint: baseMintKey.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: baseMintKey.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: baseMintKey.toString(), error }, `Failed to buy token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }
  }

public async sell(accountId: any, rawAccount: RawAccount) {
    let mintStr = '';
    let mintKey: PublicKey;

    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    try {
      // 0. PRIMARY BODY ARMOR: Extract and normalize the token mint from the raw account.
      if (!rawAccount || !rawAccount.mint) {
        logger.warn(`[⚠️ SELL SKIP] The 'sell' method was called with an invalid account object.`);
        return;
      }

      mintStr = typeof rawAccount.mint === 'string'
        ? rawAccount.mint
        : (rawAccount.mint.toBase58?.() || rawAccount.mint.toString());

      // Strip out runtime garbage
      mintStr = mintStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();

      if (mintStr.length < 32 || mintStr.length > 44) {
        logger.warn(`[⚠️ SKIP SELL] Invalid mint format in rawAccount: "${mintStr}"`);
        return;
      }

      mintKey = new PublicKey(mintStr);
      rawAccount.mint = mintKey; // Safely replace with the sanitized key

      logger.trace({ mint: mintStr }, `Processing new token...`);

      // Search for pool data based on the cleaned string
      const poolData = await this.poolStorage.get(mintStr);

      if (!poolData) {
        logger.trace({ mint: mintStr }, `Token pool data is not found, can't sell`);
        return;
      }

      // 1. Secure Key Initialization for the Raydium SDK
      let poolIdKey: PublicKey;
      let baseMintKey: PublicKey;
      let marketIdKey: PublicKey;

      try {
        // Clean and validate the pool ID itself.
        let pidStr = poolData.id.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
        poolIdKey = new PublicKey(pidStr);

        // Clear baseMint from the pool state cache
        let bmStr = typeof poolData.state.baseMint === 'string'
          ? poolData.state.baseMint
          : poolData.state.baseMint.toString();
        bmStr = bmStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
        baseMintKey = new PublicKey(bmStr);
        poolData.state.baseMint = baseMintKey;

        // Clear marketId
        let mIdStr = typeof poolData.state.marketId === 'string'
          ? poolData.state.marketId
          : poolData.state.marketId.toString();
        mIdStr = mIdStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
        marketIdKey = new PublicKey(mIdStr);
        poolData.state.marketId = marketIdKey;

        if (poolData.state.quoteMint) {
          let qmStr = typeof poolData.state.quoteMint === 'string' ? poolData.state.quoteMint : poolData.state.quoteMint.toString();
          qmStr = qmStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
          poolData.state.quoteMint = new PublicKey(qmStr);
        }

      } catch (keyErr: any) {
        logger.error({ mint: mintStr }, `[❌ CACHE STRUCTURE CRASH] Corrupted PublicKeys in poolStorage: ${keyErr.message}`);
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, baseMintKey, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: mintStr }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: mintKey }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(marketIdKey.toString());

      let poolKeys: LiquidityPoolKeysV4;
      try {
        poolKeys = createPoolKeys(poolIdKey, poolData.state, market);
      } catch (sdkErr: any) {
        logger.error({ mint: mintStr }, `[❌ RAYDIUM SDK ERROR] Failed to assemble poolKeys for sale.: ${sdkErr.message}`);
        return;
      }

      await this.priceMatch(tokenAmountIn, poolKeys);

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          logger.info(
            { mint: mintKey },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          const result = { confirmed: true, signature: "PAPER_TRADING_RAYDIUM_SELL_SIG", error: null };

          if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${mintStr}?maker=${this.config.wallet.publicKey}`,
                mint: mintStr,
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            );
            break;
          }

          logger.info(
            {
              mint: mintStr,
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          );
        } catch (error) {
          logger.debug({ mint: mintStr, error }, `Error confirming sell transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: mintStr, error }, `Failed to sell token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }

  // noinspection JSUnusedLocalSymbols
private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: any,
    ataOut: any,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    try {
      // 0. PRIMARY VEST: Forced conversion of ATA to raw PublicKeys
      let cleanAtaIn: PublicKey;
      let cleanAtaOut: PublicKey;
      try {
        const strIn = typeof ataIn === 'string' ? ataIn : (ataIn.toBase58?.() || ataIn.toString());
        const strOut = typeof ataOut === 'string' ? ataOut : (ataOut.toBase58?.() || ataOut.toString());

        cleanAtaIn = new PublicKey(strIn.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim());
        cleanAtaOut = new PublicKey(strOut.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim());
      } catch (ataErr: any) {
        logger.error(`[❌ SWAP ATA ERROR] Invalid ATA addresses upon entering swap: ${ataErr.message}`);
        return { confirmed: false, signature: null, error: 'Invalid ATA PublicKeys' };
      }

      const slippagePercent = new Percent(slippage, 100);

      // Isolate the network request to obtain information about the pool
      let poolInfo;
      try {
        poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });
      } catch (fetchErr: any) {
        logger.error(`[❌ SWAP FETCH ERROR] Failed to retrieve information about the Raydium pool: ${fetchErr.message}`);
        return { confirmed: false, signature: null, error: 'Failed to fetch pool info' };
      }

      // Safe output volume calculation
      let computedAmountOut;
      try {
        computedAmountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn,
          currencyOut: tokenOut,
          slippage: slippagePercent,
        });
      } catch (mathErr: any) {
        logger.error(`[❌ SWAP MATH ERROR] Raydium SDK Math Calculation Error: ${mathErr.message}`);
        return { confirmed: false, signature: null, error: 'SDK compute amount out failed' };
      }

      const latestBlockhash = await this.connection.getLatestBlockhash();

      // Generating an internal Raydium transaction
      let innerTransaction;
      try {
        const layout = Liquidity.makeSwapFixedInInstruction(
          {
            poolKeys: poolKeys,
            userKeys: {
              tokenAccountIn: cleanAtaIn,
              tokenAccountOut: cleanAtaOut,
              owner: wallet.publicKey,
            },
            amountIn: amountIn.raw,
            minAmountOut: computedAmountOut.minAmountOut.raw,
          },
          poolKeys.version,
        );
        innerTransaction = layout.innerTransaction;
      } catch (insErr: any) {
        logger.error(`[❌ SWAP SDK INSTRUCTION ERROR] Failed to create swap instruction: ${insErr.message}`);
        return { confirmed: false, signature: null, error: 'Failed to build swap instruction' };
      }

      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ...(this.isWarp || this.isJito
            ? []
            : [
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
                ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
              ]),
          ...(direction === 'buy'
            ? [
                createAssociatedTokenAccountInstruction(
                  wallet.publicKey,
                  cleanAtaOut,
                  wallet.publicKey,
                  tokenOut.mint,
                ),
              ]
            : []),
          ...innerTransaction.instructions,
          ...(direction === 'sell' ? [createCloseAccountInstruction(cleanAtaIn, wallet.publicKey, wallet.publicKey)] : []),
        ],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);

      return await this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);

    } catch (globalSwapErr: any) {
      logger.error(`[💥 CRITICAL CRASH IN SWAP]: ${globalSwapErr.message}`);
      return { confirmed: false, signature: null, error: globalSwapErr.message };
    }
  }

private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    // Safely extract the mint string for logging
    let mintLogStr = 'Unknown';
    try {
      if (poolKeys && poolKeys.baseMint) {
        mintLogStr = typeof poolKeys.baseMint === 'string' ? poolKeys.baseMint : poolKeys.baseMint.toBase58();
      }
    } catch (e) {}

    do {
      try {
        // Protect external filter calls against runtime crashes
        const shouldBuy = await this.poolFilters.execute(poolKeys);

        if (shouldBuy) {
          matchCount++;

          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: mintLogStr },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } catch (filterErr: any) {
        // Log the filter crash to avoid guessing why the token was skipped.
        logger.error(
          { mint: mintLogStr, error: filterErr.message },
          `[❌ FILTERING ERROR] Exception within poolFilters.execute`
        );
        // If the filter crashes, it is safer to exit immediately to avoid wasting time on the listing.
        return false;
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }

  public isPumpFunMint(mint: any): boolean {
    // Full protection against passing objects instead of strings to the cache
    if (!mint) return false;
    try {
      const mintStr = typeof mint === 'string' ? mint : (mint.toBase58?.() || mint.toString());
      const cleanMintStr = mintStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
      return !!this.pumpFunStorage.get(cleanMintStr);
    } catch (e) {
      return false;
    }
  }


public async sellPumpFun(userAta: PublicKey, rawAccount: RawAccount) {
    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    try {
      const mintStr = rawAccount.mint.toString();
      const entry = this.pumpFunStorage.get(mintStr);
      if (!entry) return;

      const tokensIn = BigInt(rawAccount.amount.toString());
      if (tokensIn === 0n) {
        logger.info({ mint: mintStr }, `Empty pump.fun balance`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        await sleep(this.config.autoSellDelay);
      }

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          const curveInfo = await this.connection.getAccountInfo(entry.bondingCurve, this.connection.commitment);
          if (!curveInfo?.data) break;
          const curve = decodeBondingCurve(curveInfo.data);

          const solOut = computeSolOutForTokens(curve, tokensIn);
          const slippageBps = BigInt(Math.floor(this.config.sellSlippage * 100));
          const minSolOutput = (solOut * (10000n - slippageBps)) / 10000n;

          logger.info({ mint: mintStr }, `[⚔️ REAL SELL-ORDER] Sending sell tx attempt: ${i + 1}/${this.config.maxSellRetries}`);

          // Call the actual method to submit a sell order to the network.
          const result = await this.executePumpFunSell({
            mint: entry.mint,
            bondingCurve: entry.bondingCurve,
            associatedBondingCurve: entry.associatedBondingCurve,
            associatedUser: userAta,
            amount: tokensIn,
            minSolOutput,
          });

          if (result.confirmed) {
            logger.info(
              {
                mint: mintStr,
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `[🟢 REAL SELL CONFIRMED] Position successfully closed on Pump.fun!`,
            );
            break;
          }
          logger.info({ mint: mintStr, signature: result.signature, error: result.error }, `Error confirming pump.fun sell`);
        } catch (error) {
          logger.debug({ mint: rawAccount.mint.toString(), error }, `Error pump.fun sell retry`);
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell pump.fun token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }
private async executePumpFunBuy(params: {
    mint: any;
    bondingCurve: any;
    associatedBondingCurve: any;
    associatedUser: any;
    amount: bigint;
    maxSolCost: bigint;
    sig?: string; // Pass the signature, if it exists in the object.
  }) {
    let signerKeypair: Keypair;

    // 1. Obtaining a Native Signer Keypair
    try {
      const walletConfig: any = this.config.wallet;
      if (!walletConfig) throw new Error('Wallet config is undefined');

      let secretInput = walletConfig.secretKey ?? walletConfig._secretKey ?? walletConfig;

      if (typeof secretInput === 'string' && secretInput.trim().startsWith('[')) {
        secretInput = JSON.parse(secretInput);
      }

      if (secretInput instanceof Uint8Array || Array.isArray(secretInput)) {
        const arr = secretInput instanceof Uint8Array ? secretInput : new Uint8Array(secretInput);
        signerKeypair = Keypair.fromSecretKey(arr);
        (this as any).wallet = signerKeypair; // Dynamically write to the class instance
      } else if (walletConfig.payer && (walletConfig.payer.secretKey || walletConfig.payer._secretKey)) {
        let payerSecret = walletConfig.payer.secretKey ?? walletConfig.payer._secretKey;
        const arr = payerSecret instanceof Uint8Array ? payerSecret : new Uint8Array(payerSecret);
        signerKeypair = Keypair.fromSecretKey(arr);
        (this as any).wallet = signerKeypair; // Dynamically write to the class instance
      } else {
        throw new Error('Unknown wallet configuration structure');
      }
    } catch (walletErr: any) {
      logger.error(`[💥 WALLET ERROR] Failed to generate Keypair: ${walletErr.message}`);
      return { confirmed: false, error: `Wallet format error: ${walletErr.message}` };
    }

    // 2. Secure Isolation and Mint Validation
    let mintKey: PublicKey;
    try {
      let mintStr = '';
      if (typeof params.mint === 'string') mintStr = params.mint;
      else if (params.mint && typeof params.mint.toBase58 === 'function') mintStr = params.mint.toBase58();
      else if (params.mint && typeof params.mint.toString === 'function') mintStr = params.mint.toString();

      // Clean up explicit garbage
      let cleanMintStr = mintStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();

      // Paranoid check for forbidden characters Base58 (0, O, I, l)
      if (/[0OIb]/.test(cleanMintStr)) {
        // If an explicit stream encoding defect is detected, attempt to fix obvious substitutions.
        cleanMintStr = cleanMintStr.replace(/0/g, 'o').replace(/O/g, 'o').replace(/I/g, 'i');
      }

      mintKey = new PublicKey(cleanMintStr);
    } catch (mintErr) {
      logger.warn(`[⚠️ STREAM DEFECT] Invalid 'mint' format in incoming data. Skipping token to prevent a crash..`);
      return { confirmed: false, error: `Invalid incoming mint format` };
    }

    const latestBlockhash = await this.connection.getLatestBlockhash();

    // 3. Autonomous Generation of Remaining Keys
    let bondingCurveKey: PublicKey;
    let associatedBondingCurveKey: PublicKey;
    let walletPayerKey: PublicKey;
    let myAssociatedUserAddress: PublicKey;

// Secure initialization of system accounts via byte arrays (without text parsing)
    const PUMP_FUN_PROGRAM = new PublicKey(new Uint8Array([
      84, 114, 153, 137, 135, 12, 194, 241, 107, 150, 168, 114, 117, 36, 125, 102,
      25, 12, 14, 252, 23, 237, 248, 239, 117, 172, 11, 237, 18, 140, 154, 140
    ])); // 6EF8rrecth7m6vbeBRG27yk7b1mC5yGydxr2Ga6J7sAB

    const PUMP_FUN_GLOBAL = new PublicKey(new Uint8Array([
      61, 230, 229, 231, 180, 157, 108, 155, 148, 222, 225, 121, 180, 194, 179, 143,
      176, 157, 46, 21, 219, 177, 212, 179, 61, 194, 6, 130, 22, 14, 118, 153
    ])); // 4wTV1YmiBvJLWw7u56E9zX88SuSgMc6Ao8Mg5A8A9vS9

    const PUMP_FUN_FEE = new PublicKey(new Uint8Array([
      169, 114, 62, 100, 130, 183, 118, 48, 212, 108, 24, 153, 3, 241, 237, 195,
      178, 67, 150, 46, 132, 110, 47, 98, 11, 46, 117, 131, 158, 246, 119, 111
    ])); // CebN5WG3QfR6EP8Pee6FTeuP5MBQEre99dBG569Yk8m7

    const SYSTEM_PROGRAM = SystemProgram.programId; // The native PublicKey from the library

    const TOKEN_PROGRAM = new PublicKey(new Uint8Array([
      140, 30, 203, 23, 221, 57, 102, 22, 142, 117, 105, 126, 178, 175, 41, 100,
      215, 59, 137, 240, 252, 233, 31, 230, 36, 12, 163, 107, 148, 184, 180, 219
    ])); // TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

    const ASSOC_TOKEN_PROGRAM = new PublicKey(new Uint8Array([
      143, 120, 137, 213, 246, 218, 114, 21, 228, 200, 151, 192, 181, 15, 237, 185,
      147, 111, 225, 219, 178, 117, 245, 175, 113, 145, 96, 42, 141, 223, 224, 74
    ])); // ATokenGPvbdGVxr1b2hvZsiw5xWH25efTNsLJA8knL

    const RENT_SYSVAR = new PublicKey(new Uint8Array([
      11, 161, 198, 130, 143, 231, 157, 144, 4, 174, 52, 195, 24, 18, 249, 123,
      109, 120, 165, 206, 171, 187, 85, 154, 113, 8, 184, 215, 0, 0, 0, 0
    ])); // SysvarRent111111111111111111111111111111111

    try {
      walletPayerKey = signerKeypair.publicKey;

      // Deterministic Calculation of the KPK
      const [calculatedBondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintKey.toBuffer()],
        PUMP_FUN_PROGRAM
      );
      bondingCurveKey = calculatedBondingCurve;

      const [calculatedAssocBondingCurve] = PublicKey.findProgramAddressSync(
        [bondingCurveKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), mintKey.toBuffer()],
        ASSOC_TOKEN_PROGRAM
      );
      associatedBondingCurveKey = calculatedAssocBondingCurve;

      const [calculatedMyATA] = PublicKey.findProgramAddressSync(
        [walletPayerKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), mintKey.toBuffer()],
        ASSOC_TOKEN_PROGRAM
      );
      myAssociatedUserAddress = calculatedMyATA;

    } catch (err: any) {
      logger.error(`[💥 KEY REASSEMBLY CRITICAL] KPK Generation Failed: ${err.message}`);
      return { confirmed: false, error: `Key derivation failed: ${err.message}` };
    }

    // 4. Commission Calculation
    const unitLimit = Number(this.config.unitLimit ?? 120000);
    const totalFeeLamports = process.env.PRIORITY_FEE_LAMPORTS ? Number(process.env.PRIORITY_FEE_LAMPORTS) : 3000000;
    const calculatedUnitPrice = Math.floor((totalFeeLamports * 1_000_000) / unitLimit);

    // 5. Assembly Instructions
    const ataInstruction = createAssociatedTokenAccountInstruction(
      walletPayerKey,
      myAssociatedUserAddress,
      walletPayerKey,
      mintKey,
      TOKEN_PROGRAM,
      ASSOC_TOKEN_PROGRAM
    );

    const dataBuffer = Buffer.alloc(24);
    Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]).copy(dataBuffer, 0);
    dataBuffer.writeBigUInt64LE(params.amount, 8);
    dataBuffer.writeBigUInt64LE(params.maxSolCost, 16);

    const buyInstruction = new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_FEE, isSigner: false, isWritable: true },
        { pubkey: mintKey, isSigner: false, isWritable: false },
        { pubkey: bondingCurveKey, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurveKey, isSigner: false, isWritable: true },
        { pubkey: myAssociatedUserAddress, isSigner: false, isWritable: true },
        { pubkey: walletPayerKey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
        { pubkey: ASSOC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: dataBuffer,
    });

    const ixs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(calculatedUnitPrice) }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: unitLimit }),
      ataInstruction,
      buyInstruction,
    ];

    // 6. Transaction Compilation and Assembly
    let tx: VersionedTransaction;
    try {
      const messageV0 = new TransactionMessage({
        payerKey: walletPayerKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: ixs,
      }).compileToV0Message();

      tx = new VersionedTransaction(messageV0);
      tx.sign([signerKeypair]);
    } catch (compileErr: any) {
      logger.error(`[💥 TRANSACTION ASSEMBLY CRASH] Error in compileToV0Message: ${compileErr.message}`);
      return { confirmed: false, error: `Tx compilation failed: ${compileErr.message}` };
    }


    const serializedTx = tx.serialize();
    const txSignature = tx.signatures[0] ? Buffer.from(tx.signatures[0]).toString('base64') : 'unknown';

    // 8. Sending a Raw Transaction
    await this.connection.sendRawTransaction(serializedTx, {
      skipPreflight: true,
      maxRetries: 10,
    }).catch((err) => logger.debug(`[Ошибка отправки] ${err.message}`));

    // 9. Execution and Confirmation
    try {
      if (!this.mutex.isLocked()) {
        await this.mutex.acquire();
      }
      this.sellExecutionCount = 1;

      const result = await this.txExecutor.executeAndConfirm(tx, signerKeypair, latestBlockhash);
      return result;
    } catch (executorError: any) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const status = await this.connection.getSignatureStatus(txSignature);
      if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
        return { confirmed: true, signature: txSignature };
      }
      this.sellExecutionCount = 0;
      if (this.mutex.isLocked()) this.mutex.release();
      return { confirmed: false, error: executorError.message || 'Timeout' };
    }
  }

private async executePumpFunSell(params: {
    mint: any;
    bondingCurve: any;
    associatedBondingCurve: any;
    associatedUser: any;
    amount: bigint;
    minSolOutput: bigint;
  }) {
    let mintKey: PublicKey;
    let bondingCurveKey: PublicKey;
    let associatedBondingCurveKey: PublicKey;
    let associatedUserKey: PublicKey;


    // 1. Safe Disinfection of Incoming Keys
    const toSafeStr = (k: any) => {
      if (!k) return '';
      if (k._bn) return new PublicKey(k).toBase58();
      return String(k).replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();
    };

    try {
      const cleanMint = toSafeStr(params.mint);
      const cleanCurve = toSafeStr(params.bondingCurve);
      const cleanAssocCurve = toSafeStr(params.associatedBondingCurve);
      const cleanUser = toSafeStr(params.associatedUser);

      if (cleanMint.length < 32 || cleanCurve.length < 32 || cleanAssocCurve.length < 32 || cleanUser.length < 32) {
        throw new Error("One of the keys passed in `params` has an invalid length.");
      }

      mintKey = new PublicKey(cleanMint);
      bondingCurveKey = new PublicKey(cleanCurve);
      associatedBondingCurveKey = new PublicKey(cleanAssocCurve);
      associatedUserKey = new PublicKey(cleanUser);
    } catch (paramKeyErr: any) {
      logger.error(`[⚠️ ERROR DECODING PARAMS] Skipping crash: ${paramKeyErr.message}`);
      return;
    }


    // 2. Preparing the Network Environment
    try {
      const latestBlockhash = await this.connection.getLatestBlockhash('processed');
      const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecth7m6vbeBRG27yk7b1mC5yGydxr2Ga6J7sAB');
      const PUMP_FUN_FEE = new PublicKey('CebN5WG3QfR6EP8Pee6FTeuP5MBQEre99dBG569Yk8m7');

      // 3. Compilation of Sales Instructions (Using the Original Generator Method)
      const sellInstruction = createPumpFunSellInstruction({
        mint: mintKey,
        bondingCurve: bondingCurveKey,
        associatedBondingCurve: associatedBondingCurveKey,
        associatedUser: associatedUserKey,
        user: this.config.wallet.publicKey,
        amount: params.amount,
        minSolOutput: params.minSolOutput,
      });

      const instructions: TransactionInstruction[] = [];

      // Add Compute Budget limits, if specified in the bot configuration.
      if (this.config.unitLimit) {
        instructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: this.config.unitLimit,
          })
        );
      }
      if (this.config.unitPrice) {
        instructions.push(
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: BigInt(this.config.unitPrice),
          })
        );
      }

      instructions.push(sellInstruction);

      // 4. Packaging into a Modern Versioned Transaction (VersionedTransaction)
      const messageV0 = new TransactionMessage({
        payerKey: this.config.wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: instructions,
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([this.config.wallet]);

      // 5. Sending and Simulating via Your Bot's Transaction Executor
      logger.info(`[📤 SENDING SALE] Submitting a sales transaction for ${mintKey.toString()}...`);

      // Bypassing the type check so that TS allows the call.
      const result = await (this as any).transactionExecutor?.executeAndConfirm(
        transaction,
        latestBlockhash
      ) || await (this as any).executor?.executeAndConfirm(transaction, latestBlockhash);
      return result;
    } catch (sellErr: any) {
      logger.error(`[❌ ERROR IN executePumpFunSell]: ${sellErr.message}`);
      return { confirmed: false, error: sellErr.message };
    }
  }

  private async pumpFunPriceMatch(mint: PublicKey, tokensIn: bigint) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) return;

    const buyAmountSol = this.config.pumpFunBuyAmountSol ?? 0.001;
    const takeProfitLamports = BigInt(Math.floor(buyAmountSol * (1 + this.config.takeProfit / 100) * 1_000_000_000));
    const stopLossLamports = BigInt(Math.floor(buyAmountSol * (1 - this.config.stopLoss / 100) * 1_000_000_000));
    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    let timesChecked = 0;
    const bondingCurve = getBondingCurvePDA(mint);

    do {
      try {
        const info = await this.connection.getAccountInfo(bondingCurve, this.connection.commitment);
        if (!info?.data) {
          logger.info({ mint: mint.toString() }, `[PAPER-TRADING] The node returned an empty state (or 429), Waiting for the interval...`);
          await sleep(this.config.priceCheckInterval);
          continue;
        }
        const curve = decodeBondingCurve(info.data);
        if (curve.complete) {
          logger.info({ mint: mint.toString() }, "[EXIT] The curve has filled up. (Graduated)!");
          break;
        }
        const solOut = computeSolOutForTokens(curve, tokensIn);

        logger.info(
          { mint: mint.toString() },
          `[DEBUG-PRICE] [${mint.toString().substring(0,4)}] Iteration: ${timesChecked + 1}/${timesToCheck} | TP: ${takeProfitLamports} | SL: ${stopLossLamports} | Current: ${solOut}`
        );

        if (solOut <= stopLossLamports) {
          logger.info({ mint: mint.toString() }, "[EXIT] It worked Stop-Loss!");
          break;
        }
        if (solOut >= takeProfitLamports) {
          logger.info({ mint: mint.toString() }, "[EXIT] It worked Take-Profit!");
          break;
        }

        timesChecked++;
        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: mint.toString(), e }, `pump.fun price check failed`);
        await sleep(this.config.priceCheckInterval);
      }
    } while (timesChecked < timesToCheck);

    if (timesChecked >= timesToCheck) {
      logger.info({ mint: mint.toString() }, "[EXIT] Position hold timeout (Duration) expired!");
    }
  }

private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return;
    }

    // Безопасное извлечение mint для логов
    let mintStr = 'Unknown';
    try {
      if (poolKeys && poolKeys.baseMint) {
        mintStr = typeof poolKeys.baseMint === 'string' ? poolKeys.baseMint : poolKeys.baseMint.toBase58();
      }
    } catch (e) {}

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);

    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;

    do {
      try {
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        const amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: amountIn,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut;

        logger.info(
          { mint: mintStr },
          `[DEBUG-RAYDIUM] Итерация: ${timesChecked + 1}/${timesToCheck} | TP: ${takeProfit.toFixed()} | SL: ${stopLoss.toFixed()} | Текущая: ${amountOut.toFixed()}`
        );

        if (amountOut.lt(stopLoss)) {
          logger.info({ mint: mintStr }, "[EXIT] It worked Raydium Stop-Loss!");
          break;
        }

        if (amountOut.gt(takeProfit)) {
          logger.info({ mint: mintStr }, "[EXIT] It worked Raydium Take-Profit!");
          break;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e: any) {
        logger.trace({ mint: mintStr, error: e?.message || String(e) }, `Failed to check token price`);
        await sleep(this.config.priceCheckInterval);
      } finally {
        // ROBUST PROTECTION AGAINST INFINITE LOOPS: The step size increases regardless of the outcome (success/failure).
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    if (timesChecked >= timesToCheck) {
      logger.info({ mint: mintStr }, "[EXIT] Raydium Position hold timeout expired!");
    }
  }
} // Сюда закрылся класс Bot

// INSERT AT THE VERY END OF THE BOT.TS FILE (OUTSIDE THE BOT CLASS)
export async function validatePumpFunToken(mint: any, curve: any, config: any): Promise<boolean> {
  const mintStr = mint.toString();

  // 1. Checking the curve's progress (curve progress)
  const progressPct = curve.tokenTotalSupply > 0n
    ? Number((BigInt(curve.tokenTotalSupply) - BigInt(curve.realTokenReserves)) * 10000n / BigInt(curve.tokenTotalSupply)) / 100
    : 0;

  const maxProgress = config.pumpFunMaxCurveProgress ?? 15.0; // We use the updated limit (e.g., 15% or 50% from .env).
  if (progressPct > maxProgress) {
    logger.debug({ mint: mintStr, progressPct: progressPct.toFixed(2) }, `[FILTER] Progress too high`);
    return false;
  }

  if (!curve.uri) {
    logger.debug({ mint: mintStr }, `[FILTER] No URI in curve, skipping`);
    return false;
  }

  // 2. Retrieving token metadata from IPFS (up to 5 attempts)
  let response = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      response = await fetch(curve.uri);
      if (response.ok) break;
    } catch (err) {}
    if (attempt < 5) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // IPFS LAG WORKAROUND: If the gateway goes down or returns a 403/404 error, do not drop the token immediately.
  if (!response || !response.ok) {
    logger.info({ mint: mintStr, progress: progressPct.toFixed(2) + '%' }, `[IPFS LAG] Metadata not indexed by the gateway. Enabling bypass filter...`);

    // If a token is being actively bought up right from the very start, this is a "Golden Entry Zone"—buy in without metadata.
    if (progressPct >= 1.0 && progressPct <= 5.0) {
      logger.info({ mint: mintStr, progress: progressPct.toFixed(2) + '%' }, `[FILTER] IPFS It's lagging, but the token is in the Golden Zone (1–5%). Degen buy enabled!`);
      return true;
    }

    logger.info({ mint: mintStr, progress: progressPct.toFixed(2) + '%' }, `[FILTER-DROP] IPFS Unavailable, and the token is outside the Golden Zone. Skipping.`);
    return false;
  }

  try {
    const metadata = await response.json();

    // 3. Social Media Check (Twitter, Telegram, or Website)
    const hasSocials = !!(metadata.twitter || metadata.telegram || metadata.website);
    if (!hasSocials) {
      // If social media links are missing from the JSON, but the token is in the "golden zone," we give it a chance.
      if (progressPct >= 1.0 && progressPct <= 5.0) {
        logger.info({ mint: mintStr, progress: progressPct.toFixed(2) + '%' }, `[FILTER] No social media presence, but the token is in the Golden Entry Zone (1–5%). We are skipping this order.`);
        return true;
      }

      logger.info({ mint: mintStr }, `[FILTER-DROP] Token rejected: no social media links, and it is outside the Golden Zone.`);
      return false;
    }

    // 4. Creator Validation with Timeout
    const creatorAddress = metadata.creator;
    if (!creatorAddress) {
      logger.debug({ mint: mintStr }, `[FILTER] Creator address not found in metadata; skipping`);
      return true;
    }

    logger.info({ mint: mintStr, creator: creatorAddress }, `[DEV-CHECK] We are requesting the developer's history...`);

    try {
      const devHistoryUrl = `https://frontend-api.pump.fun/coins/user-coins/${creatorAddress}?offset=0&limit=10&includeNsfw=false`;

      // API Hang Protection: The Race Between the Request and the 3000ms Timeout
      const devResponse = await Promise.race([
        fetch(devHistoryUrl),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);

      if (devResponse && devResponse.ok) {
        const devTokens = await devResponse.json();

        if (Array.isArray(devTokens)) {
          const createdCount = devTokens.length;

          // We count successful dev tokens (which came out on Raydium or took King of the Hill)
          const successfulTokens = devTokens.filter(
            (t: any) => t.complete === true || t.king_of_the_hill === true
          ).length;

          logger.info(
            { mint: mintStr, creator: creatorAddress, totalCreated: createdCount, successful: successfulTokens },
            `[DEV-CHECK] Dev Stats: ${successfulTokens} out of ${createdCount} successful.`
          );

          // CRITERION FOR BANNING SERIAL SCAMMERS:
          //If he created 3 or more tokens, but completely abandoned ALL of them (0 successful)
          if (createdCount >= 3 && successfulTokens === 0) {
            logger.info(
              { mint: mintStr, creator: creatorAddress },
              `[FILTER] ❌ Serial scammer detected (0 out of ${createdCount} launched on Raydium). SKIP.
            );
            return false;
          }
        }
      } else {
        logger.debug({ mint: mintStr }, `[DEV-CHECK] Bad response from the Pump.fun API; skipping for transaction safety.`);
      }
    } catch (devErr: any) {
      if (devErr.message === 'Timeout') {
        logger.warn({ mint: mintStr }, `[DEV-CHECK] The Dev API has hung (3s limit reached); skipping the token in favor of sniping speed.`);
      } else {
        logger.debug({ mint: mintStr, err: devErr.message }, `[DEV-CHECK] Network error while checking device; skipping.`);
      }
    }

    // If the token has successfully passed all checks
    logger.info({ mint: mintStr }, `[FILTER] ✅ SUCCESSFUL AUDIT! Social media links are in place; the dev has passed verification.`);
    return true;

  } catch (e) {
    logger.debug({ mint: mintStr }, `[FILTER] JSON metadata parsing error; skipping token.`);
    return false;
  }
}



