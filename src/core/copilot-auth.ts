// GitHub Copilot OAuth — Device-flow login + short-lived token exchange.
//
// Flow:
//   1. POST github.com/login/device/code  → device_code, user_code, verify uri
//   2. User opens uri, enters user_code (we just print them)
//   3. Poll github.com/login/oauth/access_token until access_token granted
//   4. Cache the GitHub OAuth token in ~/.config/insure-agent/copilot.json
//   5. On each chat call, exchange GH token for a short-lived Copilot token via
//      api.github.com/copilot_internal/v2/token (cached in-memory until expiry)
//
// The CLIENT_ID below is the public Copilot client id used by VS Code; this is
// well-known and shipped in every Copilot-compatible editor. We do not embed
// any secret. Users authenticate with their own GitHub account and must hold
// a valid Copilot subscription for the API to return a token.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Public client id (GitHub Copilot for VS Code) — same value the official
// extension uses. Not a secret.
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPE = 'read:user';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const USER_URL = 'https://api.github.com/user';

const HEADERS_GH = {
  'accept': 'application/json',
  'content-type': 'application/json',
  'user-agent': 'GitHubCopilotChat/0.22.0',
  'editor-version': 'vscode/1.95.0',
  'editor-plugin-version': 'copilot-chat/0.22.0',
};

interface AuthFile {
  github_token: string;
  user?: { login: string; id: number };
  saved_at: number;
}

interface CopilotTokenCache {
  token: string;
  expires_at: number;  // unix seconds
  refresh_in?: number;
}

let memCache: CopilotTokenCache | null = null;

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? path.join(xdg, 'insure-agent') : path.join(os.homedir(), '.config', 'insure-agent');
}

function authFilePath(): string {
  return path.join(configDir(), 'copilot.json');
}

function readAuthFile(): AuthFile | null {
  try {
    const raw = fs.readFileSync(authFilePath(), 'utf-8');
    return JSON.parse(raw) as AuthFile;
  } catch {
    return null;
  }
}

function writeAuthFile(file: AuthFile): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(authFilePath(), JSON.stringify(file, null, 2), { mode: 0o600 });
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const r = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: HEADERS_GH,
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!r.ok) throw new Error(`Device-code request failed: ${r.status} ${await r.text()}`);
  return await r.json() as DeviceCodeResponse;
}

async function pollForAccessToken(deviceCode: string, intervalSec: number, expiresInSec: number): Promise<string> {
  const deadline = Date.now() + expiresInSec * 1000;
  let interval = intervalSec * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    const r = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: HEADERS_GH,
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!r.ok) throw new Error(`Token poll failed: ${r.status} ${await r.text()}`);
    const data = await r.json() as Record<string, string>;

    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval += 5000; continue; }
    if (data.error === 'expired_token') throw new Error('Device code expired. Run login again.');
    if (data.error === 'access_denied') throw new Error('Login was cancelled.');
    throw new Error(`OAuth error: ${data.error_description || data.error}`);
  }
  throw new Error('Login timed out before user completed authorisation.');
}

async function fetchGithubUser(token: string): Promise<{ login: string; id: number }> {
  const r = await fetch(USER_URL, {
    headers: { ...HEADERS_GH, authorization: `token ${token}` },
  });
  if (!r.ok) throw new Error(`Failed to fetch GitHub user: ${r.status}`);
  const u = await r.json() as { login: string; id: number };
  return { login: u.login, id: u.id };
}

export interface LoginCallbacks {
  /** Called once the device code is issued so the CLI can show it to the user. */
  onPrompt?: (info: DeviceCodeResponse) => void;
}

export async function loginDeviceFlow(cb: LoginCallbacks = {}): Promise<{ login: string }> {
  const dc = await requestDeviceCode();
  cb.onPrompt?.(dc);
  const ghToken = await pollForAccessToken(dc.device_code, dc.interval || 5, dc.expires_in || 900);
  const user = await fetchGithubUser(ghToken);
  writeAuthFile({ github_token: ghToken, user, saved_at: Date.now() });
  memCache = null;     // force refresh next call
  return { login: user.login };
}

export function logout(): boolean {
  memCache = null;
  try {
    fs.unlinkSync(authFilePath());
    return true;
  } catch {
    return false;
  }
}

export function status(): { loggedIn: boolean; login?: string; configPath: string } {
  const f = readAuthFile();
  return { loggedIn: !!f?.github_token, login: f?.user?.login, configPath: authFilePath() };
}

/** Resolve a short-lived Copilot bearer token, refreshing as needed. */
export async function getCopilotToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (memCache && memCache.expires_at > nowSec + 60) return memCache.token;

  const file = readAuthFile();
  if (!file?.github_token) {
    throw new Error('Not logged in to GitHub Copilot. Run: insure-agent auth login');
  }

  const r = await fetch(COPILOT_TOKEN_URL, {
    headers: { ...HEADERS_GH, authorization: `token ${file.github_token}` },
  });
  if (r.status === 401) {
    throw new Error('GitHub token rejected by Copilot. Re-authenticate: insure-agent auth login');
  }
  if (!r.ok) {
    throw new Error(`Copilot token exchange failed: ${r.status} ${await r.text()}`);
  }
  const data = await r.json() as { token: string; expires_at: number; refresh_in?: number };
  memCache = { token: data.token, expires_at: data.expires_at, refresh_in: data.refresh_in };
  return data.token;
}
