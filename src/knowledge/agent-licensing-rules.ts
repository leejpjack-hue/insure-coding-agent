// Agent / producer licensing requirements per jurisdiction.

import { Jurisdiction, ProductType } from '../core/types.js';

export interface LicensingRule {
  jurisdiction: Jurisdiction;
  regulator: string;
  reference: string;
  appliesTo: ProductType[];
  initialRequirements: {
    examName: string;
    minScore?: number;
    minAgeYears: number;
    backgroundCheck: boolean;
  };
  continuingEducation: {
    annualHours: number;
    ethicsHours?: number;
    cycleYears: number;
  };
  renewalCycleYears: number;
  expiryGracePeriodDays: number;
  productAuthorizationRequired: boolean;
}

export const LICENSING_RULES: LicensingRule[] = [
  {
    jurisdiction: 'HK',
    regulator: 'Insurance Authority',
    reference: 'IA Code of Conduct & GL23',
    appliesTo: ['life', 'health', 'property', 'motor', 'travel', 'group_life', 'group_health'],
    initialRequirements: {
      examName: 'Insurance Intermediaries Qualifying Examination (IIQE)',
      minScore: 70,
      minAgeYears: 18,
      backgroundCheck: true,
    },
    continuingEducation: {
      annualHours: 15,
      ethicsHours: 3,
      cycleYears: 1,
    },
    renewalCycleYears: 3,
    expiryGracePeriodDays: 30,
    productAuthorizationRequired: true,
  },
  {
    jurisdiction: 'SG',
    regulator: 'MAS',
    reference: 'MAS Notice FAA-N13',
    appliesTo: ['life', 'health'],
    initialRequirements: {
      examName: 'Capital Markets and Financial Advisory Services (CMFAS) M5/M9',
      minScore: 75,
      minAgeYears: 21,
      backgroundCheck: true,
    },
    continuingEducation: {
      annualHours: 30,
      ethicsHours: 4,
      cycleYears: 1,
    },
    renewalCycleYears: 1,
    expiryGracePeriodDays: 0,
    productAuthorizationRequired: true,
  },
  {
    jurisdiction: 'EU',
    regulator: 'IDD competent authority',
    reference: 'IDD Article 10',
    appliesTo: ['life', 'health', 'property', 'motor', 'travel'],
    initialRequirements: {
      examName: 'IDD-compliant national exam',
      minAgeYears: 18,
      backgroundCheck: true,
    },
    continuingEducation: {
      annualHours: 15,
      cycleYears: 1,
    },
    renewalCycleYears: 1,
    expiryGracePeriodDays: 0,
    productAuthorizationRequired: false,
  },
  {
    jurisdiction: 'US',
    regulator: 'NAIC / state DOI',
    reference: 'NAIC Producer Licensing Model Act',
    appliesTo: ['life', 'health', 'property', 'motor', 'travel'],
    initialRequirements: {
      examName: 'State producer licensing exam',
      minScore: 70,
      minAgeYears: 18,
      backgroundCheck: true,
    },
    continuingEducation: {
      annualHours: 24,
      ethicsHours: 3,
      cycleYears: 2,
    },
    renewalCycleYears: 2,
    expiryGracePeriodDays: 30,
    productAuthorizationRequired: true,
  },
];

export function licensingFor(jurisdiction: Jurisdiction): LicensingRule | undefined {
  return LICENSING_RULES.find(r => r.jurisdiction === jurisdiction);
}

export function isProductAllowed(jurisdiction: Jurisdiction, product: ProductType): boolean {
  const rule = licensingFor(jurisdiction);
  return rule ? rule.appliesTo.includes(product) : false;
}
