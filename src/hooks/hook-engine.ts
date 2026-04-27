import { Event } from '../core/types.js';
import { eventBus } from '../core/events.js';

export interface Hook {
  name: string;
  description: string;
  triggerEvent: Event['type'];
  filter?: (event: Event) => boolean;
  action: (event: Event) => Promise<void>;
  enabled: boolean;
}

export class HookEngine {
  private hooks: Map<string, Hook> = new Map();

  register(hook: Hook): () => void {
    this.hooks.set(hook.name, hook);

    const unsubscribe = eventBus.on(hook.triggerEvent, async (event: Event) => {
      if (!hook.enabled) return;
      if (hook.filter && !hook.filter(event)) return;
      try {
        await hook.action(event);
        eventBus.emit({ type: 'hook_triggered', hookName: hook.name, triggerEvent: hook.triggerEvent });
      } catch (err) {
        console.error(`Hook "${hook.name}" error:`, err);
      }
    });

    return unsubscribe;
  }

  unregister(name: string): boolean {
    return this.hooks.delete(name);
  }

  enable(name: string): void {
    const hook = this.hooks.get(name);
    if (hook) hook.enabled = true;
  }

  disable(name: string): void {
    const hook = this.hooks.get(name);
    if (hook) hook.enabled = false;
  }

  list(): Array<{ name: string; trigger: string; enabled: boolean; description: string }> {
    return Array.from(this.hooks.values()).map(h => ({
      name: h.name,
      trigger: h.triggerEvent,
      enabled: h.enabled,
      description: h.description,
    }));
  }

  get(name: string): Hook | undefined {
    return this.hooks.get(name);
  }
}
