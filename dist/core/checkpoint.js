import fs from 'fs';
import path from 'path';
import { eventBus } from './events.js';
const MAX_CHECKPOINTS = 50;
export class CheckpointManager {
    checkpoints = new Map();
    maxPerSession;
    constructor(maxPerSession = MAX_CHECKPOINTS) {
        this.maxPerSession = maxPerSession;
    }
    createCheckpoint(sessionId, iteration, filePaths, projectRoot, description = '') {
        const fileSnapshots = {};
        for (const filePath of filePaths) {
            const fullPath = path.join(projectRoot, filePath);
            try {
                fileSnapshots[filePath] = fs.readFileSync(fullPath, 'utf-8');
            }
            catch {
                // File might not exist yet, skip
            }
        }
        const checkpoint = {
            id: `cp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            sessionId,
            iteration,
            description,
            fileSnapshots,
            createdAt: Date.now(),
        };
        if (!this.checkpoints.has(sessionId)) {
            this.checkpoints.set(sessionId, []);
        }
        const sessionCheckpoints = this.checkpoints.get(sessionId);
        sessionCheckpoints.push(checkpoint);
        // Auto-cleanup oldest if exceeded
        while (sessionCheckpoints.length > this.maxPerSession) {
            sessionCheckpoints.shift();
        }
        eventBus.emit({ type: 'checkpoint_created', id: checkpoint.id, sessionId });
        return checkpoint;
    }
    restoreCheckpoint(checkpointId, sessionId, projectRoot) {
        const checkpoints = this.checkpoints.get(sessionId);
        if (!checkpoints)
            return false;
        const checkpoint = checkpoints.find(cp => cp.id === checkpointId);
        if (!checkpoint)
            return false;
        for (const [filePath, content] of Object.entries(checkpoint.fileSnapshots)) {
            const fullPath = path.join(projectRoot, filePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
        return true;
    }
    undo(sessionId, projectRoot) {
        const checkpoints = this.checkpoints.get(sessionId);
        if (!checkpoints || checkpoints.length === 0)
            return null;
        const lastCheckpoint = checkpoints[checkpoints.length - 1];
        this.restoreCheckpoint(lastCheckpoint.id, sessionId, projectRoot);
        checkpoints.pop();
        return lastCheckpoint;
    }
    listCheckpoints(sessionId) {
        return this.checkpoints.get(sessionId) || [];
    }
    getLatest(sessionId) {
        const checkpoints = this.checkpoints.get(sessionId);
        if (!checkpoints || checkpoints.length === 0)
            return null;
        return checkpoints[checkpoints.length - 1];
    }
    clearSession(sessionId) {
        this.checkpoints.delete(sessionId);
    }
}
