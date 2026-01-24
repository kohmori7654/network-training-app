'use client';

import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Layers } from 'lucide-react';
import { L3Switch, HsrpState } from '@/stores/types';

interface L3SwitchNodeProps {
    data: {
        device: L3Switch;
    };
    selected?: boolean;
}

// HSRP状態に応じた色
const getHsrpBadgeColor = (state: HsrpState['state']) => {
    switch (state) {
        case 'active':
            return 'bg-green-500 text-white';
        case 'standby':
            return 'bg-yellow-500 text-black';
        case 'listen':
            return 'bg-blue-400 text-white';
        case 'speak':
            return 'bg-orange-400 text-white';
        default:
            return 'bg-gray-500 text-white';
    }
};

const getHsrpStateLabel = (state: HsrpState['state']) => {
    const labels: Record<HsrpState['state'], string> = {
        'init': 'Init',
        'learn': 'Learn',
        'listen': 'Listen',
        'speak': 'Speak',
        'standby': 'Standby',
        'active': 'Active',
    };
    return labels[state] || state;
};

function L3SwitchNode({ data, selected }: L3SwitchNodeProps) {
    const device = data.device;
    const connectedPorts = device.ports.filter(p => p.connectedTo !== null).length;

    const hsrpGroups = device.hsrpGroups || []; // 安全なアクセス
    const primaryHsrp = hsrpGroups[0]; // 最初のHSRPグループを表示

    return (
        <div
            className={`
        px-4 py-3 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800
        border-2 ${selected ? 'border-yellow-400' : 'border-blue-400'}
        shadow-lg shadow-blue-900/50
        min-w-[150px]
      `}
        >
            <Handle
                type="target"
                position={Position.Top}
                id="t-top"
                className="w-3 h-3 bg-green-500 border-2 border-green-300"
            />
            <Handle
                type="source"
                position={Position.Top}
                id="s-top"
                className="w-3 h-3 bg-green-500 border-2 border-green-300 pointer-events-none opacity-0" // Overlap, primarily for receiving? No, let's keep separate visuals or logical stack?
            />
            {/* Logic: Single handle can be source/target if unstyled? React Flow requires type. 
               If provided multiple handles on same position, user might grab wrong one. 
               Better: offset them or just place them close?
               Actually, for UX, usually 1 handle per side is best. 
               But type must be fixed. 
               If I want bidirectional:
               Use two handles on same position. 
            */}
            <Handle
                type="target"
                position={Position.Left}
                id="t-left"
                className="w-3 h-3 bg-green-500 border-2 border-green-300"
            />
            <Handle
                type="source"
                position={Position.Left}
                id="s-left"
                className="w-3 h-3 bg-green-500 border-2 border-green-300 opacity-0" // Invisible source handle on top
            />

            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Layers className="text-blue-200" size={20} />
                    <span className="text-white font-bold text-sm">{device.hostname}</span>
                </div>
                {primaryHsrp && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getHsrpBadgeColor(primaryHsrp.state)}`}>
                        {getHsrpStateLabel(primaryHsrp.state)}
                    </span>
                )}
            </div>

            <div className="text-xs text-blue-200 space-y-1">
                <div>Model: {device.model}</div>
                <div>Ports: {connectedPorts}/24 接続中</div>
                {primaryHsrp && (
                    <>
                        <div className="border-t border-blue-500/50 pt-1 mt-1">
                            <div className="flex items-center gap-1">
                                <span className={`w-2 h-2 rounded-full ${primaryHsrp.state === 'active' ? 'bg-green-400 animate-pulse' : primaryHsrp.state === 'standby' ? 'bg-yellow-400' : 'bg-gray-400'}`}></span>
                                <span>HSRP Grp {primaryHsrp.group}</span>
                            </div>
                            <div className="text-blue-300/80">
                                VIP: {primaryHsrp.virtualIp || 'N/A'}
                            </div>
                            <div className="text-blue-300/80">
                                Pri: {primaryHsrp.priority} {primaryHsrp.preempt ? '(P)' : ''}
                            </div>
                        </div>
                    </>
                )}
                {!primaryHsrp && hsrpGroups.length === 0 && (
                    <div className="text-blue-300/60 italic">HSRP未設定</div>
                )}
            </div>

            <Handle
                type="source"
                position={Position.Bottom}
                id="s-bottom"
                className="w-3 h-3 bg-green-500 border-2 border-green-300"
            />
            <Handle
                type="target"
                position={Position.Bottom}
                id="t-bottom"
                className="w-3 h-3 bg-green-500 border-2 border-green-300 opacity-0"
            />

            <Handle
                type="source"
                position={Position.Right}
                id="s-right"
                className="w-3 h-3 bg-green-500 border-2 border-green-300"
            />
            <Handle
                type="target"
                position={Position.Right}
                id="t-right"
                className="w-3 h-3 bg-green-500 border-2 border-green-300 opacity-0"
            />
        </div>
    );
}

export default memo(L3SwitchNode);
