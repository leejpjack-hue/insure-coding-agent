import { Event } from './types.js';

type EventHandler<T extends Event> = (event: T) => void | Promise<void>;

// Typed Event Bus
export class EventBus {
  private handlers: Map<string, Set<Function>> = new Map();
  private onceHandlers: Map<string, Set<Function>> = new Map();

  on<T extends Event>(eventType: T['type'], handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as Function);
    return () => this.off(eventType, handler);
  }

  once<T extends Event>(eventType: T['type'], handler: EventHandler<T>): () => void {
    if (!this.onceHandlers.has(eventType)) {
      this.onceHandlers.set(eventType, new Set());
    }
    this.onceHandlers.get(eventType)!.add(handler as Function);
    return () => {
      this.onceHandlers.get(eventType)?.delete(handler as Function);
    };
  }

  off<T extends Event>(eventType: T['type'], handler: EventHandler<T>): void {
    this.handlers.get(eventType)?.delete(handler as Function);
    this.onceHandlers.get(eventType)?.delete(handler as Function);
  }

  emit<T extends Event>(event: T): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch(err => console.error(`EventBus handler error for ${event.type}:`, err));
          }
        } catch (err) {
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
        } catch (err) {
          console.error(`EventBus once handler error for ${event.type}:`, err);
        }
      }
    }
  }

  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.handlers.delete(eventType);
      this.onceHandlers.delete(eventType);
    } else {
      this.handlers.clear();
      this.onceHandlers.clear();
    }
  }

  listenerCount(eventType: string): number {
    return (this.handlers.get(eventType)?.size || 0) + (this.onceHandlers.get(eventType)?.size || 0);
  }
}

// Singleton instance
export const eventBus = new EventBus();
