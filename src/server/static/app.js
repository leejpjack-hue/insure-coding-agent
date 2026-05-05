// InsureAgent web UI — vanilla JS. No framework.
// Talks to /web/* endpoints over the same auth (HTTP Basic). The browser
// caches credentials and adds them automatically once the user logs in once.

(() => {
  'use strict';

  // ===== state =====
  let sessionId = null;
  let activeStream = null;
  let stepCounter = 0;

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const messagesEl = $('messages');
  const inputEl = $('input');
  const composerEl = $('composer');
  const sendBtn = $('send-btn');
  const cancelBtn = $('cancel-btn');
  const statusEl = $('status');
  const docListEl = $('doc-list');
  const sessionListEl = $('session-list');
  const modelLabelEl = $('model-label');

  // ===== initial load =====
  loadModelInfo();
  refreshDocs();
  refreshSessions();
  setupTabSwitcher();
  setupComposer();
  setupMobileMenu();
  $('refresh-docs').addEventListener('click', refreshDocs);
  $('new-session-btn').addEventListener('click', () => {
    sessionId = null;
    stepCounter = 0;
    messagesEl.innerHTML = '';
    setStatus('New session — say something to start.');
  });

  // ===== model info =====
  async function loadModelInfo() {
    try {
      // /api/health gives version+tools but not model; reuse /web/me as a probe
      // and surface model from defaults injected via env (the web does not expose
      // model selection in this minimal UI — keep label informational).
      const r = await fetch('/web/me');
      if (!r.ok) throw new Error('not authed');
      const data = await r.json();
      modelLabelEl.textContent = `signed in as ${data.user}`;
    } catch {
      modelLabelEl.textContent = '';
    }
  }

  // ===== docs sidebar (folder tree) =====
  // Doc paths come back flat as 'designs/surrender-flow.md',
  // 'requirements/foo/REQ-001.md', etc. We group them into a nested tree
  // and render with HTML5 <details>/<summary> so the browser handles
  // expand/collapse natively (no extra JS state to track).

  // Remember which folders the user has manually collapsed across refreshes
  // so a refreshDocs() doesn't re-open everything they closed.
  const collapsedFolders = new Set();

  /** Build a tree: { name, path, children: Map<name, node>, files: [...] } */
  function buildTree(docs) {
    const root = { name: '', path: '', children: new Map(), files: [] };
    for (const doc of docs) {
      const segments = doc.path.split('/').filter(Boolean);
      let node = root;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        if (!node.children.has(seg)) {
          const child = {
            name: seg,
            path: segments.slice(0, i + 1).join('/'),
            children: new Map(),
            files: [],
          };
          node.children.set(seg, child);
        }
        node = node.children.get(seg);
      }
      node.files.push(doc);
    }
    return root;
  }

  /** Recursively render a tree node into a fragment. */
  function renderTreeNode(node, depth) {
    const frag = document.createDocumentFragment();

    // Sub-folders first (sorted alphabetically), then files (sorted by mtime)
    const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of folders) {
      const details = document.createElement('details');
      details.className = 'tree-folder';
      details.style.setProperty('--depth', depth);
      details.open = !collapsedFolders.has(folder.path);
      details.addEventListener('toggle', () => {
        if (details.open) collapsedFolders.delete(folder.path);
        else collapsedFolders.add(folder.path);
      });

      const summary = document.createElement('summary');
      summary.className = 'tree-folder-label';
      const fileCount = countFiles(folder);
      summary.innerHTML =
        `<span class="caret">▸</span>` +
        `<span class="folder-icon">📁</span>` +
        `<span class="folder-name"></span>` +
        `<span class="folder-count"></span>`;
      summary.querySelector('.folder-name').textContent = folder.name;
      summary.querySelector('.folder-count').textContent = fileCount;
      details.appendChild(summary);

      const inner = document.createElement('div');
      inner.className = 'tree-folder-body';
      inner.appendChild(renderTreeNode(folder, depth + 1));
      details.appendChild(inner);

      frag.appendChild(details);
    }

    // Files (sorted by mtime desc — newest first)
    const files = [...node.files].sort((a, b) => b.modified - a.modified);
    for (const doc of files) {
      frag.appendChild(renderFileNode(doc, depth));
    }
    return frag;
  }

  function countFiles(node) {
    let n = node.files.length;
    for (const c of node.children.values()) n += countFiles(c);
    return n;
  }

  function renderFileNode(doc, depth) {
    const row = document.createElement('div');
    row.className = 'tree-file';
    row.style.setProperty('--depth', depth);
    row.title = doc.path;

    const baseName = doc.path.split('/').pop();

    const head = document.createElement('div');
    head.className = 'tree-file-head';
    head.innerHTML =
      `<span class="file-icon">📄</span>` +
      `<span class="file-name"></span>`;
    head.querySelector('.file-name').textContent = baseName;

    const meta = document.createElement('div');
    meta.className = 'tree-file-meta';
    const size = document.createElement('span');
    size.textContent = humanBytes(doc.bytes);
    const when = document.createElement('span');
    when.textContent = humanTime(doc.modified);
    const view = document.createElement('a');
    view.href = `/web/docs/${encodeURI(doc.path)}?inline=1`;
    view.target = '_blank';
    view.rel = 'noopener';
    view.textContent = 'view';
    view.addEventListener('click', (e) => e.stopPropagation());
    const dl = document.createElement('a');
    dl.href = `/web/docs/${encodeURI(doc.path)}`;
    dl.textContent = '↓';
    dl.title = 'Download';
    dl.addEventListener('click', (e) => e.stopPropagation());
    meta.appendChild(size);
    meta.appendChild(when);
    meta.appendChild(view);
    meta.appendChild(dl);

    row.appendChild(head);
    row.appendChild(meta);
    row.addEventListener('click', () => view.click());
    return row;
  }

  async function refreshDocs() {
    docListEl.innerHTML = '<li class="hint">Loading…</li>';
    try {
      const r = await fetch('/web/docs');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { docs } = await r.json();
      if (!docs || docs.length === 0) {
        docListEl.innerHTML = '<li class="hint">No documents yet. Ask the agent to design something — generated files appear here.</li>';
        return;
      }
      const tree = buildTree(docs);
      docListEl.innerHTML = '';
      // Replace the <ul> behaviour with a tree container — clear first
      docListEl.style.padding = '0';
      docListEl.appendChild(renderTreeNode(tree, 0));
    } catch (err) {
      docListEl.innerHTML = `<li class="hint" style="color:var(--red)">Failed to list docs: ${escapeHtml(err.message)}</li>`;
    }
  }

  // ===== sessions sidebar =====
  async function refreshSessions() {
    try {
      const r = await fetch('/web/sessions');
      if (!r.ok) return;
      const { sessions } = await r.json();
      sessionListEl.innerHTML = '';
      if (!sessions || sessions.length === 0) {
        sessionListEl.innerHTML = '<li class="hint">No previous sessions.</li>';
        return;
      }
      for (const s of sessions.slice(0, 30)) {
        const li = document.createElement('li');
        const id = document.createElement('div');
        id.className = 'doc-name';
        id.textContent = s.id;
        const meta = document.createElement('div');
        meta.className = 'doc-meta';
        meta.textContent = `${s.status} · ${humanTime(s.updatedAt || s.createdAt)}`;
        li.appendChild(id);
        li.appendChild(meta);
        sessionListEl.appendChild(li);
      }
    } catch { /* silent */ }
  }

  // ===== sidebar tabs =====
  function setupTabSwitcher() {
    document.querySelectorAll('.sidebar-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.sidebar-panel').forEach((p) => p.classList.add('hidden'));
        btn.classList.add('active');
        document.querySelector(`.sidebar-panel[data-panel="${btn.dataset.tab}"]`).classList.remove('hidden');
      });
    });
  }

  // ===== composer =====
  function setupComposer() {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        composerEl.requestSubmit();
      }
    });
    composerEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const task = inputEl.value.trim();
      if (!task) return;
      sendChat(task);
    });
    cancelBtn.addEventListener('click', () => {
      if (activeStream) {
        activeStream.abort();
        setStatus('Cancelled.', 'error');
        cleanupActive();
      }
    });
  }

  // ===== mobile menu =====
  function setupMobileMenu() {
    const menuBtn = $('menu-btn');
    const sidebar = $('sidebar');
    const backdrop = $('sidebar-backdrop');
    if (!menuBtn || !sidebar || !backdrop) return;

    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    });
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    });
  }

  // ===== chat =====
  async function sendChat(task) {
    inputEl.value = '';
    appendUserMessage(task);
    sendBtn.disabled = true;
    cancelBtn.classList.remove('hidden');
    setStatus('Thinking…', 'busy');

    const controller = new AbortController();
    activeStream = controller;

    let assistantContainer = null;
    let thinkingContainer = null;
    let activeStepEl = null;
    let assistantBuffer = '';

    try {
      const resp = await fetch('/web/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, sessionId }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
      }
      if (!resp.body) throw new Error('no response body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by blank lines (\n\n)
        let eventBoundary;
        while ((eventBoundary = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, eventBoundary);
          buffer = buffer.slice(eventBoundary + 2);
          const evt = parseSSEEvent(rawEvent);
          if (!evt) continue;
          handleEvent(evt);
        }
      }
      if (buffer.trim()) {
        const evt = parseSSEEvent(buffer);
        if (evt) handleEvent(evt);
      }
      setStatus('Done.');
    } catch (err) {
      if (err.name === 'AbortError') return;
      appendErrorMessage(err.message);
      setStatus(err.message, 'error');
    } finally {
      cleanupActive();
      // Refresh docs sidebar — the agent may have written new files
      refreshDocs();
    }

    function handleEvent(evt) {
      if (evt.event === 'session') {
        sessionId = evt.data.id;
        return;
      }
      if (evt.event === 'end') return;
      if (evt.event === 'error') {
        appendErrorMessage(evt.data?.message || 'unknown error');
        return;
      }
      if (evt.event !== 'agent') return;
      const a = evt.data;

      switch (a.type) {
        case 'thinking_start':
          thinkingContainer = document.createElement('div');
          thinkingContainer.className = 'msg thinking';
          messagesEl.appendChild(thinkingContainer);
          scrollToBottom();
          break;
        case 'thinking_delta':
          if (!thinkingContainer) {
            thinkingContainer = document.createElement('div');
            thinkingContainer.className = 'msg thinking';
            messagesEl.appendChild(thinkingContainer);
          }
          thinkingContainer.textContent += (a.text || '');
          scrollToBottom();
          break;
        case 'thinking_end':
          // keep visible — user can read it
          thinkingContainer = null;
          break;
        case 'text_delta':
          if (!assistantContainer) {
            assistantContainer = document.createElement('div');
            assistantContainer.className = 'msg assistant markdown';
            messagesEl.appendChild(assistantContainer);
            assistantBuffer = '';
          }
          assistantBuffer += (a.text || '');
          assistantContainer.innerHTML = renderMarkdown(assistantBuffer);
          scrollToBottom();
          break;
        case 'text_end':
          assistantContainer = null;
          assistantBuffer = '';
          break;
        case 'tool_call_start': {
          stepCounter++;
          activeStepEl = createStepEl(stepCounter, a);
          messagesEl.appendChild(activeStepEl);
          scrollToBottom();
          break;
        }
        case 'tool_result':
          if (activeStepEl) {
            updateStepEl(activeStepEl, a);
            activeStepEl = null;
          }
          break;
        case 'error':
          appendErrorMessage(a.error || 'agent error');
          break;
        case 'iteration':
          // intentionally quiet
          break;
        case 'complete':
          setStatus(`Done · ${a.iterations || 0} iterations · ~${a.tokens || 0} tokens`);
          break;
      }
    }
  }

  function cleanupActive() {
    activeStream = null;
    sendBtn.disabled = false;
    cancelBtn.classList.add('hidden');
  }

  function appendUserMessage(text) {
    const wrap = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'msg user-label';
    label.textContent = 'You';
    const msg = document.createElement('div');
    msg.className = 'msg user';
    msg.textContent = text;
    wrap.appendChild(label);
    wrap.appendChild(msg);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function appendErrorMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg error';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function createStepEl(num, evt) {
    const el = document.createElement('div');
    el.className = 'tool-step';
    const params = evt.params ? JSON.stringify(evt.params) : '';
    el.innerHTML = `
      <div class="tool-step-header">
        <span class="status-icon pending">○</span>
        <span class="num">#${num}</span>
        <span class="name"></span>
        <span class="params"></span>
        <span class="duration">…</span>
        <span class="chevron">▸</span>
      </div>
      <div class="tool-step-body"></div>`;
    el.querySelector('.name').textContent = evt.name || 'tool';
    el.querySelector('.params').textContent = params.length > 200 ? params.slice(0, 197) + '…' : params;
    el.querySelector('.tool-step-header').addEventListener('click', () => {
      el.classList.toggle('expanded');
    });
    return el;
  }

  function updateStepEl(el, evt) {
    const icon = el.querySelector('.status-icon');
    const dur = el.querySelector('.duration');
    const body = el.querySelector('.tool-step-body');
    if (evt.status === 'success') {
      icon.className = 'status-icon success';
      icon.textContent = '✓';
    } else {
      icon.className = 'status-icon error';
      icon.textContent = '✗';
    }
    dur.textContent = formatDuration(evt.duration || 0);
    body.textContent = evt.content || '';
  }

  // ===== helpers =====
  function setStatus(text, cls = '') {
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
    statusEl.textContent = text;
  }
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function parseSSEEvent(raw) {
    const lines = raw.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return null;
    try { return { event, data: JSON.parse(data) }; } catch { return { event, data }; }
  }
  function humanBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  function humanTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }
  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  // ===== minimal markdown renderer (chat output) =====
  function renderMarkdown(src) {
    // Escape, then promote known patterns. Streaming-safe: only operates on
    // complete-ish constructs but tolerates open ones (last partial line).
    let html = escapeHtml(src);

    // Code fences ```lang ... ```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="lang-${escapeHtml(lang)}">${code}</code></pre>`;
    });

    // Inline code (after fences so we don't double-format)
    html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

    // Headings
    html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');

    // Bold / italic (bold first to avoid eating ** in italic)
    html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bare URLs
    html = html.replace(/(?<!["=])(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

    // Block quotes
    html = html.replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');

    // Lists — group runs of "- " or "1. " into <ul>/<ol>
    html = html.replace(/(?:^|\n)((?:- .+\n?)+)/g, (_, block) => {
      const items = block.trim().split('\n').map((l) => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `\n<ul>${items}</ul>`;
    });
    html = html.replace(/(?:^|\n)((?:\d+\. .+\n?)+)/g, (_, block) => {
      const items = block.trim().split('\n').map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `\n<ol>${items}</ol>`;
    });

    // Tables
    html = html.replace(/^(\|.+\|\n\|[-:|\s]+\|\n(?:\|.+\|\n?)+)/gm, (block) => {
      const lines = block.trim().split('\n');
      const headerCells = lines[0].split('|').slice(1, -1).map((c) => `<th>${c.trim()}</th>`).join('');
      const rowsHtml = lines.slice(2).map((row) => {
        const cells = row.split('|').slice(1, -1).map((c) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    });

    // Paragraphs — wrap orphan text lines (very loose)
    html = html.replace(/(?:^|\n)([^<\n].+?)(?=\n|$)/g, (m, p1) => {
      if (/^\s*<\/?(h\d|ul|ol|li|pre|table|blockquote|tr|td|th|tbody|thead)/.test(p1.trim())) return m;
      return '\n' + p1;
    });

    return html;
  }
})();
