// Ship to Frontend service (pilot). No dependencies; Node 20+.
//
// The plugin talks only to this service. It holds the GitHub tokens (one fine-grained
// token per designer for the pilot), reads repo settings for the plugin, and commits
// generated files to design/<feature> with a pull request into the project branch.
//
//   GET  /v1/health
//   GET  /v1/context?feature=team-members   → settings, mapping, routes/main from the project branch
//   POST /v1/ship                            → one commit on design/<feature>, open or update the PR
//
// Environment:
//   SHIP_REPO          owner/repo, e.g. AhmadElAlkoumi/s-workflow-sandbox
//   SHIP_TOKENS_FILE   JSON file: { "<figma user id>": { "token": "github_pat_…", "name": "…" } }
//                      Keep it readable only by the service user. Tokens are never logged or returned.
//   SHIP_READ_TOKEN    token used for /v1/context (read-only access to the repo); defaults to the
//                      first designer token
//   PORT               default 8787
//
// Safety rules enforced here, whatever the plugin sends:
//   - commits only to branches matching design/<kebab-name>, never to main or the project branch
//   - never force-pushes (the ref update is a fast-forward or fails)
//   - writes only under the features folder, plus the routes file and main.ts from .ship-to-frontend.json
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 2 * 1024 * 1024;

export function createGitHub(token, fetchImpl = fetch) {
  return async function gh(method, path, body) {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ship-to-frontend',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path.split('?')[0]}: ${res.status} ${data?.message ?? ''}`.trim());
      err.status = res.status;
      throw err;
    }
    return data;
  };
}

export function createApp({ repo, tokens, readToken, github = createGitHub }) {
  const [owner, name] = repo.split('/');
  const R = `/repos/${owner}/${name}`;
  const reader = github(readToken);

  const enc = encodeURIComponent;
  async function file(gh, path, ref) {
    try {
      const f = await gh('GET', `${R}/contents/${path.split('/').map(enc).join('/')}?ref=${enc(ref)}`);
      return Buffer.from(f.content, 'base64').toString('utf8');
    } catch (e) {
      if (e.status === 404) return undefined;
      throw e;
    }
  }
  async function branchSha(gh, branch) {
    try {
      return (await gh('GET', `${R}/git/ref/heads/${branch.split('/').map(enc).join('/')}`)).object.sha;
    } catch (e) {
      if (e.status === 404) return undefined;
      throw e;
    }
  }
  async function settings(gh) {
    const meta = await gh('GET', R);
    const raw = await file(gh, '.ship-to-frontend.json', meta.default_branch);
    if (!raw) throw httpError(400, `${repo} has no .ship-to-frontend.json on ${meta.default_branch}`);
    return { defaultBranch: meta.default_branch, config: JSON.parse(raw) };
  }

  async function context(feature) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(feature)) throw httpError(400, 'feature must be kebab-case, e.g. team-members');
    const { defaultBranch, config } = await settings(reader);
    const mapping = JSON.parse((await file(reader, 'figma/mapping.json', defaultBranch)) ?? 'null');
    const projectBranch = config.projectBranch.replace('{feature}', feature);
    const exists = Boolean(await branchSha(reader, projectBranch));
    const ref = exists ? projectBranch : defaultBranch;
    const files = {};
    for (const p of [config.paths.routes, config.paths.main]) {
      const c = await file(reader, p, ref);
      if (c !== undefined) files[p] = c;
    }
    return { repo, defaultBranch, projectBranch, projectBranchExists: exists, config, mapping, files };
  }

  async function ship(req) {
    const designer = tokens[req.figmaUserId];
    if (!designer) throw httpError(403, 'Your Figma account has no GitHub access set up for Ship to Frontend. Ask the service owner to add your token.');
    const gh = github(designer.token);
    const { defaultBranch, config } = await settings(gh);
    const feature = String(req.feature ?? '');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(feature)) throw httpError(400, 'feature must be kebab-case');
    const designBranch = config.designBranch.replace('{feature}', feature);
    const projectBranch = config.projectBranch.replace('{feature}', feature);
    if (!/^design\/[a-z0-9]+(-[a-z0-9]+)*$/.test(designBranch)) throw httpError(400, `refusing to push to ${designBranch}: only design/* branches`);
    if ([defaultBranch, 'main', 'master', projectBranch].includes(designBranch)) throw httpError(400, `refusing to push to ${designBranch}`);
    if (req.designBranch && req.designBranch !== designBranch) throw httpError(400, `branch mismatch: expected ${designBranch}`);
    if (req.projectBranch && req.projectBranch !== projectBranch) throw httpError(400, `base mismatch: expected ${projectBranch}`);

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) throw httpError(400, 'no files');
    const featureDir = `${config.paths.features}/${feature}/`;
    const allowed = (p) => typeof p === 'string' && !p.includes('..') && !p.startsWith('/') && (p.startsWith(featureDir) || p === config.paths.routes || p === config.paths.main);
    const bad = files.filter(f => !allowed(f.path) || typeof f.content !== 'string');
    if (bad.length) throw httpError(400, `refusing to write outside ${featureDir}: ${bad.map(f => f.path).join(', ')}`);

    const baseSha = await branchSha(gh, projectBranch);
    if (!baseSha) throw httpError(409, `${projectBranch} does not exist. Frontend creates it before the first designer push.`);
    let head = await branchSha(gh, designBranch);
    let createdBranch = false;
    if (!head) {
      await gh('POST', `${R}/git/refs`, { ref: `refs/heads/${designBranch}`, sha: baseSha });
      head = baseSha;
      createdBranch = true;
    }
    const headCommit = await gh('GET', `${R}/git/commits/${head}`);
    const tree = await gh('POST', `${R}/git/trees`, {
      base_tree: headCommit.tree.sha,
      tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    });
    let commitSha = head;
    const unchanged = tree.sha === headCommit.tree.sha;
    if (!unchanged) {
      const who = String(req.figmaUserName || designer.name || 'designer').slice(0, 80);
      const frames = (req.frames ?? []).map(f => `- ${f.name} (${f.id})`).join('\n');
      const commit = await gh('POST', `${R}/git/commits`, {
        message: `${req.prTitle ?? `${feature} screen`}\n\nGenerated by Ship to Frontend from Figma for ${who}.\n${req.fileKey ? `File: https://www.figma.com/design/${req.fileKey}\n` : ''}${frames}\n`,
        tree: tree.sha,
        parents: [head],
      });
      // force: false → fails instead of overwriting if someone pushed in between.
      await gh('PATCH', `${R}/git/refs/heads/${designBranch.split('/').map(enc).join('/')}`, { sha: commit.sha, force: false });
      commitSha = commit.sha;
    }

    const open = await gh('GET', `${R}/pulls?state=open&head=${enc(`${owner}:${designBranch}`)}&base=${enc(projectBranch)}`);
    let pr;
    let created = false;
    if (open.length) {
      pr = await gh('PATCH', `${R}/pulls/${open[0].number}`, { title: req.prTitle, body: req.prBody });
    } else {
      pr = await gh('POST', `${R}/pulls`, { title: req.prTitle, head: designBranch, base: projectBranch, body: req.prBody });
      created = true;
    }
    return { branch: designBranch, base: projectBranch, commit: commitSha, unchanged, createdBranch, created, prNumber: pr.number, prUrl: pr.html_url };
  }

  return async function handle(req, res) {
    // Figma plugin iframes have a "null" origin.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { ok: true, repo });
      if (req.method === 'GET' && url.pathname === '/v1/context') return send(res, 200, await context(url.searchParams.get('feature') ?? ''));
      if (req.method === 'POST' && url.pathname === '/v1/ship') return send(res, 200, await ship(await readJson(req)));
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      const status = e.httpStatus ?? (e.status === 422 ? 409 : 502);
      console.error(`${req.method} ${url.pathname}: ${e.message}`); // messages never contain tokens
      return send(res, status, { error: e.message });
    }
  };
}

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

function send(res, status, body) {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'request too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(httpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = process.env.SHIP_REPO;
  const tokensFile = process.env.SHIP_TOKENS_FILE;
  if (!repo || !tokensFile) {
    console.error('Set SHIP_REPO and SHIP_TOKENS_FILE. See the header of tools/service/server.mjs.');
    process.exit(1);
  }
  const tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
  const readToken = process.env.SHIP_READ_TOKEN ?? Object.values(tokens)[0]?.token;
  const port = Number(process.env.PORT ?? 8787);
  createServer(createApp({ repo, tokens, readToken })).listen(port, () => {
    console.log(`Ship to Frontend service for ${repo} on :${port} (${Object.keys(tokens).length} designer token(s))`);
  });
}
