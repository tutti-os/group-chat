import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { appPaths, ensureBaseDirs } from "../local/paths.js";

let db: DatabaseSync | null = null;

export function getDb() {
  if (db) return db;
  ensureBaseDirs();
  mkdirSync(dirname(appPaths.dbPath), { recursive: true });
  db = new DatabaseSync(appPaths.dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      artifact_root TEXT NOT NULL,
      default_reply_policy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'group',
      title TEXT NOT NULL,
      group_system_prompt TEXT NOT NULL DEFAULT '',
      collaboration_rules TEXT NOT NULL DEFAULT '',
      collaboration_rules_version INTEGER NOT NULL DEFAULT 1,
      reply_policy TEXT NOT NULL,
      active_branch_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_message TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT,
      runtime_profile_id TEXT,
      identity_id TEXT,
      room_instructions TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      listen_mode TEXT NOT NULL DEFAULT 'passive',
      sort_order INTEGER NOT NULL DEFAULT 0,
      reasoning_effort TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_profiles (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trusted_mode INTEGER NOT NULL DEFAULT 0,
      system_prompt_mode TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      style_prompt TEXT NOT NULL DEFAULT '',
      default_runtime_profile_id TEXT,
      temperature REAL NOT NULL DEFAULT 0.7,
      skill_ids TEXT NOT NULL DEFAULT '[]',
      tool_access_policy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (default_runtime_profile_id) REFERENCES runtime_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      sender_participant_id TEXT,
      sender_name TEXT,
      content TEXT NOT NULL DEFAULT '',
      mentions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'success',
      branch_id TEXT,
      parent_message_id TEXT,
      run_id TEXT,
      token_usage TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS message_blocks (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      metadata TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_message_order ON message_blocks(message_id, sort_order);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      source_run_id TEXT,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      local_path TEXT NOT NULL,
      public_url TEXT NOT NULL,
      text_preview TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      participant_id TEXT,
      assistant_message_id TEXT,
      runtime TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      resume_mode TEXT NOT NULL DEFAULT 'fresh',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      metadata TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_order ON agent_run_events(run_id, sort_order, created_at);

    CREATE TABLE IF NOT EXISTS reply_queue (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id, participant_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reply_queue_updated ON reply_queue(updated_at);

    CREATE TABLE IF NOT EXISTS collaboration_rule_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      previous_rules TEXT NOT NULL DEFAULT '',
      next_rules TEXT NOT NULL DEFAULT '',
      template_id TEXT,
      actor_name TEXT NOT NULL DEFAULT 'local-user',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_rule_events_conversation_version ON collaboration_rule_events(conversation_id, version DESC);

    CREATE TABLE IF NOT EXISTS stream_events (
      id TEXT NOT NULL UNIQUE,
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      room_id TEXT,
      conversation_id TEXT,
      run_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stream_events_seq ON stream_events(seq);
    CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events(conversation_id, seq);

    CREATE TABLE IF NOT EXISTS private_tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source_message_id TEXT,
      source_message_ids TEXT NOT NULL DEFAULT '[]',
      participant_id TEXT NOT NULL,
      participant_name TEXT NOT NULL,
      requester_participant_id TEXT,
      source_preview TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_private_tasks_conversation ON private_tasks(conversation_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS hidden_messages (
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_participant_id TEXT NOT NULL DEFAULT 'local-user',
      hidden_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_participant_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hidden_messages_conversation ON hidden_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_hidden_messages_user ON hidden_messages(user_participant_id);
  `);

  migrateHiddenMessagesPerUser(database);
  ensureColumn(database, "messages", "mentions", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "messages", "visibility", "TEXT NOT NULL DEFAULT 'public'");
  ensureColumn(database, "agent_runs", "visibility", "TEXT NOT NULL DEFAULT 'public'");
  ensureColumn(database, "agent_runs", "trigger_message_id", "TEXT");
  ensureColumn(database, "participants", "listen_mode", "TEXT NOT NULL DEFAULT 'passive'");
  ensureColumn(database, "participants", "room_instructions", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "conversations", "collaboration_rules", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "conversations", "collaboration_rules_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "rooms", "avatar", "TEXT");
  ensureColumn(database, "identities", "default_listen_mode", "TEXT NOT NULL DEFAULT 'passive'");
  ensureColumn(database, "identities", "default_reasoning_effort", "TEXT");
  ensureColumn(database, "private_tasks", "requester_participant_id", "TEXT");
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateHiddenMessagesPerUser(database: DatabaseSync) {
  const rows = database.prepare(`PRAGMA table_info(hidden_messages)`).all() as Array<{ name: string }>;
  const hasUserParticipantId = rows.some((row) => row.name === "user_participant_id");
  if (hasUserParticipantId) return;

  database.exec(`
    ALTER TABLE hidden_messages RENAME TO hidden_messages_legacy;
    CREATE TABLE hidden_messages (
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_participant_id TEXT NOT NULL DEFAULT 'local-user',
      hidden_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_participant_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO hidden_messages (message_id, conversation_id, user_participant_id, hidden_at)
      SELECT message_id, conversation_id, 'local-user', hidden_at FROM hidden_messages_legacy;
    DROP TABLE hidden_messages_legacy;
    CREATE INDEX IF NOT EXISTS idx_hidden_messages_conversation ON hidden_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_hidden_messages_user ON hidden_messages(user_participant_id);
  `);
}

export function json<T>(value: T) {
  return JSON.stringify(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
