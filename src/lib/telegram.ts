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
 *
 * @param replyMarkup optional inline keyboard markup
 */
export async function sendTelegramMessage(
  text: string,
  replyMarkup?: any
): Promise<boolean> {
  if (!isTelegramConfigured()) {
    return false;
  }

  try {
    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body: any = {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[telegram] sendMessage failed:', resp.status, errText);
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
 * Builds an inline keyboard with main bot actions.
 */
export function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 Status', callback_data: '/status' },
        { text: '🔍 Scan', callback_data: '/scan' },
      ],
      [
        { text: '⚡ Run Cycle', callback_data: '/run' },
        { text: '📜 Recent', callback_data: '/recent' },
      ],
      [
        { text: '⛓ Chains', callback_data: '/chains' },
        { text: '💰 Balance', callback_data: '/balance' },
      ],
      [
        { text: '🌐 Open Dashboard', url: 'https://base-airdrop-radar.vercel.app/dashboard' },
      ],
    ],
  };
}

/**
 * Sends a message with the main menu inline keyboard.
 */
export async function sendMainMenu(extraText?: string): Promise<boolean> {
  const text = extraText
    ? `${extraText}\n\n👇 Tap a button below:`
    : `🤖 *Base Sniper Bot*\n\nAuto-scans 5 chains (Base, Optimism, Arbitrum, Polygon, Ethereum) for free NFT mints every 5 minutes. Gasless via Pimlico Paymaster.\n\n👇 Tap a button below:`;
  return sendTelegramMessage(text, getMainMenuKeyboard());
}

/**
 * Notifies about a successful mint.
 * Basic version — called immediately after txHash is known.
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

🌐 *[View on OpenSea](${osUrl})* — listing link incoming...
👤 *[View Smart Account](${walletUrl})*
`;

  await sendTelegramMessage(msg);
}

/**
 * Sends a follow-up message with the direct OpenSea sell URL (with token_id extracted from receipt).
 * Called separately after we fetch the receipt (10-30s after mint).
 */
export async function notifyListingLink(opts: {
  contract: string;
  tokenId: string;
  chain?: string;
  collectionName?: string;
  estimatedFloor?: number | null;
}): Promise<void> {
  const chain = opts.chain || 'base';
  const name = opts.collectionName || `Contract ${opts.contract.slice(0, 10)}`;
  const sellUrl = `https://opensea.io/assets/${chain}/${opts.contract}/${opts.tokenId}/sell`;

  const floorLine =
    opts.estimatedFloor !== undefined && opts.estimatedFloor !== null && opts.estimatedFloor > 0
      ? `\n💰 *Floor:* ~${opts.estimatedFloor} ETH (list at this or slightly below for fast sale)`
      : '\n💰 *Floor:* unknown — check the page before listing';

  const msg = `🚀 *Ready to list — ${name}*

🎫 *Token ID:* \`${opts.tokenId}\`
⛓ *Chain:* ${chain}${floorLine}

⚡ *[OPEN SELL FORM](${sellUrl})* ← click, enter price, confirm

💡 *Tip:* List 5-10% below floor for fast sale. OpenSea takes 2.5% fee.`;

  await sendTelegramMessage(msg);
}

/**
 * Notifies about a successful mint WITH direct OpenSea sell link.
 *
 * After a mint succeeds, we wait for the receipt, parse Transfer events to
 * extract the token_id, then build a direct URL to OpenSea's sell form.
 * User clicks → enters price → lists.
 *
 * This is the fastest path to profit (auto-listing via Seaport is complex,
 * but a pre-filled sell URL is enough for fast manual listing).
 */
export async function notifyMintSuccessWithListing(opts: {
  contract: string;
  txHash: string;
  smartAccountAddress: string;
  collectionName?: string;
  chain?: string;
  openseaSellUrl?: string;
  tokenId?: string;
  estimatedFloor?: number | null;
}): Promise<void> {
  const chain = opts.chain || 'base';
  const name = opts.collectionName || `Contract ${opts.contract.slice(0, 10)}`;

  const sellUrl = opts.openseaSellUrl || `https://opensea.io/assets/${chain}/${opts.contract}`;
  const txUrl = `https://${chain}scan.org/tx/${opts.txHash}`; // Note: this only works for some chains
  const walletUrl = `https://opensea.io/${opts.smartAccountAddress}`;

  const tokenIdLine = opts.tokenId
    ? `\n🎫 *Token ID:* \`${opts.tokenId}\``
    : '';
  const floorLine =
    opts.estimatedFloor !== undefined && opts.estimatedFloor !== null
      ? `\n💰 *Floor:* ${opts.estimatedFloor} ETH`
      : '';

  const msg = `✅ *Mint succeeded!*

📦 *Collection:* ${name}
⛓ *Chain:* ${chain}
📜 *Contract:* [${opts.contract.slice(0, 10)}...](${`https://${chain}scan.org/address/${opts.contract}`})${tokenIdLine}${floorLine}
🎫 *Tx:* [${opts.txHash.slice(0, 10)}...](${txUrl})

🚀 *[LIST FOR SALE NOW](${sellUrl})* ← click to open sell form
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
