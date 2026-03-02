import * as net from 'node:net';
import * as fs from 'node:fs';
import type { ConnectionConfig } from '@dbmanager/shared';

type SshClient = import('ssh2').Client;

interface TunnelEntry {
  sshClient: SshClient;
  server: net.Server;
  localPort: number;
}

function createSshClient(): SshClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('ssh2') as typeof import('ssh2');
  return new Client();
}

export class SshTunnelManager {
  private readonly tunnels = new Map<string, TunnelEntry>();

  /**
   * SSH 터널을 생성하고 로컬 포워딩 포트를 반환한다.
   * DB 어댑터는 반환된 localPort로 localhost에 연결하면 된다.
   */
  async createTunnel(
    config: ConnectionConfig,
    sshPassword?: string,
    sshPassphrase?: string,
  ): Promise<number> {
    const ssh = config.ssh;
    if (!ssh?.enabled) {
      throw new Error('SSH is not enabled for this connection');
    }

    // 이미 터널이 열려 있으면 기존 포트 반환
    const existing = this.tunnels.get(config.id);
    if (existing) {
      return existing.localPort;
    }

    const dbHost = config.host ?? '127.0.0.1';
    const dbPort = config.port ?? 3306;

    const sshClient = createSshClient();

    const authConfig: Record<string, unknown> = {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
    };

    if (ssh.authMethod === 'privateKey' && ssh.privateKeyPath) {
      authConfig['privateKey'] = fs.readFileSync(ssh.privateKeyPath);
      if (sshPassphrase) {
        authConfig['passphrase'] = sshPassphrase;
      }
    } else if (sshPassword) {
      authConfig['password'] = sshPassword;
    }

    // SSH 연결 수립
    await new Promise<void>((resolve, reject) => {
      sshClient.on('ready', () => resolve());
      sshClient.on('error', (err) => reject(err));
      sshClient.connect(authConfig as Parameters<SshClient['connect']>[0]);
    });

    // 로컬 TCP 서버 생성 → SSH forwardOut으로 DB 연결
    const server = net.createServer((socket) => {
      sshClient.forwardOut(
        '127.0.0.1',
        0,
        dbHost,
        dbPort,
        (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.pipe(stream).pipe(socket);
        },
      );
    });

    // OS가 자동 할당한 포트로 리스닝
    const localPort = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    this.tunnels.set(config.id, { sshClient, server, localPort });
    return localPort;
  }

  /** 특정 커넥션의 터널 로컬 포트를 반환한다. 터널이 없으면 undefined. */
  getTunnelPort(connectionId: string): number | undefined {
    return this.tunnels.get(connectionId)?.localPort;
  }

  /** 특정 커넥션의 SSH 터널을 닫는다. */
  async closeTunnel(connectionId: string): Promise<void> {
    const entry = this.tunnels.get(connectionId);
    if (!entry) return;

    entry.server.close();
    entry.sshClient.end();
    this.tunnels.delete(connectionId);
  }

  /** 모든 터널을 닫는다. */
  dispose(): void {
    for (const [id] of this.tunnels) {
      void this.closeTunnel(id);
    }
  }
}
