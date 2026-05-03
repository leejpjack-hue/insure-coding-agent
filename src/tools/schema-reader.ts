import fs from 'fs';
import path from 'path';
import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel } from '../core/types.js';

export function createSchemaReader(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'schema_reader',
      description: 'Read database schema - list tables, describe table structure, find relations, sample data',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'action', type: 'string', required: true, description: 'list_tables | describe_table | list_relations | sample_data' },
        { name: 'tableName', type: 'string', required: false, description: 'Table name (for describe_table, sample_data)' },
        { name: 'dbPath', type: 'string', required: false, description: 'Path to JSON database file' },
        { name: 'limit', type: 'number', required: false, description: 'Row limit for sample_data (default 5)' },
      ],
    },
    execute: async (params) => {
      const action = String(params.action);
      const dbPath = String(params.dbPath || './data/insure-agent.json');
      const filePath = dbPath.replace(/\.db$/i, '.json');

      let data: Record<string, unknown>;
      try {
        const resolved = path.resolve(filePath);
        data = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      } catch {
        return `Cannot open database: ${filePath}`;
      }

      // Map JSON keys to table-like structure
      const tables: Record<string, string> = {
        agents: 'id, name, level, team_id, manager_id, status, joined_at, created_at',
        licenses: 'id, agent_id, license_number, jurisdiction, status, authorized_products, issued_at, expires_at, ce_hours, required_ce_hours, created_at',
        commissionTiers: 'id, name, product_type, agent_level, min_premium, max_premium, rate, policy_year, is_renewal, effective_from, effective_to, created_at',
        policies: 'id, policy_number, agent_id, product_type, premium_amount, status, issued_at, expires_at, created_at',
        commissions: 'id, policy_id, agent_id, amount, rate, tier_name, calculation_date, status, created_at',
        auditTrail: 'id, session_id, action, entity_type, entity_id, details, timestamp, user_id',
      };

      if (action === 'list_tables') {
        const names = Object.keys(tables);
        return `Tables (${names.length}):\n${names.map(t => `  - ${t}`).join('\n')}`;
      }

      if (action === 'describe_table') {
        const tableName = String(params.tableName || '');
        if (!tableName) return 'Missing tableName parameter';
        const cols = tables[tableName];
        if (!cols) return `Table "${tableName}" not found`;
        return cols.split(', ').map(c => `  ${c} TEXT`).join('\n');
      }

      if (action === 'list_relations') {
        return `Relations:\n  licenses.agent_id -> agents.id\n  policies.agent_id -> agents.id\n  commissions.policy_id -> policies.id\n  commissions.agent_id -> agents.id`;
      }

      if (action === 'sample_data') {
        const tableName = String(params.tableName || '');
        const limit = Number(params.limit) || 5;
        if (!tableName) return 'Missing tableName parameter';
        const rows = data[tableName];
        if (!rows) return `Table "${tableName}" not found`;
        if (Array.isArray(rows)) {
          return JSON.stringify(rows.slice(0, limit), null, 2);
        }
        // Object-format (keyed by id)
        const entries = Object.values(rows as Record<string, unknown>).slice(0, limit);
        return entries.length > 0
          ? JSON.stringify(entries, null, 2)
          : `Table "${tableName}" is empty`;
      }

      return `Unknown action: ${action}`;
    },
  });
}
