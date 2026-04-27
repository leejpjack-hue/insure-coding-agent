// Typed Event Bus
export class EventBus {
    handlers = new Map();
    onceHandlers = new Map();
    on(eventType, handler) {
        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, new Set());
        }
        this.handlers.get(eventType).add(handler);
        return () => this.off(eventType, handler);
    }
    once(eventType, handler) {
        if (!this.onceHandlers.has(eventType)) {
            this.onceHandlers.set(eventType, new Set());
        }
        this.onceHandlers.get(eventType).add(handler);
        return () => {
            this.onceHandlers.get(eventType)?.delete(handler);
        };
    }
    off(eventType, handler) {
        this.handlers.get(eventType)?.delete(handler);
        this.onceHandlers.get(eventType)?.delete(handler);
    }
    emit(event) {
        const handlers = this.handlers.get(event.type);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    const result = handler(event);
                    if (result instanceof Promise) {
                        result.catch(err => console.error(`EventBus handler error for ${event.type}:`, err));
                    }
                }
                catch (err) {
                    console.error(`EventBus handler error for ${event.type}:`, err);
                }
            }
        }
        const onceHandlers = this.onceHandlers.get(event.type);
        if (onceHandlers) {
            this.onceHandlers.delete(event.type);
            for (const handler of onceHandlers) {
                try {
                    const result = handler(event);
                    if (result instanceof Promise) {
                        result.catch(err => console.error(`EventBus once handler error for ${event.type}:`, err));
                    }
                }
                catch (err) {
                    console.error(`EventBus once handler error for ${event.type}:`, err);
                }
            }
        }
    }
    removeAllListeners(eventType) {
        if (eventType) {
            this.handlers.delete(eventType);
            this.onceHandlers.delete(eventType);
        }
        else {
            this.handlers.clear();
            this.onceHandlers.clear();
        }
    }
    listenerCount(eventType) {
        return (this.handlers.get(eventType)?.size || 0) + (this.onceHandlers.get(eventType)?.size || 0);
    }
}
// Singleton instance
export const eventBus = new EventBus();
