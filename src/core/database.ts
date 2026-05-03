import path from 'path';
import fs from 'fs';

export interface JsonDatabase {
  agents: Record<string, any>;
  licenses: Record<string, any>;
  commissionTiers: Record<string, any>;
  policies: Record<string, any>;
  commissions: Record<string, any>;
  auditTrail: any[];
}

export function initDatabase(dbPath: string): { close: () => void; getData: () => JsonDatabase } {
  const filePath = dbPath.replace(/\.db$/i, '.json');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let data: JsonDatabase;
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } else {
      data = createEmptyDb();
    }
  } catch {
    data = createEmptyDb();
  }

  // Seed sample data if empty
  seedSampleData(data);

  // Save to disk
  save(filePath, data);

  return {
    close: () => { save(filePath, data); },
    getData: () => data,
  };
}

function createEmptyDb(): JsonDatabase {
  return {
    agents: {},
    licenses: {},
    commissionTiers: {},
    policies: {},
    commissions: {},
    auditTrail: [],
  };
}

function save(filePath: string, data: JsonDatabase): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function seedSampleData(data: JsonDatabase): void {
  if (Object.keys(data.agents).length > 0) return;

  const now = Date.now();

  const agents = [
    { id: 'AGT001', name: 'Chan Tai Man', level: 'gold', status: 'active' },
    { id: 'AGT002', name: 'Wong Siu Ming', level: 'silver', status: 'active' },
    { id: 'AGT003', name: 'Lee Ka Fai', level: 'bronze', status: 'active' },
    { id: 'AGT004', name: 'Ng Mei Ling', level: 'platinum', status: 'active' },
    { id: 'AGT005', name: 'Cheung Wing Yan', level: 'unit_manager', status: 'active' },
  ];
  for (const a of agents) {
    data.agents[a.id] = { ...a, team_id: null, manager_id: null, joined_at: now - 365 * 24 * 60 * 60 * 1000, created_at: now };
  }

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
  for (const t of tiers) {
    data.commissionTiers[t.id] = {
      id: t.id, name: t.name, product_type: t.product, agent_level: t.level,
      rate: t.rate, min_premium: 0, max_premium: 999999999,
      policy_year: 1, is_renewal: false, effective_from: now, effective_to: null, created_at: now,
    };
  }
}
