export const EXTENSION_ID = 'dbmanager';
export const EXTENSION_NAME = 'DB Manager';

export const VIEW_IDS = {
  EXPLORER: 'dbmanager-explorer',
  CONNECTIONS: 'dbmanager.connections',
} as const;

export const COMMAND_IDS = {
  ADD_CONNECTION: 'dbmanager.addConnection',
  EDIT_CONNECTION: 'dbmanager.editConnection',
  DELETE_CONNECTION: 'dbmanager.deleteConnection',
  CONNECT: 'dbmanager.connect',
  DISCONNECT: 'dbmanager.disconnect',
  NEW_QUERY: 'dbmanager.newQuery',
  VIEW_TABLE_DATA: 'dbmanager.viewTableData',
  EDIT_TABLE_DATA: 'dbmanager.editTableData',
  SHOW_DDL: 'dbmanager.showDDL',
  EXPORT_TABLE: 'dbmanager.exportTable',
  REFRESH: 'dbmanager.refresh',
  DROP_TABLE: 'dbmanager.dropTable',
  VIEW_REDIS_DATA: 'dbmanager.viewRedisData',
} as const;

export const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
  redis: 6379,
};

export const PAGE_SIZE = 100;
export const MAX_QUERY_HISTORY = 1000;
