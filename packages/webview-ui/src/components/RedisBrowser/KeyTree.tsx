import React, { useMemo, useState, useCallback } from 'react';
import * as l10n from '@vscode/l10n';
import type { RedisKeyInfo } from '@dbmanager/shared';

interface TreeNode {
  label: string;
  fullKey?: string;
  type?: string;
  ttl?: number;
  children: Map<string, TreeNode>;
  keyCount: number;
}

interface KeyTreeProps {
  keys: RedisKeyInfo[];
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
  delimiter: string;
  isScanning: boolean;
}

function buildTree(keys: RedisKeyInfo[], delimiter: string): TreeNode {
  const root: TreeNode = { label: '', children: new Map(), keyCount: 0 };

  for (const k of keys) {
    const parts = delimiter ? k.key.split(delimiter) : [k.key];
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? k.key;
      const isLeaf = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          label: part,
          children: new Map(),
          keyCount: 0,
          ...(isLeaf ? { fullKey: k.key, type: k.type, ttl: k.ttl } : {}),
        });
      }

      const child = current.children.get(part)!;
      if (isLeaf && !child.fullKey) {
        child.fullKey = k.key;
        child.type = k.type;
        child.ttl = k.ttl;
      }
      current = child;
    }
  }

  // Count leaves
  function countLeaves(node: TreeNode): number {
    if (node.children.size === 0) return 1;
    let count = node.fullKey ? 1 : 0;
    for (const child of node.children.values()) {
      count += countLeaves(child);
    }
    node.keyCount = count;
    return count;
  }
  countLeaves(root);

  return root;
}

const TYPE_COLORS: Record<string, string> = {
  string: 'rgba(76, 175, 80, 0.8)',
  list: 'rgba(33, 150, 243, 0.8)',
  set: 'rgba(156, 39, 176, 0.8)',
  zset: 'rgba(255, 152, 0, 0.8)',
  hash: 'rgba(0, 150, 136, 0.8)',
};

function TreeNodeView({
  node,
  level,
  selectedKey,
  onSelectKey,
  expanded,
  toggleExpand,
  path,
}: {
  node: TreeNode;
  level: number;
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
  expanded: Set<string>;
  toggleExpand: (path: string) => void;
  path: string;
}) {
  const isLeaf = node.fullKey !== undefined && node.children.size === 0;
  const isFolder = node.children.size > 0;
  const isExpanded = expanded.has(path);
  const isSelected = isLeaf && node.fullKey === selectedKey;

  const handleClick = useCallback(() => {
    if (isLeaf && node.fullKey) {
      onSelectKey(node.fullKey);
    } else if (isFolder) {
      toggleExpand(path);
    }
  }, [isLeaf, isFolder, node.fullKey, onSelectKey, toggleExpand, path]);

  const sortedChildren = useMemo(() => {
    if (!isFolder) return [];
    return Array.from(node.children.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [node.children, isFolder]);

  return (
    <>
      <div
        onClick={handleClick}
        style={{
          paddingLeft: level * 16 + 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          fontSize: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: isSelected
            ? 'var(--vscode-list-activeSelectionBackground)'
            : 'transparent',
          color: isSelected
            ? 'var(--vscode-list-activeSelectionForeground)'
            : 'inherit',
        }}
        className="key-tree-node"
      >
        {isFolder && (
          <span style={{ fontSize: 10, width: 12, flexShrink: 0, textAlign: 'center' }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        {isLeaf && <span style={{ width: 12, flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.label}
        </span>
        {isFolder && (
          <span style={{ opacity: 0.5, fontSize: 10, flexShrink: 0 }}>
            {l10n.t('({0})', node.keyCount)}
          </span>
        )}
        {isLeaf && node.type && (
          <span
            style={{
              fontSize: 9,
              padding: '0 4px',
              borderRadius: 3,
              flexShrink: 0,
              background: (TYPE_COLORS[node.type] ?? 'rgba(128,128,128,0.3)').replace('0.8', '0.15'),
              color: TYPE_COLORS[node.type] ?? 'inherit',
            }}
          >
            {node.type}
          </span>
        )}
      </div>
      {isFolder && isExpanded &&
        sortedChildren.map(([key, child]) => (
          <TreeNodeView
            key={key}
            node={child}
            level={level + 1}
            selectedKey={selectedKey}
            onSelectKey={onSelectKey}
            expanded={expanded}
            toggleExpand={toggleExpand}
            path={`${path}/${key}`}
          />
        ))
      }
    </>
  );
}

export function KeyTree({
  keys,
  selectedKey,
  onSelectKey,
  onLoadMore,
  hasMore,
  delimiter,
  isScanning,
}: KeyTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildTree(keys, delimiter), [keys, delimiter]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const sortedChildren = useMemo(
    () => Array.from(tree.children.entries()).sort(([a], [b]) => a.localeCompare(b)),
    [tree.children],
  );

  if (isScanning && keys.length === 0) {
    return (
      <div style={{ padding: 16, opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
        {l10n.t('Scanning...')}
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div style={{ padding: 16, opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
        {l10n.t('Click Scan to load keys')}
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {sortedChildren.map(([key, child]) => (
        <TreeNodeView
          key={key}
          node={child}
          level={0}
          selectedKey={selectedKey}
          onSelectKey={onSelectKey}
          expanded={expanded}
          toggleExpand={toggleExpand}
          path={key}
        />
      ))}
      {hasMore && (
        <div style={{ padding: 8 }}>
          <button
            className="secondary"
            style={{ width: '100%', fontSize: 12 }}
            onClick={onLoadMore}
          >
            {l10n.t('Load more')}
          </button>
        </div>
      )}
    </div>
  );
}
