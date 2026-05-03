import path from 'path';
import fs from 'fs';
import { Session, Message, AgentState, ModelConfig } from './types.js';

interface SessionStore {
  sessions: Record<string, Session & { modelConfigJson: string; stateJson: string }>;
  messages: Record<string, Message[]>;
}

export class SessionManager {
  private filePath: string;
  private store: SessionStore;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dbPath: string) {
    // dbPath used to be ./data/insure-agent.db — change extension to .json
    this.filePath = dbPath.replace(/\.db$/i, '.json');
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.store = this.load();
  }

  private load(): SessionStore {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw) as SessionStore;
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { sessions: {}, messages: {} };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.dirty = true;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, 500);
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Best effort
    }
  }

  createSession(projectRoot: string, modelConfig: ModelConfig): Session {
    const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();

    const state: AgentState = {
      sessionId: id,
      status: 'idle',
      currentIteration: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      filesModified: [],
      testsRun: 0,
      testsPassed: 0,
      startedAt: now,
      updatedAt: now,
    };

    const session: Session = {
      id,
      projectRoot,
      status: 'active',
      modelConfig,
      state,
      createdAt: now,
      updatedAt: now,
    };

    this.store.sessions[id] = {
      ...session,
      modelConfigJson: JSON.stringify(modelConfig),
      stateJson: JSON.stringify(state),
    };
    this.store.messages[id] = [];
    this.scheduleFlush();

    return session;
  }

  getSession(id: string): Session | null {
    const row = this.store.sessions[id];
    if (!row) return null;

    return {
      id: row.id,
      projectRoot: row.projectRoot,
      status: row.status,
      modelConfig: JSON.parse(row.modelConfigJson),
      state: JSON.parse(row.stateJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'state'>>): boolean {
    const row = this.store.sessions[id];
    if (!row) return false;

    if (updates.status) row.status = updates.status;
    if (updates.state) {
      row.stateJson = JSON.stringify(updates.state);
      row.state = updates.state;
    }
    row.updatedAt = Date.now();
    this.scheduleFlush();
    return true;
  }

  pauseSession(id: string): boolean {
    return this.updateSession(id, { status: 'paused' });
  }

  resumeSession(id: string): boolean {
    return this.updateSession(id, { status: 'active' });
  }

  forkSession(id: string): Session | null {
    const session = this.getSession(id);
    if (!session) return null;
    return this.createSession(session.projectRoot, session.modelConfig);
  }

  addMessage(message: Omit<Message, 'id'>): Message {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const msg: Message = {
      id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      toolCall: message.toolCall,
      toolResult: message.toolResult,
      timestamp: message.timestamp,
      checkpointId: message.checkpointId,
    };

    if (!this.store.messages[message.sessionId]) {
      this.store.messages[message.sessionId] = [];
    }
    this.store.messages[message.sessionId].push(msg);

    // Update session updatedAt
    const row = this.store.sessions[message.sessionId];
    if (row) row.updatedAt = Date.now();

    this.scheduleFlush();
    return msg;
  }

  getHistory(sessionId: string, limit: number = 100): Message[] {
    const msgs = this.store.messages[sessionId] || [];
    return msgs.slice(-limit);
  }

  listSessions(status?: string): Session[] {
    const sessions = Object.values(this.store.sessions)
      .filter(s => !status || s.status === status)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return sessions.map(row => ({
      id: row.id,
      projectRoot: row.projectRoot,
      status: row.status,
      modelConfig: JSON.parse(row.modelConfigJson),
      state: JSON.parse(row.stateJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  deleteSession(id: string): boolean {
    if (!this.store.sessions[id]) return false;
    delete this.store.sessions[id];
    delete this.store.messages[id];
    this.scheduleFlush();
    return true;
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}
