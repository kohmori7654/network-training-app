'use client';

import React, { memo, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Monitor } from 'lucide-react';
import { PC } from '@/stores/types';

interface PCNodeProps {
    data: {
        device: PC;
    };
    selected?: boolean;
}

declare global {
    interface Window {
        openPCConfigModal?: (deviceId: string) => void;
    }
}

function PCNode({ data, selected }: PCNodeProps) {
    const device = data.device;
    const isConnected = device.ports[0]?.connectedTo !== null;
    const hasIp = device.ipAddress && device.ipAddress.length > 0;

    const handleDoubleClick = useCallback(() => {
        if (typeof window !== 'undefined' && window.openPCConfigModal) {
            window.openPCConfigModal(device.id);
        }
    }, [device.id]);

    return (
        <div
            onDoubleClick={handleDoubleClick}
            className={`
        px-4 py-3 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800
        border-2 ${selected ? 'border-yellow-400' : 'border-slate-400'}
        shadow-lg shadow-slate-900/50
        min-w-[120px]
        cursor-pointer
      `}
        >
            <Handle
                type="target"
                position={Position.Top}
                id="t-top"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300"
            />
            <Handle
                type="source"
                position={Position.Top}
                id="s-top"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300 opacity-0"
            />

            <Handle
                type="target"
                position={Position.Left}
                id="t-left"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300"
            />
            <Handle
                type="source"
                position={Position.Left}
                id="s-left"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300 opacity-0"
            />

            <div className="flex items-center gap-2 mb-2">
                <Monitor className="text-slate-200" size={20} />
                <span className="text-white font-bold text-sm">{device.hostname}</span>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
                <div className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    <span>eth0: {isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
                {hasIp ? (
                    <>
                        <div>IP: {device.ipAddress}</div>
                        <div>GW: {device.defaultGateway || 'N/A'}</div>
                    </>
                ) : (
                    <div className="text-yellow-400">⚠️ IPアドレス未設定</div>
                )}
            </div>

            <div className="mt-2 text-xs text-slate-500 text-center">
                ダブルクリックで設定
            </div>

            <Handle
                type="source"
                position={Position.Bottom}
                id="s-bottom"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300"
            />
            <Handle
                type="target"
                position={Position.Bottom}
                id="t-bottom"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300 opacity-0"
            />

            <Handle
                type="source"
                position={Position.Right}
                id="s-right"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300"
            />
            <Handle
                type="target"
                position={Position.Right}
                id="t-right"
                className="w-3 h-3 bg-orange-500 border-2 border-orange-300 opacity-0"
            />
        </div>
    );
}

export default memo(PCNode);
