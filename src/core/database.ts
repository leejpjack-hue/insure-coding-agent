import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export function initDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // AMS Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'bronze',
      team_id TEXT,
      manager_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      license_number TEXT NOT NULL UNIQUE,
      jurisdiction TEXT NOT NULL DEFAULT 'HK',
      status TEXT NOT NULL DEFAULT 'active',
      authorized_products TEXT NOT NULL DEFAULT '[]',
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ce_hours REAL NOT NULL DEFAULT 0,
      required_ce_hours REAL NOT NULL DEFAULT 10,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS commission_tiers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      product_type TEXT NOT NULL,
      agent_level TEXT NOT NULL,
      min_premium REAL NOT NULL DEFAULT 0,
      max_premium REAL NOT NULL DEFAULT 999999999,
      rate REAL NOT NULL,
      policy_year INTEGER NOT NULL DEFAULT 1,
      is_renewal INTEGER NOT NULL DEFAULT 0,
      effective_from INTEGER NOT NULL,
      effective_to INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      policy_number TEXT NOT NULL UNIQUE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      product_type TEXT NOT NULL,
      premium_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS commissions (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      amount REAL NOT NULL,
      rate REAL NOT NULL,
      tier_name TEXT,
      calculation_date INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_trail (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      user_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_licenses_agent ON licenses(agent_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expires_at);
    CREATE INDEX IF NOT EXISTS idx_policies_agent ON policies(agent_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_policy ON commissions(policy_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_agent ON commissions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
  `);

  // Seed sample data
  seedSampleData(db);

  return db;
}

function seedSampleData(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM agents').get() as any).c;
  if (count > 0) return;

  const now = Date.now();

  // Sample agents
  const agents = [
    { id: 'AGT001', name: 'Chan Tai Man', level: 'gold', status: 'active' },
    { id: 'AGT002', name: 'Wong Siu Ming', level: 'silver', status: 'active' },
    { id: 'AGT003', name: 'Lee Ka Fai', level: 'bronze', status: 'active' },
    { id: 'AGT004', name: 'Ng Mei Ling', level: 'platinum', status: 'active' },
    { id: 'AGT005', name: 'Cheung Wing Yan', level: 'unit_manager', status: 'active' },
  ];

  const insertAgent = db.prepare('INSERT INTO agents (id, name, level, status, joined_at) VALUES (?, ?, ?, ?, ?)');
  for (const a of agents) {
    insertAgent.run(a.id, a.name, a.level, a.status, now - 365 * 24 * 60 * 60 * 1000);
  }

  // Sample commission tiers
  const tiers = [
    { id: 'tier_life_bronze', name: 'Life Bronze', product: 'life', level: 'bronze', rate: 0.40 },
    { id: 'tier_life_silver', name: 'Life Silver', product: 'life', level: 'silver', rate: 0.45 },
    { id: 'tier_life_gold', name: 'Life Gold', product: 'life', level: 'gold', rate: 0.50 },
    { id: 'tier_life_plat', name: 'Life Platinum', product: 'life', level: 'platinum', rate: 0.55 },
    { id: 'tier_health_bronze', name: 'Health Bronze', product: 'health', level: 'bronze', rate: 0.25 },
    { id: 'tier_health_silver', name: 'Health Silver', product: 'health', level: 'silver', rate: 0.30 },
    { id: 'tier_motor_bronze', name: 'Motor Bronze', product: 'motor', level: 'bronze', rate: 0.15 },
    { id: 'tier_travel_bronze', name: 'Travel Bronze', product: 'travel', level: 'bronze', rate: 0.20 },
    { id: 'tier_override_um', name: 'UM Override', product: 'life', level: 'unit_manager', rate: 0.05 },
  ];

  const insertTier = db.prepare('INSERT INTO commission_tiers (id, name, product_type, agent_level, rate, effective_from) VALUES (?, ?, ?, ?, ?, ?)');
  for (const t of tiers) {
    insertTier.run(t.id, t.name, t.product, t.level, t.rate, now);
  }
}
