// routes/redis.js
const redis = require('redis');

let client;
(async () => {
  client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  });

  client.on('error', (err) => console.error('Redis Client Error', err));
  client.on('connect', () => console.log('✅ Redis connected'));
  client.on('ready', () => console.log('🚀 Redis ready'));

  await client.connect();
})();

// A small, consistent wrapper:
// - cache.get(key) => returns parsed JSON or null
// - cache.set(key, value, ttlSeconds?) => stores JSON; if ttlSeconds provided, uses EX
// - cache.del(key)
const cache = {
  get: async (key) => {
    if (!client) return null;
    const raw = await client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  },

  // TTL is optional (seconds). If ttl is provided it must be an integer.
  set: async (key, value, ttlSeconds = null) => {
    if (!client) return;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    if (Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
      // correct redis v4 usage
      await client.set(key, payload, { EX: ttlSeconds });
    } else {
      await client.set(key, payload);
    }
  },

  del: async (key) => {
    if (!client) return;
    await client.del(key);
  }
};

module.exports = cache;
