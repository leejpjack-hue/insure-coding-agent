import { ToolDefinition, ToolParam, SafetyLevel } from './types.js';

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" already registered`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  listBySafetyLevel(level: SafetyLevel): ToolDefinition[] {
    return this.list().filter(t => t.safetyLevel === level);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  validateParams(name: string, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(name);
    if (!tool) {
      return { valid: false, errors: [`Tool "${name}" not found`] };
    }

    const errors: string[] = [];
    const paramDefs = tool.definition.params;
    const requiredParams = paramDefs.filter(p => p.required);

    for (const paramDef of requiredParams) {
      if (params[paramDef.name] === undefined || params[paramDef.name] === null) {
        errors.push(`Missing required param: ${paramDef.name}`);
      }
    }

    for (const [key, value] of Object.entries(params)) {
      const paramDef = paramDefs.find(p => p.name === key);
      if (!paramDef) {
        errors.push(`Unknown param: ${key}`);
        continue;
      }
      if (!checkType(value, paramDef.type)) {
        errors.push(`Param "${key}" must be of type ${paramDef.type}, got ${typeof value}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  getDefinitionsText(): string {
    const lines: string[] = [];
    for (const tool of this.tools.values()) {
      lines.push(`- ${tool.definition.name}: ${tool.definition.description}`);
      for (const p of tool.definition.params) {
        lines.push(`    ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`);
      }
    }
    return lines.join('\n');
  }
}

function checkType(value: unknown, expectedType: string): boolean {
  if (value === null || value === undefined) return true; // handled by required check
  switch (expectedType) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'object': return typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    default: return true;
  }
}
