import type { ConnectionConfig, ServerInfo } from '@dbmanager/shared';
import { MysqlAdapter } from './mysql.js';

export class MariadbAdapter extends MysqlAdapter {
  constructor(
    config: ConnectionConfig,
    password?: string,
    connectHost?: string,
    connectPort?: number,
  ) {
    super(config, password, connectHost, connectPort);
  }

  override async getServerInfo(): Promise<ServerInfo> {
    const info = await super.getServerInfo();
    info.productName = 'MariaDB';
    return info;
  }
}
