import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel, LicenseInfo, LicenseStatus, ProductType } from '../core/types.js';
import { eventBus } from '../core/events.js';

// In-memory license store (in production, would query AMS database)
const licenseStore: Map<string, LicenseInfo> = new Map();

function initSampleData(): void {
  if (licenseStore.size > 0) return;
  const agents = [
    { id: 'AGT001', name: 'Chan Tai Man', products: ['life', 'health'], status: 'active' as LicenseStatus, ce: 12 },
    { id: 'AGT002', name: 'Wong Siu Ming', products: ['life', 'property', 'motor'], status: 'active' as LicenseStatus, ce: 8 },
    { id: 'AGT003', name: 'Lee Ka Fai', products: ['life'], status: 'expired' as LicenseStatus, ce: 3 },
    { id: 'AGT004', name: 'Ng Mei Ling', products: ['health', 'travel'], status: 'pending_renewal' as LicenseStatus, ce: 10 },
    { id: 'AGT005', name: 'Cheung Wing Yan', products: ['life', 'group_life', 'group_health'], status: 'active' as LicenseStatus, ce: 15 },
  ];

  const now = Date.now();
  for (const agent of agents) {
    licenseStore.set(agent.id, {
      agentId: agent.id,
      licenseNumber: `HK-IA-${agent.id}-${now}`,
      status: agent.status,
      authorizedProducts: agent.products as ProductType[],
      issuedAt: now - 365 * 24 * 60 * 60 * 1000,
      expiresAt: agent.status === 'expired' ? now - 30 * 24 * 60 * 60 * 1000 : now + 365 * 24 * 60 * 60 * 1000,
      jurisdiction: 'HK',
      continuingEducationHours: agent.ce,
      requiredCEHours: 10,
    });
  }
}

export function createLicenseChecker(registry: ToolRegistry): void {
  initSampleData();

  registry.register({
    definition: {
      name: 'license_checker',
      description: 'Check agent license status, product authorization, and continuing education',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'action', type: 'string', required: true, description: 'check_status | check_authorization | list_expiring | list_all' },
        { name: 'agentId', type: 'string', required: false, description: 'Agent ID' },
        { name: 'productType', type: 'string', required: false, description: 'Product type to check authorization for' },
        { name: 'daysUntilExpiry', type: 'number', required: false, description: 'Days until expiry threshold (default 30)' },
      ],
    },
    execute: async (params) => {
      const action = String(params.action);

      if (action === 'check_status') {
        const agentId = String(params.agentId || '');
        const license = licenseStore.get(agentId);
        if (!license) return `Agent ${agentId} not found`;
        eventBus.emit({ type: 'license_checked', agentId, status: license.status });
        return JSON.stringify({
          agentId: license.agentId,
          status: license.status,
          licenseNumber: license.licenseNumber,
          expiresAt: new Date(license.expiresAt).toISOString(),
          ceHours: `${license.continuingEducationHours}/${license.requiredCEHours}`,
          authorizedProducts: license.authorizedProducts,
        }, null, 2);
      }

      if (action === 'check_authorization') {
        const agentId = String(params.agentId || '');
        const productType = String(params.productType || '');
        const license = licenseStore.get(agentId);
        if (!license) return `Agent ${agentId} not found`;
        if (license.status !== 'active') return `Agent ${agentId} license is ${license.status}`;
        const authorized = license.authorizedProducts.includes(productType as ProductType);
        return authorized
          ? `Agent ${agentId} IS authorized for ${productType}`
          : `Agent ${agentId} is NOT authorized for ${productType}. Authorized: ${license.authorizedProducts.join(', ')}`;
      }

      if (action === 'list_expiring') {
        const days = Number(params.daysUntilExpiry) || 30;
        const threshold = Date.now() + days * 24 * 60 * 60 * 1000;
        const expiring: LicenseInfo[] = [];
        for (const license of licenseStore.values()) {
          if (license.expiresAt <= threshold || license.status === 'pending_renewal' || license.status === 'expired') {
            expiring.push(license);
          }
        }
        return expiring.length > 0
          ? JSON.stringify(expiring.map(l => ({ agentId: l.agentId, status: l.status, expiresAt: new Date(l.expiresAt).toISOString() })), null, 2)
          : `No agents expiring within ${days} days`;
      }

      if (action === 'list_all') {
        return JSON.stringify(Array.from(licenseStore.values()).map(l => ({
          agentId: l.agentId,
          status: l.status,
          products: l.authorizedProducts,
          expiresAt: new Date(l.expiresAt).toISOString(),
        })), null, 2);
      }

      return `Unknown action: ${action}. Use: check_status, check_authorization, list_expiring, list_all`;
    },
  });
}
