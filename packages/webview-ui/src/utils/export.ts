import type { ColumnMeta } from '@dbmanager/shared';

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlTagName(name: string): string {
  let tag = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (/^[0-9.-]/.test(tag)) tag = '_' + tag;
  return tag || '_field';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function toCSV(columns: ColumnMeta[], rows: Record<string, unknown>[]): string {
  const headers = columns.map((c) => csvEscape(c.name));
  const lines = [headers.join(',')];
  for (const row of rows) {
    const vals = columns.map((c) => csvEscape(formatValue(row[c.name])));
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}

export function toJSON(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export function toXML(columns: ColumnMeta[], rows: Record<string, unknown>[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<results>');
  for (const row of rows) {
    lines.push('  <row>');
    for (const col of columns) {
      const value = formatValue(row[col.name]);
      const tag = xmlTagName(col.name);
      lines.push(`    <${tag}>${xmlEscape(value)}</${tag}>`);
    }
    lines.push('  </row>');
  }
  lines.push('</results>');
  return lines.join('\n');
}
