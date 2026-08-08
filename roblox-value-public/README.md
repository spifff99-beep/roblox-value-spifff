# Roblox Value Public

A public Roblox inventory-value checker with a shared leaderboard.

## Requirements

- Node.js 18+
- A Roblox Open Cloud API key with the permissions required by the Inventory API

## Setup

1. Copy `.env.example` to `.env`.
2. Put your Roblox Open Cloud API key in `.env`.
3. Run:

```bash
npm install
npm start
```

4. Open:

http://localhost:3000

The SQLite database is created automatically in `data/`.

## Notes

This app stores only public Roblox identifiers and calculated values. It does not collect Roblox passwords, session cookies, or authentication tokens.

The displayed value is an estimate based on prices returned by Roblox's catalog data. It is not necessarily RAP, projected value, or guaranteed resale proceeds.

For production hosting, put the site behind HTTPS and add rate limiting/authentication for admin operations.