// redis.js
const redis = require('redis');

let client;

// Immediately connect to Redis
(async () => {
  client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', // local or remote Redis
  });

  client.on('error', (err) => console.error('Redis Client Error', err));

  await client.connect();
  console.log('Connected to Redis');
})();

// Unified cache functions
const cache = {
  // Get cached data
  get: async (key) => {
    if (!client) return null;
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  },

  // Set cached data with optional TTL (default 1 hour)
  set: async (key, value, ttl = 3600) => {
    if (!client) return;
    await client.set(key, JSON.stringify(value), { EX: ttl });
  },

  // Optional: delete cached key
  del: async (key) => {
    if (!client) return;
    await client.del(key);
  },
};

module.exports = cache;
