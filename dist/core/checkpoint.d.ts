import { Checkpoint } from './types.js';
export declare class CheckpointManager {
    private checkpoints;
    private maxPerSession;
    constructor(maxPerSession?: number);
    createCheckpoint(sessionId: string, iteration: number, filePaths: string[], projectRoot: string, description?: string): Checkpoint;
    restoreCheckpoint(checkpointId: string, sessionId: string, projectRoot: string): boolean;
    undo(sessionId: string, projectRoot: string): Checkpoint | null;
    listCheckpoints(sessionId: string): Checkpoint[];
    getLatest(sessionId: string): Checkpoint | null;
    clearSession(sessionId: string): void;
}
