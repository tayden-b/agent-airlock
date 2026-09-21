import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/server/config";
import * as schema from "./schema";

/**
 * Process-wide database handle. Cached on globalThis so Next.js dev-mode
 * module reloads do not open a new connection (or re-run DDL) per request.
 */

const SCHEMA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT,
    mission TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL,
    phase TEXT,
    session_verdict_json TEXT,
    usage_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS runs_updated_at_idx ON runs (updated_at)`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    parent_agent_id TEXT,
    mission TEXT,
    description TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agents_run_id_idx ON agents (run_id)`,
  `CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    tool_use_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_kind TEXT NOT NULL,
    input_json TEXT NOT NULL,
    input_summary TEXT NOT NULL,
    mcp_server_json TEXT,
    proposed_at TEXT NOT NULL,
    completed_at TEXT,
    outcome TEXT,
    result_preview TEXT,
    error TEXT,
    assessment_json TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS actions_run_id_idx ON actions (run_id)`,
  `CREATE INDEX IF NOT EXISTS actions_run_agent_idx ON actions (run_id, agent_id)`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export type AirlockDb = LibSQLDatabase<typeof schema>;

interface StorageGlobal {
  __airlockDb?: AirlockDb;
}

/** Ensures the parent directory exists for file: URLs (no-op for others). */
function ensureParentDir(url: string): void {
  if (!url.startsWith("file:")) return;
  const filePath = url.slice("file:".length);
  if (filePath === ":memory:") return;
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

/** Columns added after v1; existing databases get them via ALTER. */
const MIGRATIONS: string[] = [
  `ALTER TABLE runs ADD COLUMN phase TEXT`,
  `ALTER TABLE runs ADD COLUMN session_verdict_json TEXT`,
  `ALTER TABLE runs ADD COLUMN usage_json TEXT`,
];

async function ensureSchema(db: AirlockDb): Promise<void> {
  for (const statement of SCHEMA_DDL) {
    await db.run(sql.raw(statement));
  }
  for (const migration of MIGRATIONS) {
    try {
      await db.run(sql.raw(migration));
    } catch {
      // column already exists
    }
  }
}

/** The shared database connection, with the schema guaranteed to exist. */
export async function getDb(): Promise<AirlockDb> {
  const g = globalThis as StorageGlobal;
  if (!g.__airlockDb) {
    const { url, authToken } = getConfig().storage;
    ensureParentDir(url);
    const db = drizzle(createClient({ url, authToken }), { schema });
    await ensureSchema(db);
    g.__airlockDb = db;
  }
  return g.__airlockDb;
}

/** Test helper: an isolated in-memory database with the schema applied. */
export async function createTestDb(): Promise<AirlockDb> {
  const db = drizzle(createClient({ url: "file::memory:" }), { schema });
  await ensureSchema(db);
  return db;
}
