import React, { useCallback, useEffect, useState } from 'react';
import * as l10n from '@vscode/l10n';
import type { ExtensionMessage } from '@dbmanager/shared';
import { postMessage } from '../../vscode-api';
import { useRedisStore } from '../../stores/redis';
import { useConnectionStore } from '../../stores/connection';
import { ContextHeader } from '../ContextHeader';
import { KeyTree } from './KeyTree';
import { ValueViewer } from './ValueViewer';

interface RedisBrowserProps {
  connectionId: string;
  db?: number;
}

export function RedisBrowser({ connectionId, db }: RedisBrowserProps) {
  const {
    currentDb, pattern, keys, cursor, hasMore,
    selectedKey, selectedValue, isScanning, isLoadingValue,
    setCurrentDb, setPattern, selectKey, setScanning, setLoadingValue,
    setKeys, setSelectedValue,
  } = useRedisStore();

  const connections = useConnectionStore((s) => s.connections);
  const config = connections.find((c) => c.id === connectionId);
  const delimiter = config?.redisDelimiter ?? ':';

  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newKeyType, setNewKeyType] = useState('string');
  const [newValue, setNewValue] = useState('');
  const [newTTL, setNewTTL] = useState('');

  // Set initial DB
  useEffect(() => {
    if (db !== undefined && db !== currentDb) {
      setCurrentDb(db);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for Redis-specific messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage;
      if (msg.type === 'redisKeys' && msg.connectionId === connectionId) {
        setKeys(msg.keys, msg.cursor, msg.hasMore, msg.cursor !== '0');
        setScanning(false);
      }
      if (msg.type === 'redisValue' && msg.connectionId === connectionId) {
        setSelectedValue(msg.value);
        setLoadingValue(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [connectionId, setKeys, setScanning, setSelectedValue, setLoadingValue]);

  const handleScan = useCallback((reset = true) => {
    setScanning(true);
    postMessage({
      type: 'redisScan',
      connectionId,
      pattern,
      cursor: reset ? '0' : cursor,
      count: 200,
      db: currentDb,
    });
  }, [connectionId, pattern, cursor, currentDb, setScanning]);

  const handleDbChange = useCallback((newDb: number) => {
    setCurrentDb(newDb);
    postMessage({ type: 'redisSelectDb', connectionId, db: newDb });
  }, [connectionId, setCurrentDb]);

  const handleSelectKey = useCallback((key: string) => {
    selectKey(key);
    setLoadingValue(true);
    postMessage({ type: 'redisGet', connectionId, key });
  }, [connectionId, selectKey, setLoadingValue]);

  const handleSave = useCallback((key: string, value: string, ttl?: number) => {
    postMessage({ type: 'redisSet', connectionId, key, value, ttl });
  }, [connectionId]);

  const handleDelete = useCallback((key: string) => {
    postMessage({ type: 'redisDel', connectionId, keys: [key] });
    selectKey(null);
  }, [connectionId, selectKey]);

  const handleAddKey = useCallback(() => {
    if (!newKey) return;
    const ttl = newTTL ? parseInt(newTTL, 10) : undefined;
    postMessage({ type: 'redisAddKey', connectionId, key: newKey, keyType: newKeyType, value: newValue, ttl });
    setShowAddForm(false);
    setNewKey('');
    setNewValue('');
    setNewTTL('');
  }, [connectionId, newKey, newKeyType, newValue, newTTL]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ContextHeader connectionId={connectionId} extraInfo={l10n.t('Redis DB {0}', currentDb)} />

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          {l10n.t('DB:')}
          <select
            value={currentDb}
            onChange={(e) => handleDbChange(parseInt(e.target.value, 10))}
            style={{ fontSize: 12, padding: '2px 4px' }}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </label>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          placeholder={l10n.t('Pattern (e.g. user:*)')}
          style={{ flex: 1, minWidth: 100, fontSize: 12, padding: '2px 6px' }}
        />
        <button onClick={() => handleScan()} style={{ fontSize: 12, padding: '2px 10px' }}>
          {l10n.t('Scan')}
        </button>
        <button
          className="secondary"
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ fontSize: 12, padding: '2px 10px' }}
        >
          {l10n.t('+ Add Key')}
        </button>
        <button
          className="secondary"
          onClick={() => selectedKey && handleDelete(selectedKey)}
          disabled={!selectedKey}
          style={{ fontSize: 12, padding: '2px 10px' }}
        >
          {l10n.t('Delete')}
        </button>
      </div>

      {/* Add key form */}
      {showAddForm && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorGroupHeader-tabsBackground, transparent)',
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={l10n.t('Key name')}
            style={{ fontSize: 12, padding: '2px 6px', width: 150 }}
          />
          <select
            value={newKeyType}
            onChange={(e) => setNewKeyType(e.target.value)}
            style={{ fontSize: 12, padding: '2px 4px' }}
          >
            <option value="string">string</option>
            <option value="list">list</option>
            <option value="set">set</option>
            <option value="hash">hash</option>
          </select>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={l10n.t('Value')}
            style={{ flex: 1, minWidth: 80, fontSize: 12, padding: '2px 6px' }}
          />
          <input
            type="number"
            value={newTTL}
            onChange={(e) => setNewTTL(e.target.value)}
            placeholder={l10n.t('TTL (s)')}
            style={{ width: 70, fontSize: 12, padding: '2px 6px' }}
          />
          <button onClick={handleAddKey} style={{ fontSize: 12, padding: '2px 10px' }}>
            {l10n.t('Add')}
          </button>
          <button className="secondary" onClick={() => setShowAddForm(false)} style={{ fontSize: 12, padding: '2px 10px' }}>
            {l10n.t('Cancel')}
          </button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Key tree */}
        <div style={{
          width: 280, flexShrink: 0,
          borderRight: '1px solid var(--vscode-panel-border, #333)',
          display: 'flex', flexDirection: 'column',
        }}>
          <KeyTree
            keys={keys}
            selectedKey={selectedKey}
            onSelectKey={handleSelectKey}
            onLoadMore={() => handleScan(false)}
            hasMore={hasMore}
            delimiter={delimiter}
            isScanning={isScanning}
          />
        </div>

        {/* Value viewer */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ValueViewer
            value={selectedValue}
            isLoading={isLoadingValue}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        </div>
      </div>
    </div>
  );
}
