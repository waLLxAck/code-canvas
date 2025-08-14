import * as vscode from 'vscode';
import * as fs from 'fs';

export type GraphNode = {
    id: string;
    label: string;
    path: string;
    lang: 'ts' | 'js' | 'tsx' | 'jsx' | 'py' | 'other';
};

export type EdgeLink = { symbolName?: string; targetLine: number };

export type GraphEdge = {
    id: string;
    source: string;
    target: string;
    kind: 'import' | 'call' | 'ref';
    sourceLine?: number;
    targetLine?: number;
    links?: EdgeLink[];
};

export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * Load the built webview HTML and rewrite asset URLs for the VS Code webview.
 * Handles both "/assets/..." and "./assets/...".
 */
export function htmlForWebview(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext
) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const index = vscode.Uri.joinPath(media, 'index.html');
    let html = fs.readFileSync(index.fsPath, 'utf8');

    const fix = (p: string) =>
        panel.webview
            .asWebviewUri(vscode.Uri.joinPath(media, p))
            .toString();

    html = html
        // rewrite src/href="./assets/..." and "/assets/..."
        .replace(/((?:src|href)=["'])\.?\/assets\//g, (_m, p1) => `${p1}${fix('assets/')}`)
        .replace(/__CSP__/g, panel.webview.cspSource);

    return html;
}
