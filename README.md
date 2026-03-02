# DB Manager

[![Version](https://img.shields.io/visual-studio-marketplace/v/addios4u.dbmanager)](https://marketplace.visualstudio.com/items?itemName=addios4u.dbmanager)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/addios4u.dbmanager)](https://marketplace.visualstudio.com/items?itemName=addios4u.dbmanager)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/addios4u.dbmanager)](https://marketplace.visualstudio.com/items?itemName=addios4u.dbmanager)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/addios4u.dbmanager)](https://marketplace.visualstudio.com/items?itemName=addios4u.dbmanager)

**DB Manager** is a VS Code / Cursor extension that brings full-featured database management directly into your editor. Connect to MySQL, MariaDB, PostgreSQL, SQLite, and Redis — browse schemas, write queries, edit data, and export results without leaving your IDE.

![DB Manager overview](https://raw.githubusercontent.com/addios4u/dbmanager/main/assets/screenshots/01.png)

---

## Supported Databases

| Database | Driver | Version |
|----------|--------|---------|
| MySQL | `mysql2` | 5.7+ |
| MariaDB | `mysql2` | 10.3+ |
| PostgreSQL | `pg` | 12+ |
| SQLite | `better-sqlite3` | 3.x |
| Redis | `ioredis` | 6+ |

---

## Features

### Connection Management

- Save and manage multiple database connections
- Organize connections into **custom groups** (folders)
- **Color-coded** connections for visual identification
- **SSH tunnel** support with password or private key authentication (passphrase supported)
- **SSL/TLS** support for secure remote connections
- Passwords stored securely in the **OS keychain** via VS Code SecretStorage
- Test connection and SSH tunnel before saving
- **Create / Drop database** directly from the sidebar context menu

### Schema Browser

Explore your database structure from the Explorer sidebar with a lazy-loading tree view.

```
Connection Groups (custom folders)
  └─ Connection (MySQL / MariaDB / PG / SQLite / Redis)
       └─ Database
            └─ Schema (PostgreSQL only)
                 ├─ Tables
                 │    └─ Table
                 │         ├─ Columns (type, nullable, default, PK, auto-increment)
                 │         ├─ Indexes (unique, primary, composite)
                 │         └─ Foreign Keys (with cascade rules)
                 ├─ Views
                 └─ Routines / Triggers (PostgreSQL)
```

- Click a connection to auto-connect and expand its children
- Right-click context menus for every node level
- View DDL for tables and views
- Drop tables with confirmation
- Server information display (version, charset, uptime, platform)

### SQL Query Editor

![Query editor](https://raw.githubusercontent.com/addios4u/dbmanager/main/assets/screenshots/02.png)

- **Monaco Editor** with SQL syntax highlighting
- **Execute** full query or selected text only (`Cmd+Enter` / `Ctrl+Enter`)
- **Query cancellation** — stop long-running queries mid-execution
- **Database/schema context selector** — switch target database without reconnecting
- **Query history** — browse and re-run up to 1,000 recent queries
- **SQL file integration** — open `.sql` files directly in the DB Manager query editor with connection context metadata
- **Execution stats** — elapsed time, affected rows, error details

### Table Data Viewer & Editor

![Table data editor](https://raw.githubusercontent.com/addios4u/dbmanager/main/assets/screenshots/04.png)

Powered by [AG Grid](https://www.ag-grid.com/) for high-performance data browsing:

- **Sort & filter** columns by clicking headers
- **Resize** columns by dragging borders
- **Pagination** with First / Previous / Next / Last navigation (100 rows per page)
- **WHERE clause** filtering — apply custom filters without leaving the grid
- **Inline editing** — double-click cells to INSERT, UPDATE, or DELETE rows (requires primary key)
- **Batch changes** — stage multiple edits and apply them all at once
- **Row insertion** — add new rows via pinned top row
- **Bulk delete** — select multiple rows with checkboxes and delete at once
- **Undo** pending changes before saving

### Data Export & Import

![Export dialog](https://raw.githubusercontent.com/addios4u/dbmanager/main/assets/screenshots/03.png)

Export query results or entire tables in multiple formats:

| Format | Options |
|--------|---------|
| **CSV** | Configurable delimiter (comma, semicolon, tab, pipe) |
| **JSON** | Optional pretty-print |
| **SQL** | Optional `DROP TABLE` statement |
| **XML** | Proper escaping |
| **Excel** | `.xlsx` via ExcelJS |

Import data from files into tables:

| Format | Support |
|--------|---------|
| **CSV** | Header row detection |
| **JSON** | Array of objects |
| **XML** | Row-based structure |
| **Excel** | `.xlsx` parsing |

- Auto-suggested filenames with timestamps
- Progress tracking for large exports/imports
- Row count confirmation before import

### SQL File Integration

![SQL file integration](https://raw.githubusercontent.com/addios4u/dbmanager/main/assets/screenshots/05.png)

- Open `.sql` files directly in the DB Manager custom editor
- Auto-generated metadata header with connection name, type, database, and schema
- Execute queries with `Cmd+Enter` / `Ctrl+Enter` and view results inline
- Save queries to `.sql` files with `Cmd+S` / `Ctrl+S`

### Backup & Restore

Back up and restore databases directly from the sidebar context menu.

| Database | Backup Method | Restore Method |
|----------|--------------|----------------|
| MySQL / MariaDB | `mysqldump` (with fallback to SQL export) | `mysql` CLI (with SQL fallback) |
| PostgreSQL | `pg_dump` (with fallback to SQL export) | `psql` CLI (with SQL fallback) |
| SQLite | File copy (including WAL/SHM) | File replacement |

- Auto-detection of CLI tools with manual override
- Progress tracking with cancellation support
- Timestamped backup filenames
- Works through SSH tunnels

### Redis Browser

- Select database (0–15) with key count per database
- **SCAN-based** key browsing (safe for large databases — never uses `KEYS *`)
- Tree view representation of keys with configurable delimiter
- View, edit, and delete key values
- TTL management (view and set expiration)
- Add new keys with type selection (string, list, set, hash)

### Internationalization

DB Manager supports multiple languages via VS Code's built-in localization:

| Language | Status |
|----------|--------|
| English | Default |
| Korean (ko) | Supported |
| Japanese (ja) | Supported |
| Chinese Simplified (zh-cn) | Supported |

---

## Getting Started

1. Install **DB Manager** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=addios4u.dbmanager) or [Open VSX Registry](https://open-vsx.org/extension/addios4u/dbmanager).
2. Open the **Explorer** sidebar — you'll see the **DBManager - Connections** panel.
3. Click the **+** button to add a new connection.
4. Fill in connection details, click **Test Connection**, then **Save**.
5. Click your saved connection to connect and browse schemas.
6. Right-click a table to **View Data**, **Edit Data**, **Show DDL**, or **Export**.
7. Right-click a database to open a **New Query** editor, **Backup**, or **Restore**.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Enter` / `Ctrl+Enter` | Execute query (or selected text) |
| `Cmd+S` / `Ctrl+S` | Save query to `.sql` file |

---

## Requirements

- VS Code 1.95+ or Cursor
- For backup/restore CLI features: `mysqldump`/`mysql`, `pg_dump`/`psql` installed locally (optional — SQL-based fallback is always available)

---

## Development

```bash
# Install dependencies
pnpm install

# Build (shared → webview-ui → extension)
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

Press **F5** in VS Code to launch the Extension Development Host.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Extension host | TypeScript + VS Code Extension API |
| Webview UI | React 18 + Zustand |
| SQL editor | Monaco Editor |
| Data grid | AG Grid |
| Build | esbuild (extension) + Vite (webview) |
| Test | Vitest |
| Package manager | pnpm workspaces (monorepo) |

---

## Support

If you find DB Manager useful, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/addios4u)

---

## License

[MIT](LICENSE)
