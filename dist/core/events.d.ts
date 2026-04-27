import { Event } from './types.js';
type EventHandler<T extends Event> = (event: T) => void | Promise<void>;
export declare class EventBus {
    private handlers;
    private onceHandlers;
    on<T extends Event>(eventType: T['type'], handler: EventHandler<T>): () => void;
    once<T extends Event>(eventType: T['type'], handler: EventHandler<T>): () => void;
    off<T extends Event>(eventType: T['type'], handler: EventHandler<T>): void;
    emit<T extends Event>(event: T): void;
    removeAllListeners(eventType?: string): void;
    listenerCount(eventType: string): number;
}
export declare const eventBus: EventBus;
export {};
