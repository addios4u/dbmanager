import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConnectionConfig } from '@dbmanager/shared';
import { SshTunnelManager } from './ssh-tunnel.js';

/**
 * 커넥션 테스트: 드라이버로 직접 연결 시도 후 즉시 종료.
 * SSH 터널이 설정되어 있으면 임시 터널을 생성한다.
 */
export async function testConnection(
  config: ConnectionConfig,
  password?: string,
  sshPassword?: string,
  sshPassphrase?: string,
): Promise<void> {
  let tunnelManager: SshTunnelManager | undefined;
  let connectHost = config.host ?? 'localhost';
  let connectPort = config.port ?? 3306;

  try {
    // SSH 터널이 활성화된 경우 임시 터널 생성
    if (config.ssh?.enabled) {
      tunnelManager = new SshTunnelManager();
      const localPort = await tunnelManager.createTunnel(config, sshPassword, sshPassphrase);
      connectHost = '127.0.0.1';
      connectPort = localPort;
    }

    switch (config.type) {
      case 'mysql':
      case 'mariadb':
        await testMysql(connectHost, connectPort, config.username, password, config.database, config.ssl);
        break;
      case 'postgresql':
        await testPostgresql(connectHost, connectPort, config.username, password, config.database, config.ssl);
        break;
      case 'sqlite':
        testSqlite(config.filepath);
        break;
      case 'redis':
        await testRedis(connectHost, connectPort, password, config.ssl);
        break;
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }
  } finally {
    if (tunnelManager) {
      tunnelManager.dispose();
    }
  }
}

async function testMysql(
  host: string,
  port: number,
  user?: string,
  password?: string,
  database?: string,
  ssl?: boolean,
): Promise<void> {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
    connectTimeout: 10000,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await conn.ping();
  } finally {
    await conn.end();
  }
}

async function testPostgresql(
  host: string,
  port: number,
  user?: string,
  password?: string,
  database?: string,
  ssl?: boolean,
): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({
    host,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
    connectionTimeoutMillis: 10000,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

function testSqlite(filepath?: string): void {
  if (!filepath) {
    throw new Error('SQLite file path is required');
  }
  const resolved = resolvePath(filepath);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  // 파일이 없으면 자동 생성 (WAL 모드), 테스트 후 readonly로 재확인
  const db = new Database(resolved);
  try {
    db.prepare('SELECT 1').get();
  } finally {
    db.close();
  }
}

/**
 * SSH 터널만 단독 테스트: 터널 생성 후 즉시 닫는다.
 */
export async function testSshTunnel(
  config: ConnectionConfig,
  sshPassword?: string,
  sshPassphrase?: string,
): Promise<void> {
  if (!config.ssh?.enabled) {
    throw new Error('SSH tunnel is not enabled');
  }
  const tunnelManager = new SshTunnelManager();
  try {
    await tunnelManager.createTunnel(config, sshPassword, sshPassphrase);
  } finally {
    tunnelManager.dispose();
  }
}

async function testRedis(
  host: string,
  port: number,
  password?: string,
  ssl?: boolean,
): Promise<void> {
  const { Redis } = await import('ioredis');
  const client = new Redis({
    host,
    port,
    password: password || undefined,
    connectTimeout: 10000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    tls: ssl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}
