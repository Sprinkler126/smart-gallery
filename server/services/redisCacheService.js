/**
 * Optional Redis Cache Service
 *
 * Redis is disabled by default. Enable it with either:
 * - server/config.json: { "redis": { "enabled": true, "url": "redis://localhost:6379" } }
 * - environment: REDIS_ENABLED=true REDIS_URL=redis://localhost:6379
 */

export class RedisCacheService {
  constructor(config = {}) {
    const redisConfig = config.redis || {};

    this.config = {
      ...redisConfig,
      enabled: process.env.REDIS_ENABLED === 'true' || redisConfig.enabled === true,
      url: process.env.REDIS_URL || redisConfig.url || 'redis://localhost:6379',
      keyPrefix: process.env.REDIS_KEY_PREFIX || redisConfig.keyPrefix || 'smart-gallery',
      connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || redisConfig.connectTimeoutMs || 3000
    };

    this.client = null;
    this.connected = false;
  }

  isEnabled() {
    return this.config.enabled === true;
  }

  isConnected() {
    return this.connected && this.client?.isOpen;
  }

  buildKey(namespace, key) {
    return `${this.config.keyPrefix}:${namespace}:${key}`;
  }

  async connect() {
    if (!this.isEnabled()) {
      console.log('🔴 Redis cache disabled (default)');
      return false;
    }

    if (this.isConnected()) {
      return true;
    }

    try {
      const { createClient } = await import('redis');
      this.client = createClient({
        url: this.config.url,
        socket: {
          connectTimeout: this.config.connectTimeoutMs,
          reconnectStrategy: false
        }
      });

      this.client.on('error', (error) => {
        this.connected = false;
        console.warn('Redis cache error:', error.message);
      });

      await this.client.connect();
      this.connected = true;
      console.log(`🔴 Redis cache enabled: ${this.config.url}`);
      return true;
    } catch (error) {
      this.connected = false;
      console.warn(`Redis cache unavailable, falling back to file cache: ${error.message}`);
      return false;
    }
  }

  async get(namespace, key) {
    if (!this.isConnected()) return null;

    try {
      const value = await this.client.get(this.buildKey(namespace, key));
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.warn(`Redis get failed for ${namespace}:${key}:`, error.message);
      return null;
    }
  }

  async set(namespace, key, value, ttlSeconds = null) {
    if (!this.isConnected()) return false;

    try {
      const redisKey = this.buildKey(namespace, key);
      const payload = JSON.stringify(value);

      if (ttlSeconds && Number(ttlSeconds) > 0) {
        await this.client.set(redisKey, payload, { EX: Number(ttlSeconds) });
      } else {
        await this.client.set(redisKey, payload);
      }

      return true;
    } catch (error) {
      console.warn(`Redis set failed for ${namespace}:${key}:`, error.message);
      return false;
    }
  }

  async delete(namespace, key) {
    if (!this.isConnected()) return false;

    try {
      await this.client.del(this.buildKey(namespace, key));
      return true;
    } catch (error) {
      console.warn(`Redis delete failed for ${namespace}:${key}:`, error.message);
      return false;
    }
  }

  async clearNamespace(namespace) {
    if (!this.isConnected()) return 0;

    try {
      const pattern = this.buildKey(namespace, '*');
      const keys = [];

      for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        keys.push(key);
      }

      if (keys.length > 0) {
        await this.client.del(keys);
      }

      return keys.length;
    } catch (error) {
      console.warn(`Redis namespace clear failed for ${namespace}:`, error.message);
      return 0;
    }
  }

  async loadNamespace(namespace) {
    if (!this.isConnected()) return new Map();

    const entries = new Map();

    try {
      const pattern = this.buildKey(namespace, '*');
      const prefix = this.buildKey(namespace, '');

      for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        const raw = await this.client.get(key);
        if (!raw) continue;
        entries.set(key.slice(prefix.length), JSON.parse(raw));
      }
    } catch (error) {
      console.warn(`Redis namespace load failed for ${namespace}:`, error.message);
    }

    return entries;
  }

  async saveNamespace(namespace, entries) {
    if (!this.isConnected()) return 0;

    let saved = 0;
    for (const [key, value] of entries) {
      if (await this.set(namespace, key, value)) {
        saved++;
      }
    }
    return saved;
  }

  async close() {
    if (!this.client) return;

    try {
      await this.client.quit();
    } catch {
      await this.client.disconnect();
    } finally {
      this.connected = false;
    }
  }
}

export default RedisCacheService;
