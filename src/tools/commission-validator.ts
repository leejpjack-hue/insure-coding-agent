import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel, CommissionInput, CommissionResult, CommissionTier, AgentLevel, ProductType } from '../core/types.js';
import { eventBus } from '../core/events.js';

// Default commission tiers for HK market
const DEFAULT_TIERS: CommissionTier[] = [
  { id: 'life_bronze_y1', name: 'Life Bronze Year 1', minPremium: 0, maxPremium: 100000, rate: 0.40, productType: 'life', agentLevel: 'bronze', policyYear: 1, isRenewal: false },
  { id: 'life_bronze_y2', name: 'Life Bronze Year 2', minPremium: 0, maxPremium: 100000, rate: 0.15, productType: 'life', agentLevel: 'bronze', policyYear: 2, isRenewal: true },
  { id: 'life_silver_y1', name: 'Life Silver Year 1', minPremium: 0, maxPremium: 250000, rate: 0.45, productType: 'life', agentLevel: 'silver', policyYear: 1, isRenewal: false },
  { id: 'life_gold_y1', name: 'Life Gold Year 1', minPremium: 0, maxPremium: 500000, rate: 0.50, productType: 'life', agentLevel: 'gold', policyYear: 1, isRenewal: false },
  { id: 'health_bronze', name: 'Health Bronze', minPremium: 0, maxPremium: 50000, rate: 0.25, productType: 'health', agentLevel: 'bronze', policyYear: 1, isRenewal: false },
  { id: 'health_silver', name: 'Health Silver', minPremium: 0, maxPremium: 100000, rate: 0.30, productType: 'health', agentLevel: 'silver', policyYear: 1, isRenewal: false },
  { id: 'motor_bronze', name: 'Motor Bronze', minPremium: 0, maxPremium: 100000, rate: 0.15, productType: 'motor', agentLevel: 'bronze', policyYear: 1, isRenewal: false },
  { id: 'travel_standard', name: 'Travel Standard', minPremium: 0, maxPremium: 10000, rate: 0.20, productType: 'travel', agentLevel: 'bronze', policyYear: 1, isRenewal: false },
  { id: 'override_um', name: 'Unit Manager Override', minPremium: 0, maxPremium: 999999999, rate: 0.05, productType: 'life', agentLevel: 'unit_manager', policyYear: 1, isRenewal: false },
  { id: 'override_bm', name: 'Branch Manager Override', minPremium: 0, maxPremium: 999999999, rate: 0.03, productType: 'life', agentLevel: 'branch_manager', policyYear: 1, isRenewal: false },
];

export class CommissionValidator {
  private tiers: CommissionTier[];

  constructor(tiers?: CommissionTier[]) {
    this.tiers = tiers || DEFAULT_TIERS;
  }

  calculate(input: CommissionInput): CommissionResult {
    const tier = this.findTier(input);
    if (!tier) {
      return {
        commission: 0,
        rate: 0,
        tier: 'No matching tier found',
        breakdown: [{ label: 'No matching commission tier', amount: 0, rate: 0 }],
      };
    }

    const baseCommission = input.premiumAmount * tier.rate;

    const breakdown = [
      { label: `Base commission (${tier.name})`, amount: baseCommission, rate: tier.rate },
    ];

    // Renewal discount
    if (input.isRenewal && input.policyYear > 1) {
      const renewalRate = tier.rate * 0.5;
      breakdown.push({ label: `Renewal adjustment`, amount: input.premiumAmount * renewalRate - baseCommission, rate: renewalRate });
    }

    const totalCommission = breakdown.reduce((sum, b) => sum + b.amount, 0);

    return {
      commission: Math.round(totalCommission * 100) / 100,
      rate: tier.rate,
      tier: tier.name,
      breakdown,
    };
  }

  validateFormula(formula: string, testCases: Array<{ input: CommissionInput; expected: number }>): { valid: boolean; discrepancies: string[] } {
    const discrepancies: string[] = [];

    for (const tc of testCases) {
      const result = this.calculate(tc.input);
      const diff = Math.abs(result.commission - tc.expected);
      if (diff > 0.01) {
        discrepancies.push(
          `For ${tc.input.agentLevel}/${tc.input.productType}/premium ${tc.input.premiumAmount}: expected ${tc.expected}, got ${result.commission} (diff: ${diff})`
        );
      }
    }

    eventBus.emit({ type: 'commission_validated', isValid: discrepancies.length === 0, discrepancies });
    return { valid: discrepancies.length === 0, discrepancies };
  }

  simulate(input: CommissionInput, tiers?: CommissionTier[]): CommissionResult[] {
    const results: CommissionResult[] = [];
    const tiersToUse = tiers || this.tiers;

    const matchingTiers = tiersToUse.filter(
      t => t.productType === input.productType && t.agentLevel === input.agentLevel
    );

    for (const tier of matchingTiers) {
      const result = this.calculate({ ...input, agentLevel: input.agentLevel });
      results.push(result);
    }

    return results;
  }

  private findTier(input: CommissionInput): CommissionTier | null {
    return this.tiers.find(
      t =>
        t.productType === input.productType &&
        t.agentLevel === input.agentLevel &&
        t.policyYear === input.policyYear &&
        t.isRenewal === input.isRenewal &&
        input.premiumAmount >= t.minPremium &&
        input.premiumAmount <= t.maxPremium
    ) || null;
  }
}

export function createCommissionTool(registry: ToolRegistry): void {
  const validator = new CommissionValidator();

  registry.register({
    definition: {
      name: 'commission_validator',
      description: 'Validate commission calculation formulas and simulate commissions',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'action', type: 'string', required: true, description: 'calculate | validate | simulate' },
        { name: 'agentLevel', type: 'string', required: false, description: 'Agent level' },
        { name: 'productType', type: 'string', required: false, description: 'Product type' },
        { name: 'premiumAmount', type: 'number', required: false, description: 'Premium amount' },
        { name: 'policyYear', type: 'number', required: false, description: 'Policy year' },
        { name: 'isRenewal', type: 'boolean', required: false, description: 'Is renewal' },
      ],
    },
    execute: async (params) => {
      const action = String(params.action);

      if (action === 'calculate') {
        const input: CommissionInput = {
          agentLevel: (params.agentLevel as AgentLevel) || 'bronze',
          productType: (params.productType as ProductType) || 'life',
          premiumAmount: Number(params.premiumAmount) || 0,
          policyYear: Number(params.policyYear) || 1,
          isRenewal: Boolean(params.isRenewal),
          jurisdiction: 'HK',
        };
        const result = validator.calculate(input);
        return JSON.stringify(result, null, 2);
      }

      if (action === 'simulate') {
        const input: CommissionInput = {
          agentLevel: (params.agentLevel as AgentLevel) || 'bronze',
          productType: (params.productType as ProductType) || 'life',
          premiumAmount: Number(params.premiumAmount) || 50000,
          policyYear: 1,
          isRenewal: false,
          jurisdiction: 'HK',
        };
        const results = validator.simulate(input);
        return JSON.stringify(results, null, 2);
      }

      return `Unknown action: ${action}. Use: calculate, validate, simulate`;
    },
  });
}
