// Commission disclosure and structuring rules per jurisdiction.

import { Jurisdiction } from '../core/types.js';

export interface CommissionDisclosureRule {
  jurisdiction: Jurisdiction;
  reference: string;
  appliesTo: string[];           // product categories
  mustDisclose: string[];        // information items to surface
  timing: 'pre_sale' | 'at_sale' | 'post_sale';
  cappedRate?: number;           // soft regulatory ceiling (informational)
}

export const COMMISSION_DISCLOSURE_RULES: CommissionDisclosureRule[] = [
  {
    jurisdiction: 'HK',
    reference: 'IA GL20',
    appliesTo: ['life', 'group_life'],
    mustDisclose: ['commission_rate', 'override_chain', 'renewal_terms', 'incentive_bonus'],
    timing: 'pre_sale',
  },
  {
    jurisdiction: 'HK',
    reference: 'IA GL15',
    appliesTo: ['health'],
    mustDisclose: ['commission_rate', 'service_fee'],
    timing: 'pre_sale',
  },
  {
    jurisdiction: 'SG',
    reference: 'MAS FAA-N03',
    appliesTo: ['life', 'health'],
    mustDisclose: ['commission_rate', 'trail_commission', 'override'],
    timing: 'pre_sale',
  },
  {
    jurisdiction: 'EU',
    reference: 'IDD Article 19',
    appliesTo: ['life', 'health', 'property', 'motor', 'travel'],
    mustDisclose: ['nature_of_remuneration', 'is_fee_or_commission', 'amount_or_basis'],
    timing: 'pre_sale',
  },
  {
    jurisdiction: 'US',
    reference: 'NAIC Model #275',
    appliesTo: ['life', 'health'],
    mustDisclose: ['commission_rate', 'compensation_disclosure_form'],
    timing: 'pre_sale',
  },
];

// Commission tier guidance — informational caps & typical structures.
// These are not regulatory caps; they reflect typical HK market practice.
export interface CommissionStructureGuide {
  productType: string;
  policyYear: number;
  typicalRate: { min: number; max: number };
  notes: string;
}

export const COMMISSION_STRUCTURE_GUIDE: CommissionStructureGuide[] = [
  { productType: 'life',     policyYear: 1, typicalRate: { min: 0.30, max: 0.55 }, notes: 'Year-1 high; tapers sharply for years 2+.' },
  { productType: 'life',     policyYear: 2, typicalRate: { min: 0.10, max: 0.20 }, notes: 'Renewal/persistency commission.' },
  { productType: 'life',     policyYear: 3, typicalRate: { min: 0.03, max: 0.10 }, notes: 'Tail commission; some products zero out by year 6.' },
  { productType: 'health',   policyYear: 1, typicalRate: { min: 0.20, max: 0.35 }, notes: 'Often flat across years for indemnity health.' },
  { productType: 'property', policyYear: 1, typicalRate: { min: 0.10, max: 0.20 }, notes: 'Annual renewable; rates similar each year.' },
  { productType: 'motor',    policyYear: 1, typicalRate: { min: 0.10, max: 0.18 }, notes: 'Direct channels often pay less.' },
  { productType: 'travel',   policyYear: 1, typicalRate: { min: 0.15, max: 0.30 }, notes: 'Single-premium short-term policies.' },
];

export function disclosureRulesFor(jurisdiction: Jurisdiction, productType: string): CommissionDisclosureRule[] {
  return COMMISSION_DISCLOSURE_RULES.filter(
    r => r.jurisdiction === jurisdiction && r.appliesTo.includes(productType)
  );
}
