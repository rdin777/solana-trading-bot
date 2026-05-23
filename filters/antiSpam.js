"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTokenAntiSpam = void 0;
const web3_js_1 = require("@solana/web3.js");
async function checkTokenAntiSpam(connection, mintAddress, txLogs) {
    let ipfsUrl = '';
    // 1. Извлекаем URI напрямую из живых WebSocket-логов деплоя
    if (txLogs && txLogs.length > 0) {
        // Вариант А: Ищем сырой текст ссылки в логах (если нода/программа парсит её в текстовый лог)
        const logWithUrl = txLogs.find(log => log.includes('https://ipfs') || log.includes('ipfs.io') || log.includes('pump.fun'));
        if (logWithUrl) {
            const urlMatch = logWithUrl.match(/https:\/\/[^\s"'\\]+/);
            if (urlMatch)
                ipfsUrl = urlMatch[0];
        }
        // Вариант Б: Достаем из бинарного Borsh-лога "Program data:", который мы видели на скриншоте 328
        if (!ipfsUrl) {
            const dataLog = txLogs.find(log => log.includes('Program data:'));
            if (dataLog) {
                const base64Str = dataLog.replace('Program data:', '').trim();
                try {
                    const buffer = Buffer.from(base64Str, 'base64');
                    // Находим смещение начала строки "https://" внутри буфера
                    const httpIndex = buffer.indexOf('https://');
                    if (httpIndex !== -1) {
                        let extracted = '';
                        for (let i = httpIndex; i < buffer.length; i++) {
                            const charCode = buffer[i];
                            // Останавливаемся на управляющих символах, пробелах или кавычках
                            if (charCode < 32 || charCode > 126 || charCode === 34 || charCode === 39)
                                break;
                            extracted += String.fromCharCode(charCode);
                        }
                        if (extracted.startsWith('http')) {
                            ipfsUrl = extracted;
                        }
                    }
                }
                catch (e) { }
            }
        }
    }
    // 2. Чистый фоллбэк: Если логи из вебсокета пустые, аккуратно запрашиваем RPC
    if (!ipfsUrl) {
        try {
            const mintPublicKey = new web3_js_1.PublicKey(mintAddress.trim());
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
                        if (urlMatch)
                            ipfsUrl = urlMatch[0];
                    }
                }
            }
        }
        catch (e) { }
    }
    // Если совсем не за что зацепиться
    if (!ipfsUrl) {
        return { isSafe: false, reason: 'Не удалось извлечь URI манифеста из WebSocket-логов и RPC истории' };
    }
    // Срезаем мусорные символы на конце строки (если попали скобки или знаки препинания из лога)
    ipfsUrl = ipfsUrl.replace(/[),;]$/, '').trim();
    try {
        // 3. Переключаемся на быстрый шлюз Cloudflare IPFS, чтобы не виснуть на тормозах pump.fun
        if (ipfsUrl.includes('pump.fun') || ipfsUrl.includes('ipfs.io')) {
            const cidMatch = ipfsUrl.match(/\/ipfs\/([\w]+)/);
            if (cidMatch && cidMatch[1]) {
                ipfsUrl = `https://cloudflare-ipfs.com/ipfs/${cidMatch[1]}`;
            }
        }
        // 4. Запрашиваем JSON-манифест метаданных токена
        const response = await fetch(ipfsUrl, { signal: AbortSignal.timeout(2000) });
        if (!response.ok) {
            return { isSafe: false, reason: `Сбой шлюза IPFS при проверке соцсетей (Код: ${response.status})` };
        }
        const metadata = await response.json();
        // Наш главный фильтр против скам-пустышек без ссылок
        if (!metadata.twitter && !metadata.telegram && !metadata.website) {
            return { isSafe: false, reason: 'У токена полностью отсутствуют соцсети (Твиттер/ТГ/Сайт)' };
        }
        return {
            isSafe: true,
            name: metadata.name || 'Pump Token',
            symbol: metadata.symbol || 'PUMP'
        };
    }
    catch (error) {
        return { isSafe: false, reason: `Ошибка разбора манифеста: ${error.message || error}` };
    }
}
exports.checkTokenAntiSpam = checkTokenAntiSpam;
//# sourceMappingURL=antiSpam.js.map