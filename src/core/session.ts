import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Session, Message, AgentState, ModelConfig } from './types.js';

export class SessionManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        model_config TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call TEXT,
        tool_result TEXT,
        timestamp INTEGER NOT NULL,
        checkpoint_id TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS audit_trail (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        timestamp INTEGER NOT NULL,
        user_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_trail(session_id, timestamp);
    `);
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

    this.db.prepare(
      'INSERT INTO sessions (id, project_root, status, model_config, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectRoot, 'active', JSON.stringify(modelConfig), JSON.stringify(state), now, now);

    return session;
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      projectRoot: row.project_root,
      status: row.status,
      modelConfig: JSON.parse(row.model_config),
      state: JSON.parse(row.state),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'state'>>): boolean {
    const session = this.getSession(id);
    if (!session) return false;

    const status = updates.status || session.status;
    const state = updates.state || session.state;

    this.db.prepare(
      'UPDATE sessions SET status = ?, state = ?, updated_at = ? WHERE id = ?'
    ).run(status, JSON.stringify(state), Date.now(), id);

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

    const forked = this.createSession(session.projectRoot, session.modelConfig);
    return forked;
  }

  addMessage(message: Omit<Message, 'id'>): Message {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const msg: Message = { id, ...message };

    this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, tool_call, tool_result, timestamp, checkpoint_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      message.sessionId,
      message.role,
      message.content,
      message.toolCall ? JSON.stringify(message.toolCall) : null,
      message.toolResult ? JSON.stringify(message.toolResult) : null,
      message.timestamp,
      message.checkpointId || null
    );

    // Update session updatedAt
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), message.sessionId);

    return msg;
  }

  getHistory(sessionId: string, limit: number = 100): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(sessionId, limit) as any[];

    return rows.reverse().map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolCall: row.tool_call ? JSON.parse(row.tool_call) : undefined,
      toolResult: row.tool_result ? JSON.parse(row.tool_result) : undefined,
      timestamp: row.timestamp,
      checkpointId: row.checkpoint_id || undefined,
    }));
  }

  listSessions(status?: string): Session[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC').all(status) as any[]
      : this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[];

    return rows.map(row => ({
      id: row.id,
      projectRoot: row.project_root,
      status: row.status,
      modelConfig: JSON.parse(row.model_config),
      state: JSON.parse(row.state),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  deleteSession(id: string): boolean {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM audit_trail WHERE session_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
