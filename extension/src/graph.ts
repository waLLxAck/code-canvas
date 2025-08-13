import fg from 'fast-glob';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { Graph } from './util';

const JS_GLOB = ['**/*.{js,jsx,ts,tsx}'];
const PY_GLOB = ['**/*.py'];

type Index = {
    nodes: Set<string>;
    imports: Map<string, Set<string>>; // file -> imported file paths (resolved)
    lang: Map<string, 'js' | 'ts' | 'py' | 'other'>;
};

export async function buildIndex(root: string): Promise<Index> {
    const excludes: string[] = vscode.workspace.getConfiguration('codeCanvas').get('excludeGlobs') || [];
    const files = Array.from(new Set([
        ...await fg(JS_GLOB, { cwd: root, absolute: true, ignore: excludes }),
        ...await fg(PY_GLOB, { cwd: root, absolute: true, ignore: excludes }),
    ]));

    const lang = new Map<string, 'js' | 'ts' | 'py' | 'other'>();
    for (const f of files) {
        lang.set(
            f,
            f.endsWith('.py') ? 'py'
                : (f.endsWith('.ts') || f.endsWith('.tsx')) ? 'ts'
                    : 'js'
        );
    }

    const imports = new Map<string, Set<string>>();
    for (const f of files) {
        const src = safeRead(f);
        const specs = lang.get(f) === 'py' ? parsePyImports(src) : parseJsTsImports(src);
        const targets = new Set<string>();
        for (const s of specs) {
            const r = lang.get(f) === 'py' ? resolvePy(root, f, s) : resolveJsTs(root, f, s);
            if (r) targets.add(r);
        }
        imports.set(f, targets);
    }

    return { nodes: new Set(files), imports, lang };
}

// Build a subgraph with BFS from seeds up to max nodes/edges.
export function subgraph(index: Index, seeds: string[], maxNodes: number): Graph {
    const seen = new Set<string>();
    const q: string[] = [];
    for (const s of seeds) if (index.nodes.has(s)) { seen.add(s); q.push(s); }

    // If no valid seeds, pick up to 10 random-ish files to start
    if (q.length === 0) {
        for (const f of Array.from(index.nodes).slice(0, Math.min(10, index.nodes.size))) {
            seen.add(f); q.push(f);
        }
    }

    while (q.length && seen.size < maxNodes) {
        const cur = q.shift()!;
        const out = index.imports.get(cur) || new Set();
        for (const t of out) {
            if (seen.size >= maxNodes) break;
            if (!seen.has(t)) { seen.add(t); q.push(t); }
        }
        // add a bit of reverse reachability (files importing cur)
        for (const [f, outs] of index.imports) {
            if (outs.has(cur) && !seen.has(f)) {
                if (seen.size >= maxNodes) break;
                seen.add(f); q.push(f);
            }
        }
    }

    const nodes = Array.from(seen).map(f => ({
        id: makeSafeId(f),
        label: path.basename(f),
        path: f,
        lang: (index.lang.get(f) || 'other') as any
    }));

    const nodeIdByPath = new Map<string, string>();
    for (const n of nodes) nodeIdByPath.set(n.path, n.id);

    const edges: Graph['edges'] = [];
    for (const s of seen) {
        for (const t of (index.imports.get(s) || new Set())) {
            if (seen.has(t)) {
                const sid = nodeIdByPath.get(s)!;
                const tid = nodeIdByPath.get(t)!;
                edges.push({ id: `e_${hashString(s + '->' + t)}`, source: sid, target: tid, kind: 'import' });
            }
        }
    }

    return { nodes, edges };
}

function safeRead(p: string) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function parseJsTsImports(code: string): string[] {
    const out: string[] = [];
    const r1 = /import\s+[^'\"]+from\s+['\"]([^'\"]+)['\"]/g;
    const r2 = /import\s+['\"]([^'\"]+)['\"]/g;
    const r3 = /export\s+[^'\"]*\s+from\s+['\"]([^'\"]+)['\"]/g;
    let m: RegExpExecArray | null;
    for (const r of [r1, r2, r3]) while ((m = r.exec(code))) out.push(m[1]);
    return out;
}
function parsePyImports(code: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    const r1 = /^\s*import\s+([\w\.]+)/gm;
    const r2 = /^\s*from\s+([\w\.]+)\s+import\s+[\w\*,\s]+/gm;
    while ((m = r1.exec(code))) out.push(m[1]);
    while ((m = r2.exec(code))) out.push(m[1]);
    return out;
}
function resolveJsTs(root: string, fromFile: string, spec: string): string | undefined {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return; // skip packages
    const base = path.resolve(path.dirname(fromFile), spec);
    const tries = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
    for (const t of tries) { const p = base + t; if (fs.existsSync(p)) return p; }
}
function resolvePy(root: string, _from: string, mod: string): string | undefined {
    const parts = mod.split('.');
    const candidates = [
        path.resolve(root, ...parts) + '.py',
        path.resolve(root, ...parts, '__init__.py')
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
}

function hashString(input: string): string {
    let hash = 0 >>> 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
}

function makeSafeId(raw: string): string {
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `n_${safe}_${hashString(raw)}`;
}