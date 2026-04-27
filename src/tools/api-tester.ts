import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel } from '../core/types.js';

export function createApiTester(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'api_tester',
      description: 'Test API endpoints - GET/POST/PUT/DELETE with response validation',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'method', type: 'string', required: true, description: 'HTTP method: GET, POST, PUT, DELETE, PATCH' },
        { name: 'url', type: 'string', required: true, description: 'Full URL to test' },
        { name: 'headers', type: 'object', required: false, description: 'Request headers' },
        { name: 'body', type: 'object', required: false, description: 'Request body (JSON)' },
        { name: 'expectStatus', type: 'number', required: false, description: 'Expected HTTP status code' },
        { name: 'timeout', type: 'number', required: false, description: 'Timeout in ms (default 10000)' },
      ],
    },
    execute: async (params) => {
      const method = String(params.method || 'GET').toUpperCase();
      const url = String(params.url);
      const headers = (params.headers as Record<string, string>) || {};
      const body = params.body;
      const expectStatus = params.expectStatus as number | undefined;
      const timeout = (params.timeout as number) || 10000;

      if (!url) return 'Missing URL parameter';

      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          signal: controller.signal,
        };

        if (body && method !== 'GET') {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timer);

        const duration = Date.now() - start;
        let responseBody: unknown;
        const contentType = response.headers.get('content-type') || '';
        const responseText = await response.text();

        try {
          responseBody = contentType.includes('json') ? JSON.parse(responseText) : responseText;
        } catch {
          responseBody = responseText;
        }

        const matches = expectStatus ? response.status === expectStatus : true;

        return JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          matches: matches ? '✅ PASS' : `❌ FAIL (expected ${expectStatus})`,
          contentType,
          body: typeof responseBody === 'string' && responseBody.length > 500
            ? responseBody.substring(0, 500) + '...'
            : responseBody,
        }, null, 2);
      } catch (err) {
        clearTimeout(timer);
        const duration = Date.now() - start;
        return JSON.stringify({
          status: 0,
          duration: `${duration}ms`,
          matches: '❌ ERROR',
          error: err instanceof Error ? err.message : String(err),
        }, null, 2);
      }
    },
  });
}
