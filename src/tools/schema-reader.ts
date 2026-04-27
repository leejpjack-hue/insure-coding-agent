import Database from 'better-sqlite3';
import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel } from '../core/types.js';

export function createSchemaReader(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'schema_reader',
      description: 'Read database schema - list tables, describe table, find relations',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'action', type: 'string', required: true, description: 'list_tables | describe_table | list_relations | sample_data' },
        { name: 'tableName', type: 'string', required: false, description: 'Table name (for describe_table, sample_data)' },
        { name: 'dbPath', type: 'string', required: false, description: 'Path to SQLite database' },
        { name: 'limit', type: 'number', required: false, description: 'Row limit for sample_data (default 5)' },
      ],
    },
    execute: async (params) => {
      const action = String(params.action);
      const dbPath = String(params.dbPath || './data/insure-agent.db');

      let db: Database.Database;
      try {
        db = new Database(dbPath, { readonly: true });
      } catch {
        return `Cannot open database: ${dbPath}`;
      }

      try {
        if (action === 'list_tables') {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
          return tables.length > 0
            ? `Tables (${tables.length}):\n${tables.map(t => `  - ${t.name}`).join('\n')}`
            : 'No tables found';
        }

        if (action === 'describe_table') {
          const tableName = String(params.tableName || '');
          if (!tableName) return 'Missing tableName parameter';
          const columns = db.pragma(`table_info("${tableName}")`) as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
          if (columns.length === 0) return `Table "${tableName}" not found`;
          return columns.map(c =>
            `  ${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PRIMARY KEY' : ''}${c.dflt_value ? ` DEFAULT ${c.dflt_value}` : ''}`
          ).join('\n');
        }

        if (action === 'list_relations') {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
          const relations: string[] = [];
          for (const { name } of tables) {
            const fks = db.pragma(`foreign_key_list("${name}")`) as Array<{ table: string; from: string; to: string }>;
            for (const fk of fks) {
              relations.push(`  ${name}.${fk.from} → ${fk.table}.${fk.to}`);
            }
          }
          return relations.length > 0
            ? `Relations:\n${relations.join('\n')}`
            : 'No foreign key relations found';
        }

        if (action === 'sample_data') {
          const tableName = String(params.tableName || '');
          const limit = Number(params.limit) || 5;
          if (!tableName) return 'Missing tableName parameter';
          const rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ?`).all(limit) as Record<string, unknown>[];
          return rows.length > 0
            ? JSON.stringify(rows, null, 2)
            : `Table "${tableName}" is empty or not found`;
        }

        return `Unknown action: ${action}`;
      } finally {
        db.close();
      }
    },
  });
}
