import * as vscode from 'vscode';

export async function getChangedFiles(): Promise<string[]> {
    // Prefer Git extension API if available
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt) {
        const api = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
        const repo = api.repositories[0];
        if (repo) {
            const files = [
                ...repo.state.workingTreeChanges,
                ...repo.state.mergeChanges,
                ...repo.state.indexChanges
            ].map(c => c.uri.fsPath);
            return Array.from(new Set(files));
        }
    }
    // Fallback: simple status parse
    try {
        const cp = await import('child_process');
        const { stdout } = cp.spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
        return stdout.split('\n').filter(Boolean).map(line => line.slice(3)).filter(Boolean);
    } catch { return []; }
}

export function watchGitState(onChange: () => void) {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) return () => { };
    const add = async () => {
        const api = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
        const repo = api.repositories[0];
        if (!repo) return () => { };
        const d1 = repo.state.onDidChange(onChange);
        const d2 = api.onDidOpenRepository(onChange);
        const d3 = api.onDidChangeState(onChange);
        return () => { d1.dispose(); d2.dispose(); d3.dispose(); };
    };
    add();
    return () => { };
}