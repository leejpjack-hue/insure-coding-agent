import { Session, Message, ModelConfig } from './types.js';
export declare class SessionManager {
    private db;
    constructor(dbPath: string);
    private initTables;
    createSession(projectRoot: string, modelConfig: ModelConfig): Session;
    getSession(id: string): Session | null;
    updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'state'>>): boolean;
    pauseSession(id: string): boolean;
    resumeSession(id: string): boolean;
    forkSession(id: string): Session | null;
    addMessage(message: Omit<Message, 'id'>): Message;
    getHistory(sessionId: string, limit?: number): Message[];
    listSessions(status?: string): Session[];
    deleteSession(id: string): boolean;
    close(): void;
}
