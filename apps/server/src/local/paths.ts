import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = process.env.GROUP_CHAT_HOME
  ? resolve(process.env.GROUP_CHAT_HOME)
  : join(homedir(), ".group-chat");

export const appPaths = {
  root,
  dataDir: join(root, "data"),
  identitiesDir: join(root, "identities"),
  roomsDir: join(root, "rooms"),
  runsDir: join(root, "runs"),
  dbPath: join(root, "data", "group-chat.db"),
};

export function ensureBaseDirs() {
  mkdirSync(appPaths.dataDir, { recursive: true });
  mkdirSync(appPaths.identitiesDir, { recursive: true });
  mkdirSync(appPaths.roomsDir, { recursive: true });
  mkdirSync(appPaths.runsDir, { recursive: true });
}

export function roomArtifactRoot(roomId: string) {
  return join(appPaths.roomsDir, roomId);
}

export function identityWorkspaceRoot(identityId: string) {
  return join(appPaths.identitiesDir, safePathSegment(identityId));
}

export function participantWorkspaceRoot(roomId: string, participantId: string) {
  return join(roomArtifactRoot(roomId), "agents", safePathSegment(participantId));
}

export function ensureRoomDirs(roomId: string) {
  const rootDir = roomArtifactRoot(roomId);
  mkdirSync(join(rootDir, "agents"), { recursive: true });
  mkdirSync(join(rootDir, "uploads"), { recursive: true });
  mkdirSync(join(rootDir, "artifacts"), { recursive: true });
  mkdirSync(join(rootDir, "previews"), { recursive: true });
  return rootDir;
}

function safePathSegment(value: string) {
  return value.replace(/[^\w.-]/g, "_") || "unknown";
}
