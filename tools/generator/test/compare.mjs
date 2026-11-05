// Compare generated files with a reference (hand-made) tree, line by line.
// "kept" = share of generated lines that appear unchanged, in order, in the reference
// (what frontend keeps as is). "coverage" = share of reference lines the generator produced.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const norm = s => s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));

function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0];
}

export function compare(files, refRoot) {
  const rows = [];
  let gen = 0, kept = 0, ref = 0;
  for (const f of files) {
    const refPath = join(refRoot, f.path);
    const g = norm(f.content);
    const r = existsSync(refPath) ? norm(readFileSync(refPath, 'utf8')) : [];
    const k = lcs(g, r);
    rows.push({ file: f.path.replace(/^src\/app\//, ''), generated: g.length, reference: r.length, kept: k });
    gen += g.length; kept += k; ref += r.length;
  }
  return { rows, total: { generated: gen, reference: ref, kept, keptPct: kept / gen, coveragePct: kept / ref } };
}
