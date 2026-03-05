import type { DatabaseAdapter } from '../adapters/base.js';
import type { ColumnInfo } from '@dbmanager/shared';

interface CacheEntry {
  text: string;
  builtAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TABLES = 60; // prevent token overload

const schemaCache = new Map<string, CacheEntry>();

export function invalidateSchemaCache(connectionId: string): void {
  for (const key of schemaCache.keys()) {
    if (key.startsWith(connectionId + ':')) {
      schemaCache.delete(key);
    }
  }
}

export async function getSchemaText(
  connectionId: string,
  adapter: DatabaseAdapter,
  dbType: string,
  currentSchema?: string,
  currentDatabase?: string,
): Promise<string> {
  const cacheKey = `${connectionId}:${currentDatabase ?? ''}:${currentSchema ?? ''}`;
  const cached = schemaCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
    return cached.text;
  }

  const tables = await adapter.getTables(currentSchema);
  const limited = tables.slice(0, MAX_TABLES);

  const tableSchemas = await Promise.all(
    limited.map(async (table) => {
      const columns = await adapter.getColumns(table.name, currentSchema);
      return formatTable(table.name, columns, dbType, currentSchema);
    }),
  );

  const headerParts: string[] = [`-- DB type: ${dbType}`];
  if (currentDatabase) headerParts.push(`-- Database: ${currentDatabase}`);
  if (currentSchema) headerParts.push(`-- Schema: ${currentSchema}`);
  if (tables.length > MAX_TABLES) {
    headerParts.push(`-- (showing ${MAX_TABLES} of ${tables.length} tables)`);
  }

  const text = headerParts.join('\n') + '\n\n' + tableSchemas.join('\n\n');
  schemaCache.set(cacheKey, { text, builtAt: Date.now() });
  return text;
}

function formatTable(tableName: string, columns: ColumnInfo[], dbType: string, schema?: string): string {
  const q = (name: string) => quoteIdentifier(name, dbType);
  const fullName = schema ? `${q(schema)}.${q(tableName)}` : q(tableName);

  const colDefs = columns.map((col) => {
    const parts: string[] = [`  ${q(col.name)} ${col.type}`];
    if (!col.nullable) parts.push('NOT NULL');
    if (col.isPrimaryKey) parts.push('PRIMARY KEY');
    if (col.isAutoIncrement && dbType !== 'postgresql') parts.push('AUTO_INCREMENT');
    if (col.defaultValue !== null) parts.push(`DEFAULT ${col.defaultValue}`);
    if (col.comment) parts.push(`/* ${col.comment} */`);
    return parts.join(' ');
  });

  return `CREATE TABLE ${fullName} (\n${colDefs.join(',\n')}\n);`;
}

function quoteIdentifier(name: string, dbType: string): string {
  if (dbType === 'mysql' || dbType === 'mariadb') {
    return '`' + name.replace(/`/g, '``') + '`';
  }
  return '"' + name.replace(/"/g, '""') + '"';
}
