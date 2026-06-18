import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MentionTarget } from "@group-chat/shared";
import { enrichAssistantContentWithWorkspaceResourceLinks, resolveTriggerUserMentions } from "@group-chat/shared";

type MessageRow = {
  id: string;
  conversation_id: string;
  content: string;
  mentions: string;
  run_id: string | null;
  created_at: string;
};

function dbPathForHome(home: string) {
  return join(resolve(home), "data", "group-chat.db");
}

function openDatabase(home: string) {
  const dbPath = dbPathForHome(home);
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function parseMentions(raw: string): MentionTarget[] {
  try {
    const parsed = JSON.parse(raw) as MentionTarget[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mentionsEqual(left: MentionTarget[], right: MentionTarget[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveTriggerMentions(db: DatabaseSync, row: MessageRow): MentionTarget[] {
  const messages = db
    .prepare(
      `SELECT conversation_id, created_at, role, status, mentions, content
       FROM messages
       WHERE conversation_id = ?`,
    )
    .all(row.conversation_id) as Array<{
      conversation_id: string;
      created_at: string;
      role: string;
      status: string;
      mentions: string;
      content: string;
    }>;

  return resolveTriggerUserMentions(
    { conversationId: row.conversation_id, createdAt: row.created_at, role: "assistant" },
    messages.map((message) => ({
      conversationId: message.conversation_id,
      createdAt: message.created_at,
      role: message.role,
      status: message.status,
      content: message.content,
      mentions: parseMentions(message.mentions),
    })),
  );
}

function listCandidateMessages(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT m.id, m.conversation_id,
              COALESCE(NULLIF(main_block.content, ''), m.content) AS content,
              m.mentions, m.run_id, m.created_at
       FROM messages m
       LEFT JOIN message_blocks main_block
         ON main_block.message_id = m.id AND main_block.type = 'main_text'
       WHERE m.role = 'assistant'
         AND m.status = 'success'
         AND (
           m.content LIKE '%issue-%'
           OR main_block.content LIKE '%issue-%'
           OR m.content LIKE '%Issue ID%'
           OR main_block.content LIKE '%Issue ID%'
         )
       ORDER BY m.created_at ASC`,
    )
    .all() as MessageRow[];
}

export function discoverGroupChatHomes() {
  const homes = new Set<string>();
  const explicitHome = process.env.GROUP_CHAT_HOME?.trim();
  if (explicitHome) {
    homes.add(resolve(explicitHome));
  } else {
    homes.add(join(homedir(), ".group-chat"));
  }

  const workspaceRoots = [
    join(homedir(), ".tutti", "apps", "workspaces"),
    join(homedir(), ".tutti-dev", "apps", "workspaces"),
    join(homedir(), ".nextop-dev", "apps", "workspaces"),
  ];
  for (const workspacesRoot of workspaceRoots) {
    if (!existsSync(workspacesRoot)) continue;
    for (const workspaceId of readdirSync(workspacesRoot, { withFileTypes: true })) {
      if (!workspaceId.isDirectory()) continue;
      const home = join(workspacesRoot, workspaceId.name, "group-chat", "data");
      if (existsSync(dbPathForHome(home))) {
        homes.add(home);
      }
    }
  }

  return [...homes];
}

export function backfillAssistantReferenceLinksForHome(home: string, options?: { dryRun?: boolean }) {
  const dryRun = options?.dryRun ?? false;
  const dbPath = dbPathForHome(home);
  console.log(`Database: ${dbPath}`);
  const db = openDatabase(home);
  const candidates = listCandidateMessages(db);
  let scanned = 0;
  let updated = 0;

  const updateMessage = db.prepare(
    `UPDATE messages SET content = ?, mentions = ?, updated_at = ? WHERE id = ?`,
  );
  const updateBlock = db.prepare(
    `UPDATE message_blocks SET content = ?, updated_at = ? WHERE id = ?`,
  );
  const listMainBlocks = db.prepare(
    `SELECT id, content FROM message_blocks WHERE message_id = ? AND type = 'main_text' ORDER BY sort_order ASC`,
  );

  const applyUpdates = (messageId: string, content: string, mentions: MentionTarget[]) => {
    if (dryRun) return;
    const now = new Date().toISOString();
    updateMessage.run(content, JSON.stringify(mentions), now, messageId);
    for (const block of listMainBlocks.all(messageId) as Array<{ id: string; content: string }>) {
      if (block.content !== content) {
        updateBlock.run(content, now, block.id);
      }
    }
  };

  for (const row of candidates) {
    scanned += 1;
    const triggerMentions = resolveTriggerMentions(db, row);
    const enriched = enrichAssistantContentWithWorkspaceResourceLinks(row.content, triggerMentions);
    if (!enriched.mentions.length && enriched.content === row.content) continue;

    const existingMentions = parseMentions(row.mentions);
    const nextMentions = enriched.mentions.length ? enriched.mentions : existingMentions;
    if (enriched.content === row.content && mentionsEqual(existingMentions, nextMentions)) continue;

    updated += 1;
    console.log(`${dryRun ? "[dry-run]" : "[updated]"} ${row.id}`);
    applyUpdates(row.id, enriched.content, nextMentions);
  }

  db.close();
  return { scanned, updated, dryRun, dbPath };
}

const dryRun = process.argv.includes("--dry-run");
const scanAll = process.argv.includes("--all");

if (scanAll) {
  const homes = discoverGroupChatHomes();
  let totalScanned = 0;
  let totalUpdated = 0;
  for (const home of homes) {
    console.log(`\n==> GROUP_CHAT_HOME=${home}`);
    const result = backfillAssistantReferenceLinksForHome(home, { dryRun });
    totalScanned += result.scanned;
    totalUpdated += result.updated;
  }
  console.log(
    `\n${dryRun ? "Dry run" : "Backfill"} complete: databases=${homes.length}, scanned=${totalScanned}, updated=${totalUpdated}`,
  );
} else {
  const home = process.env.GROUP_CHAT_HOME?.trim()
    ? resolve(process.env.GROUP_CHAT_HOME.trim())
    : join(homedir(), ".group-chat");
  const result = backfillAssistantReferenceLinksForHome(home, { dryRun });
  console.log(
    `${result.dryRun ? "Dry run" : "Backfill"} complete: scanned=${result.scanned}, updated=${result.updated}`,
  );
}
