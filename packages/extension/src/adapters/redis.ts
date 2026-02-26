import type { ConnectionConfig, RedisValue, ServerInfo } from '@dbmanager/shared';
import type { RedisAdapter as IRedisAdapter, ScanResult } from './base.js';

export class RedisAdapterImpl implements IRedisAdapter {
  private client: import('ioredis').Redis | undefined;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly password?: string,
    private readonly connectHost?: string,
    private readonly connectPort?: number,
  ) {}

  async connect(): Promise<void> {
    const { Redis } = await import('ioredis');
    this.client = new Redis({
      host: this.connectHost ?? this.config.host ?? 'localhost',
      port: this.connectPort ?? this.config.port ?? 6379,
      password: this.password || undefined,
      connectTimeout: 10000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      tls: this.config.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = undefined;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async selectDb(db: number): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    await this.client.select(db);
  }

  async getDbKeycounts(): Promise<Map<number, number>> {
    if (!this.client) throw new Error('Not connected');
    const info = await this.client.info('keyspace');
    const map = new Map<number, number>();
    // INFO keyspace returns lines like "db0:keys=10,expires=2,avg_ttl=1000"
    for (const line of info.split('\n')) {
      const match = line.match(/^db(\d+):keys=(\d+)/);
      if (match) {
        map.set(Number(match[1]), Number(match[2]));
      }
    }
    return map;
  }

  async scan(pattern: string, cursor: string, count: number): Promise<ScanResult> {
    if (!this.client) throw new Error('Not connected');
    const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    return {
      keys,
      cursor: nextCursor,
      hasMore: nextCursor !== '0',
    };
  }

  async get(key: string): Promise<RedisValue> {
    if (!this.client) throw new Error('Not connected');
    const keyType = await this.client.type(key);
    const keyTtl = await this.client.ttl(key);

    let value: unknown;
    switch (keyType) {
      case 'string':
        value = await this.client.get(key);
        break;
      case 'list':
        value = await this.client.lrange(key, 0, -1);
        break;
      case 'set':
        value = await this.client.smembers(key);
        break;
      case 'zset':
        value = await this.client.zrange(key, 0, -1, 'WITHSCORES');
        break;
      case 'hash':
        value = await this.client.hgetall(key);
        break;
      default:
        value = null;
    }

    return { key, type: keyType, value, ttl: keyTtl };
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    await this.client.set(key, value);
    if (ttl !== undefined && ttl > 0) {
      await this.client.expire(key, ttl);
    }
  }

  async del(keys: string[]): Promise<number> {
    if (!this.client) throw new Error('Not connected');
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async type(key: string): Promise<string> {
    if (!this.client) throw new Error('Not connected');
    return this.client.type(key);
  }

  async ttl(key: string): Promise<number> {
    if (!this.client) throw new Error('Not connected');
    return this.client.ttl(key);
  }

  async getServerInfo(): Promise<ServerInfo> {
    if (!this.client) throw new Error('Not connected');
    const info = await this.client.info('server');

    const versionMatch = info.match(/redis_version:([\S]+)/);
    const uptimeMatch = info.match(/uptime_in_seconds:(\d+)/);

    return {
      version: versionMatch?.[1] ?? 'unknown',
      productName: 'Redis',
      uptime: uptimeMatch ? Number(uptimeMatch[1]) : undefined,
    };
  }

  dispose(): void {
    void this.disconnect();
  }
}
