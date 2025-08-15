import React from 'react';
import { Handle, Position } from 'reactflow';

export function GroupNode({ data }: { data: { label: string } }) {
    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div className="group-label">{data.label}</div>
        </div>
    );
}

export function FileNode({ data }: any) {
    return (
        <div className="file-node">
            <div className="file-node-header">{data.label}</div>
            <div className="file-node-body">{data.preview}</div>
            <Handle type="source" position={Position.Right} />
            <Handle type="target" position={Position.Left} />
        </div>
    );
}

export const nodeTypes = { file: FileNode, group: GroupNode } as const;