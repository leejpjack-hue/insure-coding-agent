// Web UI for the InsureAgent — sits on top of the existing Express server.
//
// Adds three pieces:
//   1. HTTP Basic auth gate (WEB_USER / WEB_PASSWORD) on '/' and the SSE/docs
//      endpoints below. The pre-existing /api/* routes keep their own bearer
//      auth (INSURE_AGENT_API_KEY); the gate here is for the *browser* UI.
//   2. POST /web/chat/stream — Server-Sent Events stream wrapping AgentLoop.
//      Browser opens a normal POST and reads SSE chunks from the response body.
//   3. GET /web/docs and GET /web/docs/*  — directory listing and download for
//      the project's docs/ folder so users can grab generated design docs.
//
// Static files live under src/server/static/ and are copied to
// dist/server/static/ by the postbuild script in package.json.

import express, { Request, Response, NextFunction, Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentLoop, AgentEvent } from '../core/agent-loop.js';
import { Orchestrator } from '../core/orchestrator.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { ModelConfig } from '../core/types.js';

interface WebUIOptions {
  app: Express;
  orchestrator: Orchestrator;
  registry: ToolRegistry;
  defaultModel: ModelConfig;
  /** Project root used to resolve docs/. Defaults to process.cwd(). */
  projectRoot?: string;
}

/** True if WEB_USER and WEB_PASSWORD are both set. */
export function isWebUIEnabled(): boolean {
  return !!(process.env.WEB_USER && process.env.WEB_PASSWORD);
}

/**
 * Constant-time string equality. Avoids timing attacks on the password compare
 * (the attacker can otherwise probe character-by-character).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HTTP Basic Auth middleware reading WEB_USER / WEB_PASSWORD. */
function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedUser = process.env.WEB_USER || '';
  const expectedPass = process.env.WEB_PASSWORD || '';
  if (!expectedUser || !expectedPass) {
    res.status(503).type('text/plain')
      .send('Web UI disabled: set WEB_USER and WEB_PASSWORD in .env to enable.');
    return;
  }
  const header = req.header('authorization') || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="InsureAgent", charset="UTF-8"');
    res.status(401).type('text/plain').send('Authentication required');
    return;
  }
  let user = ''; let pass = '';
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error('malformed credentials');
    user = decoded.slice(0, idx);
    pass = decoded.slice(idx + 1);
  } catch {
    res.set('WWW-Authenticate', 'Basic realm="InsureAgent"');
    res.status(401).type('text/plain').send('Malformed credentials');
    return;
  }
  if (!timingSafeEqual(user, expectedUser) || !timingSafeEqual(pass, expectedPass)) {
    res.set('WWW-Authenticate', 'Basic realm="InsureAgent"');
    res.status(401).type('text/plain').send('Invalid credentials');
    return;
  }
  next();
}

/** Resolve dist/server/static (production) or src/server/static (dev / tsx). */
function resolveStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server/web-ui.js → dist/server/static/
  // src/server/web-ui.ts (tsx) → src/server/static/
  return path.join(here, 'static');
}

/** Detect any directory traversal in a path requested by the user. */
function isSafeRelativePath(rel: string): boolean {
  if (rel.includes('..') || path.isAbsolute(rel) || rel.includes('\0')) return false;
  return true;
}

/** Recursively walk docs/ and return a flat list of relative file paths. */
function listDocsRecursive(root: string): Array<{ path: string; bytes: number; modified: number }> {
  const results: Array<{ path: string; bytes: number; modified: number }> = [];
  function walk(dir: string, rel: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          results.push({ path: relPath, bytes: stat.size, modified: stat.mtimeMs });
        } catch { /* unreadable */ }
      }
    }
  }
  walk(root, '');
  return results.sort((a, b) => b.modified - a.modified);
}

export function attachWebUI(opts: WebUIOptions): void {
  const { app, orchestrator, registry, defaultModel } = opts;
  const projectRoot = opts.projectRoot || process.cwd();
  const staticDir = resolveStaticDir();

  // === serve static UI assets (CSS/JS) WITHOUT auth so the login prompt can
  // load styles before the user enters credentials. The HTML at '/' itself
  // is already trivial without the assets, so this is fine.
  //
  // We rely on the version query string (?v=<mtime>) injected into the HTML
  // for cache-busting, so an aggressive 1-day cache here is safe — Cloudflare
  // and the browser will refetch as soon as the URL changes.
  app.use('/web/static', express.static(staticDir, {
    fallthrough: true,
    maxAge: '1d',
    immutable: false,   // mtime can change (rebuild)
  }));

  // === everything else under /web is auth-gated ===

  /**
   * Serve index.html with a runtime version stamp so static URLs become
   * /web/static/app.js?v=<mtime> — Cloudflare and the browser see a fresh
   * URL each rebuild and bypass any cached copy of the previous bundle.
   *
   * The HTML itself is sent with no-cache so the browser always re-fetches
   * to pick up the latest version stamp.
   */
  app.get('/web', basicAuth, (_req, res) => {
    let html: string;
    try {
      html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
    } catch (err) {
      res.status(500).type('text/plain').send(`UI not built — missing index.html (${(err as Error).message})`);
      return;
    }
    const version = (() => {
      try {
        const a = fs.statSync(path.join(staticDir, 'app.js')).mtimeMs;
        const c = fs.statSync(path.join(staticDir, 'styles.css')).mtimeMs;
        return Math.floor(Math.max(a, c)).toString(36);
      } catch { return Date.now().toString(36); }
    })();
    html = html
      .replace(/(\/web\/static\/[\w./-]+\.(?:js|css))(?:\?v=[^"'\s]+)?/g, `$1?v=${version}`);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.type('text/html').send(html);
  });
  app.get('/', basicAuth, (_req, res) => res.redirect(302, '/web'));

  // /web/me — quick auth probe used by the JS to verify login worked
  app.get('/web/me', basicAuth, (_req, res) => {
    res.json({ user: process.env.WEB_USER, ts: Date.now() });
  });

  // /web/docs — list every file under <projectRoot>/docs
  app.get('/web/docs', basicAuth, (_req, res) => {
    const docsRoot = path.join(projectRoot, 'docs');
    if (!fs.existsSync(docsRoot)) { res.json({ docs: [] }); return; }
    res.json({ docs: listDocsRecursive(docsRoot), root: docsRoot });
  });

  // /web/docs/<rel-path> — download a single file. Strict path-traversal check.
  app.get('/web/docs/*', basicAuth, (req, res) => {
    const rel = decodeURIComponent((req.params as { 0: string })[0] || '');
    if (!isSafeRelativePath(rel)) { res.status(400).send('bad path'); return; }
    const docsRoot = path.join(projectRoot, 'docs');
    const full = path.join(docsRoot, rel);
    // Belt-and-braces: ensure resolved path is still under docsRoot
    if (!full.startsWith(docsRoot + path.sep) && full !== docsRoot) {
      res.status(400).send('bad path'); return;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).send('not found'); return;
    }
    const inline = req.query.inline === '1';
    const baseName = path.basename(full);
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${baseName.replace(/"/g, '\\"')}"`,
    );
    res.sendFile(full);
  });

  // /web/sessions — last N sessions for the chat history sidebar
  app.get('/web/sessions', basicAuth, (_req, res) => {
    res.json({ sessions: orchestrator.listSessions().slice(0, 30) });
  });

  // /web/chat/stream — POST JSON { task, sessionId? }, receive SSE stream of
  // AgentEvent objects. Browser opens this with fetch() and reads chunks.
  app.post('/web/chat/stream', basicAuth, express.json(), async (req, res) => {
    const body = req.body as { task?: string; sessionId?: string; modelOverride?: ModelConfig };
    const task = (body.task || '').trim();
    if (!task) { res.status(400).json({ error: 'missing task' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    // Connection header is illegal in HTTP/2 — only set for HTTP/1.1
    const httpVersion = req.httpVersion;
    if (httpVersion === '1.0' || httpVersion === '1.1') {
      res.setHeader('Connection', 'keep-alive');
    }
    res.setHeader('X-Accel-Buffering', 'no'); // tell nginx/Cloudflare not to buffer SSE
    res.flushHeaders();

    const send = (eventName: string, data: unknown) => {
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch { /* client disconnected */ }
    };

    // Heartbeat: send SSE comment every 15s to keep the connection alive
    // through Cloudflare/nginx proxies that cut idle connections.
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { /* disconnected */ }
    }, 15000);

    // Resolve session
    let sessionId = body.sessionId;
    const sessionMgr = (orchestrator as unknown as { sessionManager: { createSession: (root: string, mc: ModelConfig) => { id: string } } }).sessionManager;
    if (!sessionId) {
      const sess = sessionMgr.createSession(projectRoot, body.modelOverride || defaultModel);
      sessionId = sess.id;
      send('session', { id: sessionId });
    }

    const onEvent = (evt: AgentEvent) => {
      try { send('agent', evt); } catch { /* client disconnected */ }
    };

    const loop = new AgentLoop({
      sessionId: sessionId!,
      projectRoot,
      registry,
      sessionManager: sessionMgr as unknown as ConstructorParameters<typeof AgentLoop>[0]['sessionManager'],
      modelConfig: body.modelOverride || defaultModel,
      onEvent,
      // Auto-approve all need_confirmation tools in web UI (file_write, file_edit, bash)
      needApproval: async () => true,
    });

    // Hang up cleanly if the client navigates away
    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      await loop.run(task);
      if (!aborted) send('end', { ok: true });
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      clearInterval(heartbeat);
      try { res.end(); } catch { /* already closed */ }
    }
  });
}
