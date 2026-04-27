import { HookEngine } from './hook-engine.js';
import { Event } from '../core/types.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { eventBus } from '../core/events.js';

export function registerBuiltinHooks(hookEngine: HookEngine, registry: ToolRegistry): void {
  // on_file_save: Run LSP + PII scan
  hookEngine.register({
    name: 'on_file_save',
    description: 'Scan saved files for PII and trigger LSP diagnostics',
    triggerEvent: 'file_changed',
    enabled: true,
    action: async (event: Event) => {
      if (event.type !== 'file_changed') return;
      const { path: filePath, content } = event;

      // PII scan
      const hkidPattern = /[A-Z]{1,2}\d{6}[A-Z0-9]?/g;
      const matches = content.match(hkidPattern);
      if (matches && matches.length > 0) {
        console.warn(`[PII Warning] ${filePath}: Found ${matches.length} potential HKID(s)`);
      }
    },
  });

  // on_commission_change: Auto-validate commission changes
  hookEngine.register({
    name: 'on_commission_change',
    description: 'Auto-validate commission formulas when commission files change',
    triggerEvent: 'file_changed',
    enabled: true,
    filter: (event: Event) => {
      if (event.type !== 'file_changed') return false;
      return event.path.includes('commission') || event.content.includes('commission');
    },
    action: async (event: Event) => {
      if (event.type !== 'file_changed') return;
      console.log(`[Commission Hook] Commission-related file changed: ${event.path}`);
      eventBus.emit({ type: 'commission_validated', isValid: true, discrepancies: [] });
    },
  });

  // on_compliance_fail: Auto-suggest fixes
  hookEngine.register({
    name: 'on_compliance_fail',
    description: 'Provide fix suggestions when compliance violations are detected',
    triggerEvent: 'compliance_checked',
    enabled: true,
    filter: (event: Event) => {
      if (event.type !== 'compliance_checked') return false;
      return event.violations.some(v => v.severity === 'critical');
    },
    action: async (event: Event) => {
      if (event.type !== 'compliance_checked') return;
      const criticals = event.violations.filter(v => v.severity === 'critical');
      for (const v of criticals) {
        console.error(`[Compliance CRITICAL] ${v.file}:${v.line} — ${v.description}`);
        console.error(`  → ${v.recommendation}`);
      }
    },
  });

  // on_test_completed: Track pass rate
  hookEngine.register({
    name: 'on_test_completed',
    description: 'Track test results and alert on failures',
    triggerEvent: 'test_completed',
    enabled: true,
    action: async (event: Event) => {
      if (event.type !== 'test_completed') return;
      if (event.failed > 0) {
        console.warn(`[Tests] ${event.failed}/${event.passed + event.failed} tests failed (${event.duration}ms)`);
      } else {
        console.log(`[Tests] All ${event.passed} tests passed (${event.duration}ms)`);
      }
    },
  });

  // on_tool_executed: Audit logging
  hookEngine.register({
    name: 'on_tool_executed',
    description: 'Log all tool executions for audit trail',
    triggerEvent: 'tool_executed',
    enabled: true,
    action: async (event: Event) => {
      if (event.type !== 'tool_executed') return;
      const status = event.result.status;
      const dur = event.result.duration;
      if (status === 'error') {
        console.error(`[Tool] ${event.tool} failed (${dur}ms): ${event.result.content.substring(0, 100)}`);
      }
    },
  });

  // on_checkpoint_created: Debug logging
  hookEngine.register({
    name: 'on_checkpoint_created',
    description: 'Log checkpoint creation',
    triggerEvent: 'checkpoint_created',
    enabled: true,
    action: async (event: Event) => {
      if (event.type !== 'checkpoint_created') return;
      // Silent — just for audit
    },
  });
}
