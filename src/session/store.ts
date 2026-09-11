import { readFile } from 'node:fs/promises';
import { paths } from '../config/paths';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';

export interface SessionEntry {
  /** May be absent if the entry was created by /timeout before any run
   * recorded a session id. Treat absence as "no resumable session". */
  sessionId?: string;
  /** Pinned cwd for the resumable session. Absent for the same reason. */
  cwd?: string;
  updatedAt: number;
  /** Per-scope idle-timeout override (minutes). 0 = explicitly off for this
   * scope, undefined = follow global default. Session resets preserve this
   * scope preference while removing the resumable session id/cwd. */
  idleTimeoutMinutes?: number;
  /** Message IDs already injected as inherited Feishu context for this scope. */
  contextMessageIds?: {
    chat?: string[];
    topic?: string[];
  };
}

type SessionMap = Record<string, SessionEntry>;

const MAX_CONTEXT_MESSAGE_IDS = 400;

function normalizeContextMessageIds(
  input: SessionEntry['contextMessageIds'],
): SessionEntry['contextMessageIds'] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const normalize = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
          .slice(-MAX_CONTEXT_MESSAGE_IDS)
      : [];
  const chat = normalize(input.chat);
  const topic = normalize(input.topic);
  if (chat.length === 0 && topic.length === 0) return undefined;
  return {
    ...(chat.length > 0 ? { chat } : {}),
    ...(topic.length > 0 ? { topic } : {}),
  };
}

export class SessionStore {
  private data: SessionMap = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = paths.sessionsFile) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const raw = JSON.parse(text) as Record<string, Partial<SessionEntry>>;
      this.data = {};
      for (const [chatId, entry] of Object.entries(raw)) {
        if (!entry || typeof entry.updatedAt !== 'number') continue;
        // Drop entries without a `cwd`/`sessionId` pair *unless* there's
        // some other persisted state worth keeping (e.g. an idle-timeout
        // override). Resuming a session whose cwd we don't know about
        // would hang claude on a missing jsonl, so resume keys still need
        // the full pair; but a bare timeout override is fine on its own.
        const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : undefined;
        const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined;
        const idleTimeoutMinutes =
          typeof entry.idleTimeoutMinutes === 'number' ? entry.idleTimeoutMinutes : undefined;
        const contextMessageIds = normalizeContextMessageIds(entry.contextMessageIds);
        const hasSession = sessionId !== undefined && cwd !== undefined;
        if (!hasSession && idleTimeoutMinutes === undefined && !contextMessageIds) continue;
        this.data[chatId] = {
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
          updatedAt: entry.updatedAt,
          ...(idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes } : {}),
          ...(contextMessageIds ? { contextMessageIds } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Return the session id for this chat if it was created in the given cwd.
   * Sessions recorded in a different cwd are stale — claude can't resume
   * them from a different working directory.
   */
  resumeFor(chatId: string, cwd: string): string | undefined {
    const entry = this.data[chatId];
    if (!entry) return undefined;
    if (entry.cwd !== cwd) return undefined;
    return entry.sessionId;
  }

  getRaw(chatId: string): SessionEntry | undefined {
    return this.data[chatId];
  }
  seenContextMessageIds(scopeId: string, layer: 'chat' | 'topic'): ReadonlySet<string> {
    return new Set(this.data[scopeId]?.contextMessageIds?.[layer] ?? []);
  }

  markContextMessagesSeen(
    scopeId: string,
    input: { chat?: Iterable<string>; topic?: Iterable<string> },
  ): void {
    const prev = this.data[scopeId];
    const merge = (layer: 'chat' | 'topic', next: Iterable<string> | undefined): string[] => [
      ...(prev?.contextMessageIds?.[layer] ?? []),
      ...(next ?? []),
    ];
    const contextMessageIds = normalizeContextMessageIds({
      chat: merge('chat', input.chat),
      topic: merge('topic', input.topic),
    });
    if (!contextMessageIds) return;
    this.data[scopeId] = {
      ...(prev ?? {}),
      updatedAt: Date.now(),
      contextMessageIds,
    };
    this.schedulePersist();
  }


  set(chatId: string, sessionId: string, cwd: string): void {
    // Preserve per-scope preferences and context cursors across run starts.
    // /new (clear) intentionally wipes the inherited-context cursor.
    const prev = this.data[chatId];
    this.data[chatId] = {
      sessionId,
      cwd,
      updatedAt: Date.now(),
      ...(prev?.idleTimeoutMinutes !== undefined
        ? { idleTimeoutMinutes: prev.idleTimeoutMinutes }
        : {}),
      ...(prev?.contextMessageIds
        ? { contextMessageIds: prev.contextMessageIds }
        : {}),
    };
    this.schedulePersist();
  }

  clear(chatId: string): void {
    const prev = this.data[chatId];
    if (!prev) return;
    if (prev.idleTimeoutMinutes !== undefined) {
      this.data[chatId] = {
        idleTimeoutMinutes: prev.idleTimeoutMinutes,
        updatedAt: Date.now(),
      };
    } else {
      delete this.data[chatId];
    }
    this.schedulePersist();
  }

  /** Per-scope idle-timeout override. `undefined` means no override set. */
  getIdleTimeoutMinutes(chatId: string): number | undefined {
    return this.data[chatId]?.idleTimeoutMinutes;
  }

  setIdleTimeoutMinutes(chatId: string, minutes: number): void {
    const clamped = Math.min(Math.max(Math.floor(minutes), 0), 120);
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? { updatedAt: Date.now() }),
      idleTimeoutMinutes: clamped,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  /** Remove the override so this scope falls back to the global default.
   * Returns true if something was actually removed. */
  clearIdleTimeoutOverride(chatId: string): boolean {
    const prev = this.data[chatId];
    if (!prev || prev.idleTimeoutMinutes === undefined) return false;
    const { idleTimeoutMinutes: _, ...rest } = prev;
    this.data[chatId] = { ...rest, updatedAt: Date.now() };
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((err: unknown) => {
        log.fail('session', err, { step: 'persist' });
      });
  }
}
