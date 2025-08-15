import React from 'react';
import { Handle, Position } from 'reactflow';

export function GroupNode({ data, selected }: { data: { label: string }, selected?: boolean }) {
    return (
        <div className="group-node" data-selected={selected ? 'true' : 'false'}>
            <div className="group-label label-fixed">{data.label}</div>
            <div className="hover-label label-constant">{data.label}</div>
        </div>
    );
}

export function FileNode({ data }: any) {
    return (
        <div className="file-node">
            <div className="file-node-header label-fixed">{data.label}</div>
            <div className="hover-label label-constant">{data.label}</div>
            <div className="file-node-body">{data.preview}</div>
            <Handle type="source" position={Position.Right} />
            <Handle type="target" position={Position.Left} />
        </div>
    );
}

export const nodeTypes = { file: FileNode, group: GroupNode } as const;