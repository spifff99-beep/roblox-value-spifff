const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.ROBLOX_API_KEY || "";
const MAX_ITEMS = Math.min(Number(process.env.MAX_INVENTORY_ITEMS || 5000), 10000);
const CACHE_MINUTES = Math.max(Number(process.env.CACHE_MINUTES || 15), 1);

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "roblox-value.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  priced_item_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  last_error TEXT
);
`);

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

function robloxRequest(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  return fetch(url, { ...options, headers }).then(async response => {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    if (!response.ok) {
      const err = new Error(data?.message || data?.error || `Roblox API ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return data;
  });
}

async function findUser(username) {
  const data = await robloxRequest("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false
    })
  });
  if (!data.data?.length) throw new Error("Roblox username was not found.");
  return data.data[0];
}

async function getUser(userId) {
  return robloxRequest(
    `https://apis.roblox.com/cloud/v2/users/${encodeURIComponent(userId)}`
  );
}

async function getInventory(userId) {
  if (!API_KEY) throw new Error("ROBLOX_API_KEY is not configured on the server.");

  const items = [];
  let pageToken = "";

  while (items.length < MAX_ITEMS) {
    const params = new URLSearchParams({ maxPageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await robloxRequest(
      `https://apis.roblox.com/cloud/v2/users/${encodeURIComponent(userId)}/inventory-items?${params}`
    );

    const page = Array.isArray(data.inventoryItems) ? data.inventoryItems : [];
    items.push(...page);

    if (!data.nextPageToken || page.length === 0) break;
    pageToken = data.nextPageToken;
  }

  return items.slice(0, MAX_ITEMS);
}

async function getCatalogDetails(assetIds) {
  const result = [];
  const batchSize = 100;

  for (let i = 0; i < assetIds.length; i += batchSize) {
    const batch = assetIds.slice(i, i + batchSize);

    const response = await fetch("https://catalog.roblox.com/v1/catalog/items/details", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        items: batch.map(id => ({ itemType: "Asset", id: Number(id) }))
      })
    });

    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    if (!response.ok) continue;
    if (Array.isArray(data.data)) result.push(...data.data);
  }

  return result;
}

async function calculateValue(userId) {
  const inventory = await getInventory(userId);

  const assetIds = [...new Set(
    inventory
      .map(item => item?.assetDetails?.assetId)
      .filter(Boolean)
  )];

  const catalog = await getCatalogDetails(assetIds);
  const map = new Map(catalog.map(item => [String(item.id), item]));

  let total = 0;
  let priced = 0;

  for (const inventoryItem of inventory) {
    const assetId = inventoryItem?.assetDetails?.assetId;
    if (!assetId) continue;

    const item = map.get(String(assetId));
    if (!item) continue;

    let price = 0;

    if (Number(item.lowestResalePrice) > 0) {
      price = Number(item.lowestResalePrice);
    } else if (Number(item.lowestPrice) > 0) {
      price = Number(item.lowestPrice);
    } else if (Number(item.price) > 0) {
      price = Number(item.price);
    }

    if (price > 0) {
      total += price;
      priced++;
    }
  }

  return {
    value: total,
    itemCount: inventory.length,
    pricedItemCount: priced
  };
}

function rowToPublic(row) {
  return {
    userId: row.user_id,
    username: row.username,
    value: row.value,
    itemCount: row.item_count,
    pricedItemCount: row.priced_item_count,
    updatedAt: row.updated_at,
    error: row.last_error
  };
}

app.get("/api/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT user_id, username, value, item_count, priced_item_count, updated_at, last_error
    FROM users
    ORDER BY value DESC, username COLLATE NOCASE ASC
    LIMIT 250
  `).all();

  res.json(rows.map(rowToPublic));
});

app.post("/api/check", async (req, res) => {
  try {
    const input = String(req.body?.username || "").trim();
    const suppliedId = String(req.body?.userId || "").trim();

    if (!input && !suppliedId) {
      return res.status(400).json({ error: "Enter a Roblox username or User ID." });
    }

    let user;
    if (suppliedId) {
      user = await getUser(suppliedId);
    } else {
      user = await findUser(input);
    }

    const userId = String(user.id || user.userId || "");
    const username = String(user.name || user.username || input);

    if (!userId) throw new Error("Roblox did not return a User ID.");

    const existing = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
    const ageMs = existing ? Date.now() - Date.parse(existing.updated_at) : Infinity;

    // Return a recent cached result instead of hammering Roblox for every visit.
    if (existing && Number.isFinite(ageMs) && ageMs < CACHE_MINUTES * 60 * 1000) {
      return res.json({
        ...rowToPublic(existing),
        cached: true
      });
    }

    let result;
    try {
      result = await calculateValue(userId);
    } catch (error) {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO users (user_id, username, value, item_count, priced_item_count, updated_at, last_error)
        VALUES (?, ?, 0, 0, 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username = excluded.username,
          updated_at = excluded.updated_at,
          last_error = excluded.last_error
      `).run(userId, username, now, error.message);

      return res.status(502).json({
        error: error.message,
        userId,
        username
      });
    }

    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (user_id, username, value, item_count, priced_item_count, updated_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        value = excluded.value,
        item_count = excluded.item_count,
        priced_item_count = excluded.priced_item_count,
        updated_at = excluded.updated_at,
        last_error = NULL
    `).run(
      userId,
      username,
      result.value,
      result.itemCount,
      result.pricedItemCount,
      now
    );

    const saved = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
    res.json({ ...rowToPublic(saved), cached: false });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      error: error.message || "Something went wrong."
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Roblox Value Public running on http://localhost:${PORT}`);
});