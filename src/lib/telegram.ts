/**
 * Telegram notification module.
 *
 * Sends messages to the configured Telegram chat when:
 *   - A mint succeeds (with tx hash + OpenSea link)
 *   - A mint fails (with error)
 *   - Daily summary (called manually or via cron)
 *
 * Required env vars:
 *   - TELEGRAM_BOT_TOKEN: bot token from @BotFather
 *   - TELEGRAM_CHAT_ID: user's chat ID from @userinfobot
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_API_BASE = 'https://api.telegram.org';

export function isTelegramConfigured(): boolean {
  return !!TELEGRAM_BOT_TOKEN && !!TELEGRAM_CHAT_ID;
}

/**
 * Sends a text message to the configured Telegram chat.
 * Returns true on success, false on failure.
 *
 * Markdown is supported — use *bold*, _italic_, `code`, [links](url).
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) {
    return false;
  }

  try {
    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.error('[telegram] sendMessage failed:', await resp.text());
      return false;
    }

    const data = await resp.json();
    return data.ok === true;
  } catch (e) {
    console.error('[telegram] error:', e);
    return false;
  }
}

/**
 * Notifies about a successful mint.
 */
export async function notifyMintSuccess(opts: {
  contract: string;
  functionName: string;
  txHash: string;
  smartAccountAddress: string;
  collectionName?: string;
  openseaUrl?: string;
  chain?: string;
}): Promise<void> {
  const chain = opts.chain || 'base';
  const name = opts.collectionName || `Contract ${opts.contract.slice(0, 10)}`;
  const osUrl = opts.openseaUrl || `https://opensea.io/assets/${chain}/${opts.contract}`;
  const txUrl = `https://${chain}scan.org/tx/${opts.txHash}`;
  const walletUrl = `https://opensea.io/${opts.smartAccountAddress}`;

  const msg = `✅ *Mint succeeded!*

📦 *Collection:* ${name}
🔗 *Function:* \`${opts.functionName}\`
⛓ *Chain:* ${chain}
📜 *Contract:* [${opts.contract.slice(0, 10)}...](${`https://${chain}scan.org/address/${opts.contract}`})
🎫 *Tx:* [${opts.txHash.slice(0, 10)}...](${txUrl})

🌐 *[View on OpenSea](${osUrl})*
👤 *[View Smart Account](${walletUrl})*
`;

  await sendTelegramMessage(msg);
}

/**
 * Notifies about a failed mint attempt.
 */
export async function notifyMintFailure(opts: {
  contract: string;
  functionName?: string;
  error: string;
  collectionName?: string;
  chain?: string;
}): Promise<void> {
  const chain = opts.chain || 'base';
  const name = opts.collectionName || `Contract ${opts.contract.slice(0, 10)}`;
  const errorMsg = (opts.error || '').slice(0, 400);

  const msg = `❌ *Mint failed*

📦 *Collection:* ${name}
🔗 *Function:* ${opts.functionName || 'unknown'}
⛓ *Chain:* ${chain}
📜 *Contract:* [${opts.contract.slice(0, 10)}...](${`https://${chain}scan.org/address/${opts.contract}`})

⚠ *Error:*
\`${errorMsg}\`
`;

  await sendTelegramMessage(msg);
}

/**
 * Sends a scan summary.
 */
export async function notifyScanSummary(opts: {
  candidatesFound: number;
  mintsAttempted: number;
  mintsSucceeded: number;
  mintsFailed: number;
  scannedContracts: number;
}): Promise<void> {
  const msg = `🔍 *Scan complete*

Found *${opts.candidatesFound}* free-mint candidates
Attempted *${opts.mintsAttempted}* mints
✓ Succeeded: *${opts.mintsSucceeded}*
✗ Failed: *${opts.mintsFailed}*

Total contracts scanned: *${opts.scannedContracts}*
`;

  await sendTelegramMessage(msg);
}

/**
 * Daily summary message.
 */
export async function notifyDailySummary(stats: {
  totalMints: number;
  successfulMints: number;
  failedMints: number;
  smartAccountAddress: string;
  estimatedNftValue: string;
}): Promise<void> {
  const walletUrl = `https://opensea.io/${stats.smartAccountAddress}`;

  const msg = `📊 *Daily Summary*

Total mints today: *${stats.totalMints}*
✓ Successful: *${stats.successfulMints}*
✗ Failed: *${stats.failedMints}*

💰 Estimated NFT portfolio value: *${stats.estimatedNftValue}*

👤 *[View Smart Account on OpenSea](${walletUrl})*
`;

  await sendTelegramMessage(msg);
}
