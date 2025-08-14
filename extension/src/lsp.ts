import * as vscode from 'vscode';

export async function getReferences(uri: vscode.Uri, position: vscode.Position) {
    const locs = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider', uri, position
    );
    return (locs || []).map(l => ({
        uri: l.uri.toString(),
        range: { start: l.range.start, end: l.range.end }
    }));
}

export async function getDefinition(uri: vscode.Uri, position: vscode.Position) {
    const defs = await vscode.commands.executeCommand<any>('vscode.executeDefinitionProvider', uri, position);
    return defs;
}

export async function getCallHierarchyIncoming(uri: vscode.Uri, position: vscode.Position) {
    const items = await vscode.commands.executeCommand<any>('vscode.prepareCallHierarchy', uri, position);
    if (!items || !items[0]) return [];
    const incoming = await vscode.commands.executeCommand<any>('vscode.provideIncomingCalls', items[0]);
    return incoming || [];
}

export async function getCallHierarchyOutgoing(uri: vscode.Uri, position: vscode.Position) {
    const items = await vscode.commands.executeCommand<any>('vscode.prepareCallHierarchy', uri, position);
    if (!items || !items[0]) return [];
    const outgoing = await vscode.commands.executeCommand<any>('vscode.provideOutgoingCalls', items[0]);
    return outgoing || [];
}

export type FlatSymbol = { name: string; kind: vscode.SymbolKind; range: vscode.Range };

export async function getDocumentSymbols(uri: vscode.Uri): Promise<FlatSymbol[]> {
    try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider', uri
        );
        if (!symbols || !Array.isArray(symbols)) return [];
        const out: FlatSymbol[] = [];
        const visit = (items: vscode.DocumentSymbol[]) => {
            for (const s of items) {
                out.push({ name: s.name, kind: s.kind, range: s.selectionRange || s.range });
                if (s.children && s.children.length) visit(s.children);
            }
        };
        visit(symbols);
        return out;
    } catch {
        return [];
    }
}