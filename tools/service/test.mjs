// Service tests against an in-memory GitHub. Run: node tools/service/test.mjs
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createApp } from './server.mjs';

const sha = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex');

function fakeGitHub(initial) {
  const refs = { main: 'c0', 'feature/team-members': 'c0' };
  const commits = { c0: { tree: sha(initial), files: { ...initial } } };
  const trees = { [sha(initial)]: { ...initial } };
  const pulls = [];
  const calls = [];
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  const factory = (token) => async (method, path, body) => {
    calls.push({ token, method, path: path.split('?')[0], body });
    const p = path.replace('/repos/acme/app', '');
    const [route, q = ''] = p.split('?');
    const query = new URLSearchParams(q);
    if (method === 'GET' && route === '') return { default_branch: 'main' };
    if (method === 'GET' && route.startsWith('/contents/')) {
      const file = decodeURIComponent(route.slice('/contents/'.length));
      const ref = refs[query.get('ref')];
      const content = ref && commits[ref].files[file];
      if (content === undefined) throw notFound();
      return { content: Buffer.from(content).toString('base64') };
    }
    if (method === 'GET' && route.startsWith('/git/ref/heads/')) {
      const b = decodeURIComponent(route.slice('/git/ref/heads/'.length));
      if (!refs[b]) throw notFound();
      return { object: { sha: refs[b] } };
    }
    if (method === 'POST' && route === '/git/refs') { refs[body.ref.replace('refs/heads/', '')] = body.sha; return {}; }
    if (method === 'GET' && route.startsWith('/git/commits/')) { const c = commits[route.split('/').pop()]; return { tree: { sha: c.tree } }; }
    if (method === 'POST' && route === '/git/trees') {
      const files = { ...trees[body.base_tree] };
      for (const t of body.tree) files[t.path] = t.content;
      const s = sha(files);
      trees[s] = files;
      return { sha: s };
    }
    if (method === 'POST' && route === '/git/commits') {
      const s = sha([body.tree, body.parents]);
      commits[s] = { tree: body.tree, files: trees[body.tree], message: body.message };
      return { sha: s };
    }
    if (method === 'PATCH' && route.startsWith('/git/refs/heads/')) {
      if (body.force !== false) throw new Error('force must be false');
      refs[decodeURIComponent(route.slice('/git/refs/heads/'.length))] = body.sha;
      return {};
    }
    if (method === 'GET' && route === '/pulls') return pulls.filter(x => x.head === query.get('head').split(':')[1] && x.base === query.get('base'));
    if (method === 'POST' && route === '/pulls') { const pr = { number: pulls.length + 1, html_url: `https://github.com/acme/app/pull/${pulls.length + 1}`, ...body }; pulls.push(pr); return pr; }
    if (method === 'PATCH' && route.startsWith('/pulls/')) { const pr = pulls.find(x => x.number === Number(route.split('/').pop())); Object.assign(pr, body); return pr; }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { factory, refs, commits, pulls, calls };
}

const config = {
  projectBranch: 'feature/{feature}', designBranch: 'design/{feature}',
  paths: { features: 'src/app/features', routes: 'src/app/app.routes.ts', main: 'src/main.ts' },
};
const gh = fakeGitHub({
  '.ship-to-frontend.json': JSON.stringify(config),
  'figma/mapping.json': '{"components":{}}',
  'src/app/app.routes.ts': 'export const routes = [];\n',
  'src/main.ts': 'bootstrap();\n',
});
const app = createApp({ repo: 'acme/app', tokens: { 'figma-1': { token: 'secret-designer-token', name: 'Lina' } }, readToken: 'secret-read-token', github: gh.factory });
const server = createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`); if (!cond) failures++; };

const payload = {
  figmaUserId: 'figma-1', figmaUserName: 'Lina', fileKey: 'abc', frames: [{ id: '4:11', name: 'Team members / default' }],
  feature: 'team-members', designBranch: 'design/team-members', projectBranch: 'feature/team-members',
  prTitle: 'Team members screen', prBody: 'body v1',
  files: [
    { path: 'src/app/features/team-members/team-members.page.ts', content: 'page v1' },
    { path: 'src/app/app.routes.ts', content: 'export const routes = [team];\n' },
  ],
};

try {
  const ctx = await call('GET', '/v1/context?feature=team-members');
  ok('context: reads settings, mapping and files from the project branch', ctx.status === 200 && ctx.body.projectBranchExists && ctx.body.files['src/main.ts'] === 'bootstrap();\n' && ctx.body.mapping.components);
  ok('context: never returns tokens', !JSON.stringify(ctx.body).includes('secret'));

  const first = await call('POST', '/v1/ship', payload);
  ok('ship: creates design/team-members from the project branch', first.status === 200 && first.body.createdBranch, JSON.stringify(first.body));
  ok('ship: opens a PR into the project branch', first.body.created && gh.pulls[0].base === 'feature/team-members' && gh.pulls[0].head === 'design/team-members');
  ok('ship: one commit with both files', gh.commits[gh.refs['design/team-members']].files['src/app/features/team-members/team-members.page.ts'] === 'page v1');
  ok('ship: project branch and main untouched', gh.refs['feature/team-members'] === 'c0' && gh.refs.main === 'c0');
  ok('ship: uses the designer token for writes', gh.calls.filter(c => c.method !== 'GET').every(c => c.token === 'secret-designer-token'));

  const same = await call('POST', '/v1/ship', { ...payload, prBody: 'body v2' });
  ok('re-ship (same files): no new commit, same PR updated', same.body.unchanged && !same.body.created && same.body.prNumber === 1 && gh.pulls[0].body === 'body v2');

  const changed = await call('POST', '/v1/ship', { ...payload, files: [{ ...payload.files[0], content: 'page v2' }] });
  ok('re-ship (changed): new commit on the same branch and PR', !changed.body.unchanged && changed.body.prNumber === 1 && gh.pulls.length === 1);

  const outside = await call('POST', '/v1/ship', { ...payload, files: [{ path: '.github/workflows/ci.yml', content: 'x' }] });
  ok('refuses files outside the feature folder', outside.status === 400 && /refusing to write/.test(outside.body.error));
  const traversal = await call('POST', '/v1/ship', { ...payload, files: [{ path: 'src/app/features/team-members/../../../.github/x', content: 'x' }] });
  ok('refuses path traversal', traversal.status === 400);
  const mainBranch = await call('POST', '/v1/ship', { ...payload, designBranch: 'main' });
  ok('refuses a branch that is not design/<feature>', mainBranch.status === 400);
  const stranger = await call('POST', '/v1/ship', { ...payload, figmaUserId: 'figma-2' });
  ok('refuses designers without a token', stranger.status === 403);
  const noBase = await call('POST', '/v1/ship', { ...payload, feature: 'billing', designBranch: 'design/billing', projectBranch: 'feature/billing', files: [{ path: 'src/app/features/billing/a.ts', content: 'x' }] });
  ok('refuses when the project branch does not exist', noBase.status === 409);
  ok('no ref update was ever forced', gh.calls.filter(c => c.method === 'PATCH' && c.path.includes('/git/refs/')).every(c => c.body.force === false));
} finally {
  server.close();
}
console.log(failures ? `\n${failures} service check(s) failed.` : '\nAll service checks passed.');
process.exit(failures ? 1 : 0);
