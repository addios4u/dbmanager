import { useEffect } from 'react';
import type { ExtensionMessage } from '@dbmanager/shared';
import { useConnectionStore } from '../stores/connection';
import { useResultsStore } from '../stores/results';
import { useQueryStore } from '../stores/query';
import { useSchemaStore } from '../stores/schema';
import { useTableDataStore } from '../stores/tableData';
import { useRedisStore } from '../stores/redis';

/**
 * Central message dispatcher: listens for all ExtensionMessage events
 * and routes them to the appropriate Zustand stores.
 *
 * Note: Each webview panel is an independent React app. The initial view
 * is determined by __INITIAL_STATE__.meta.kind, so this hook should NOT
 * override viewState — each panel already knows its purpose.
 */
export function useExtensionMessages(): void {
  const { setConnections, setActiveConnection } = useConnectionStore();
  const { setResults, setError: setResultsError } = useResultsStore();
  const { setExecuting } = useQueryStore();
  const { setDatabases } = useSchemaStore();
  const { setTableData, setLoading: setTableLoading } = useTableDataStore();
  const { setKeys, setSelectedValue, setScanning, setLoadingValue } = useRedisStore();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage;

      switch (msg.type) {
        case 'stateSync':
          setConnections(msg.connections);
          if (msg.activeConnectionId) {
            setActiveConnection(msg.activeConnectionId);
          }
          break;

        case 'queryResult':
          setExecuting(false);
          setResults(
            msg.columns,
            msg.rows,
            msg.totalRows ?? msg.rows.length,
            msg.executionTime,
          );
          break;

        case 'queryError':
          setExecuting(false);
          setResultsError(msg.error);
          break;

        case 'schemaData':
          setDatabases(msg.databases);
          break;

        case 'tableData':
          setTableData({
            connectionId: msg.connectionId,
            table: msg.table,
            columns: msg.columns,
            rows: msg.rows,
            totalRows: msg.totalRows,
            offset: msg.offset,
            primaryKeys: msg.primaryKeys,
          });
          setTableLoading(false);
          break;

        case 'editResult':
          // Handled by TableDataView directly via its own listener
          break;

        case 'exportComplete':
        case 'exportError':
        case 'exportProgress':
          // Handled by ExportDialog directly via its own listener
          break;

        case 'redisKeys':
          setKeys(msg.keys, msg.cursor, msg.hasMore, msg.cursor !== '0');
          setScanning(false);
          break;

        case 'redisValue':
          setSelectedValue(msg.value);
          setLoadingValue(false);
          break;

        case 'error':
          setResultsError(msg.message);
          break;

        case 'filePicked':
        case 'connectionTestResult':
        case 'sshTunnelTestResult':
        case 'tableDDL':
          // Handled by their respective components directly
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [
    setConnections,
    setActiveConnection,
    setResults,
    setResultsError,
    setExecuting,
    setDatabases,
    setTableData,
    setTableLoading,
    setKeys,
    setSelectedValue,
    setScanning,
    setLoadingValue,
  ]);
}
