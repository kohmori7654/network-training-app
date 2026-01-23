'use client';

import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Server } from 'lucide-react';
import { L2Switch } from '@/stores/types';

interface L2SwitchNodeProps {
    data: {
        device: L2Switch;
    };
    selected?: boolean;
}

function L2SwitchNode({ data, selected }: L2SwitchNodeProps) {
    const device = data.device;
    const connectedPorts = device.ports.filter(p => p.connectedTo !== null).length;

    return (
        <div
            className={`
        px-4 py-3 rounded-lg bg-gradient-to-br from-emerald-600 to-emerald-800
        border-2 ${selected ? 'border-yellow-400' : 'border-emerald-400'}
        shadow-lg shadow-emerald-900/50
        min-w-[140px]
      `}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="w-3 h-3 bg-blue-500 border-2 border-blue-300"
            />

            <div className="flex items-center gap-2 mb-2">
                <Server className="text-emerald-200" size={20} />
                <span className="text-white font-bold text-sm">{device.hostname}</span>
            </div>

            <div className="text-xs text-emerald-200 space-y-1">
                <div>Model: {device.model}</div>
                <div>Ports: {connectedPorts}/24 接続中</div>
                <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                    <span>STP: {device.stpState.mode}</span>
                </div>
            </div>

            <Handle
                type="source"
                position={Position.Bottom}
                className="w-3 h-3 bg-blue-500 border-2 border-blue-300"
            />
        </div>
    );
}

export default memo(L2SwitchNode);
