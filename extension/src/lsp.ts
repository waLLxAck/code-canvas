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