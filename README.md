# Solana Trading Bot (Pump.fun & Raydium) with Simultaneous Paper Trading

A high-speed trading bot for the Solana ecosystem, specializing in automated token sniping and tracking on the **Pump.fun** and **Raydium** platforms.

## 🚀 Key Features
- **Parallel Asynchronous Tracking:** The bot can simultaneously monitor, poll, and simulate sales for dozens of tokens in parallel, without blocking the main network scanning thread.
- **Full-Featured Simulation Mode (Paper Trading):** The bot fully simulates the buying process—calculating dynamic Take-Profit and Stop-Loss levels based on real-time data from Bonding Curves (pump.fun curves) and Raydium pools—without expending any actual SOL.
- **Node Error Isolation:** The logic is safeguarded against frequent network rate limits (HTTP 429 Too Many Requests) and empty node responses (`getAccountInfo` returning `null`); the bot does not reset its position in the event of a network failure but instead patiently awaits the next interval.
- **Informative Debugging:** Real-time logging features concise markers (tags) for each token, facilitating convenient monitoring.

## 🛠 Installation and Setup

1. Install dependencies:
   ```bash
   npm install
Configure the settings in the `.env` file (specify your RPC endpoint and limits).

Launch the bot in development mode:

Bash
npm run dev
For continuous 24/7 operation, use PM2:

Bash
npm install -g pm2
**If you're running the original ts:**
pm2 start index.ts --interpreter ts-node --name "solana-bot"
