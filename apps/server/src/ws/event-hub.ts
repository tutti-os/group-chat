import { nanoid } from "nanoid";
import type { StreamEvent, StreamEventType, WsServerMessage } from "@group-chat/shared";
import { getDb, json, parseJson } from "../db/database.js";

type WsLike = {
  readyState: number;
  send(data: string): void;
};

type ClientEntry = {
  socket: WsLike;
  shouldSend?: (event: StreamEvent) => boolean;
};

const OPEN = 1;

export class EventHub {
  private clients = new Set<ClientEntry>();

  addClient(client: WsLike, options: { shouldSend?: (event: StreamEvent) => boolean } = {}) {
    const entry: ClientEntry = { socket: client, shouldSend: options.shouldSend };
    this.clients.add(entry);
    return () => this.clients.delete(entry);
  }

  emit<TPayload>(input: {
    type: StreamEventType;
    roomId?: string | null;
    conversationId?: string | null;
    runId?: string | null;
    payload: TPayload;
  }): StreamEvent<TPayload> {
    const db = getDb();
    const id = nanoid();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO stream_events (id, type, room_id, conversation_id, run_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.type,
      input.roomId ?? null,
      input.conversationId ?? null,
      input.runId ?? null,
      json(input.payload),
      createdAt,
    );
    const row = db.prepare(`SELECT * FROM stream_events WHERE id = ?`).get(id) as any;
    const event = rowToEvent<TPayload>(row);
    this.broadcast({ type: "event", event, lastSeq: event.seq });
    return event;
  }

  replaySince(lastSeq: number): StreamEvent[] {
    const rows = getDb()
      .prepare(`SELECT * FROM stream_events WHERE seq > ? ORDER BY seq ASC LIMIT 500`)
      .all(lastSeq) as any[];
    return rows.map((row) => rowToEvent(row));
  }

  lastSeq(): number {
    const row = getDb().prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM stream_events`).get() as {
      seq: number;
    };
    return row.seq;
  }

  private broadcast(message: WsServerMessage) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.socket.readyState !== OPEN) continue;
      if (message.type === "event" && message.event && client.shouldSend && !client.shouldSend(message.event)) {
        continue;
      }
      client.socket.send(data);
    }
  }
}

function rowToEvent<TPayload = unknown>(row: any): StreamEvent<TPayload> {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    roomId: row.room_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    payload: parseJson<TPayload>(row.payload, null as TPayload),
    createdAt: row.created_at,
  };
}
