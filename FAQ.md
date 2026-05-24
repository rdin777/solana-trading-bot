Markdown
# Frequently Asked Questions (FAQ)

**Q: Why do I get "429 Too Many Requests" errors?**
A: This is due to rate limits on free RPC nodes. We highly recommend using a paid Helius "Developer" plan or higher to ensure the speed required for successful sniping.

**Q: Can you promote my token/project?**
A: No. We are an open-source development project, not a marketing agency. Please do not send DM requests regarding promotion.

**Q: How can I support the project?**
A: If this bot helped you trade successfully, donations are welcome at: 8RpjaJQmCrRvKHMXA5ak4CrrLNJnJionwxMfTRG8YAS

**Q: I found a bug. Where do I report it?**
A: Please open an [Issue](https://github.com/your-username/your-repo/issues) here on GitHub with a description of the error and your logs.

**Q: How do I correctly add my private key to the .env file?**
A: The bot requires your private key as a JSON array (standard format for Solana wallets). 

1. **Get your key:** - If you use Phantom: Settings -> Manage Account -> Export Private Key.
   - You will see an array of numbers (e.g., `[123, 45, 67, ...]`).
   
2. **Add to .env:**
   - Open your `.env` file in the bot folder.
   - Find the `PRIVATE_KEY` field.
   - Paste the array exactly as it is, without quotes or extra spaces:
     `PRIVATE_KEY=[123,45,67,89,...]`
   - Save the file and restart the bot.

**⚠️ SECURITY WARNING:**
- Never share your `PRIVATE_KEY` or `.env` file with anyone.
- Never upload your `.env` file to GitHub. Ensure it is listed in your `.gitignore` file.
- We will NEVER ask you for your private key in DMs or support chats. If someone asks for it, it is a scam.
- 
