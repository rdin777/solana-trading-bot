import { Connection, PublicKey } from '@solana/web3.js';

interface FilterResult {
  isSafe: boolean;
  reason?: string;
  name?: string;
  symbol?: string;
}

export async function checkTokenAntiSpam(
  connection: Connection,
  mintAddress: string,
  txLogs?: string[]
): Promise<FilterResult> {

  let ipfsUrl = '';

  // 0. BODY ARMOR: Aggressive sanitization of the input token address string to remove runtime debris.
  let cleanMintStr = typeof mintAddress === 'string' ? mintAddress : String(mintAddress);
  cleanMintStr = cleanMintStr.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '').trim();

  // 1. Extracting URIs directly from live WebSocket deployment logs
  if (txLogs && txLogs.length > 0) {
    // Option A: Looking for the raw text of the link in the logs
    const logWithUrl = txLogs.find(log => log.includes('https://ipfs') || log.includes('ipfs.io') || log.includes('pump.fun'));
    if (logWithUrl) {
      const urlMatch = logWithUrl.match(/https:\/\/[^\s"'\\]+/);
      if (urlMatch) ipfsUrl = urlMatch[0];
    }

    // Option B: Extracting "Program data:" from the binary Borsh log
    if (!ipfsUrl) {
      const dataLog = txLogs.find(log => log.includes('Program data:'));
      if (dataLog) {
        const base64Str = dataLog.replace('Program data:', '').trim();
        try {
          const buffer = Buffer.from(base64Str, 'base64');
          const httpIndex = buffer.indexOf('https://');
          if (httpIndex !== -1) {
            let extracted = '';
            for (let i = httpIndex; i < buffer.length; i++) {
              const charCode = buffer[i];
              if (charCode < 32 || charCode > 126 || charCode === 34 || charCode === 39) break;
              extracted += String.fromCharCode(charCode);
            }
            if (extracted.startsWith('http')) {
              ipfsUrl = extracted;
            }
          }
        } catch (e) {}
      }
    }
  }

  // 2. Pure Fallback: If the WebSocket logs are empty, gracefully request via RPC.
  if (!ipfsUrl && cleanMintStr.length >= 32 && cleanMintStr.length <= 44) {
    try {
      const mintPublicKey = new PublicKey(cleanMintStr);
      const signatures = await connection.getSignaturesForAddress(mintPublicKey, { limit: 1 }, 'confirmed');

      if (signatures && signatures.length > 0) {
        const tx = await connection.getParsedTransaction(signatures[0].signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });

        if (tx && tx.meta && tx.meta.logMessages) {
          const fallbackLog = tx.meta.logMessages.find(log => log.includes('https://ipfs') || log.includes('ipfs.io'));
          if (fallbackLog) {
            const urlMatch = fallbackLog.match(/https:\/\/[^\s"'\\]+/);
            if (urlMatch) ipfsUrl = urlMatch[0];
          }
        }
      }
    } catch (e) {}
  }

  // If there is absolutely nothing to latch onto
  if (!ipfsUrl) {
    return { isSafe: false, reason: 'Failed to extract manifest URI from WebSocket logs and RPC history' };
  }


// Trim the garbage characters from the end of the string.
  ipfsUrl = ipfsUrl.replace(/[),;]$/, '').trim();

  try {
    let finalUrl = ipfsUrl;

    // 3. Universal Link Router
    if (ipfsUrl.includes('ipfs')) {
      const cidMatch = ipfsUrl.match(/\/ipfs\/([a-zA-Z0-9]{46,59})/);
      if (cidMatch && cidMatch[1]) {
        // If it's good old IPFS, we route it through a stable Pinata mirror.
        finalUrl = `https://pump.mypinata.cloud/ipfs/${cidMatch[1]}`;
      }
    }
    // If this is a new link—such as uxento.io or j7tracker.io—we leave it as is. (finalUrl = ipfsUrl)

    let metadata: any = null;
    let lastStatus = 200;

    // Attempting to download the manifest (supports both IPFS mirrors and direct links).
    try {
      let response = await fetch(finalUrl, {
        signal: AbortSignal.timeout(2000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      // Micro-retry for node synchronization delays
      if (response.status === 404 || response.status === 400) {
        lastStatus = response.status;
        await new Promise(r => setTimeout(r, 300));
        response = await fetch(finalUrl, {
          signal: AbortSignal.timeout(2000),
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
      }

      if (response.ok) {
        metadata = await response.json();
      } else {
        lastStatus = response.status;
      }
    } catch (e: any) {
      // Fallback: If this was IPFS and Pinata is down, try the backup gateway storry.tv
      if (ipfsUrl.includes('ipfs')) {
        const cidMatch = ipfsUrl.match(/\/ipfs\/([\w-]+)/);
        if (cidMatch && cidMatch[1]) {
          try {
            const fallbackResponse = await fetch(`https://storry.tv/ipfs/${cidMatch[1]}`, {
              signal: AbortSignal.timeout(2000)
            });
            if (fallbackResponse.ok) metadata = await fallbackResponse.json();
          } catch (err) {}
        }
      }
    }

    if (!metadata) {
      return { isSafe: false, reason: `Manifest load failed (Code: ${lastStatus}). Link: ${finalUrl}` };
    }

    // Social Media Check
    if (!metadata.twitter && !metadata.telegram && !metadata.website) {
      return { isSafe: false, reason: 'The token completely lacks any social media presence (Twitter, Telegram, Website)' };
    }

    return {
      isSafe: true,
      name: metadata.name || 'Pump Token',
      symbol: metadata.symbol || 'PUMP'
    };

  } catch (error: any) {
    return { isSafe: false, reason: `Manifest parsing error: ${error.message || error}` };
  }
}

