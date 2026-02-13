'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import useNetworkStore from '@/stores/useNetworkStore';

interface PortSelectModalProps {
    open: boolean;
    onClose: () => void;
    sourceDeviceId: string;
    targetDeviceId: string;
    onSelect: (sourcePortId: string, targetPortId: string) => void;
}

export default function PortSelectModal({
    open,
    onClose,
    sourceDeviceId,
    targetDeviceId,
    onSelect,
}: PortSelectModalProps) {
    const { devices } = useNetworkStore();
    const [selectedSourcePort, setSelectedSourcePort] = useState<string>('');
    const [selectedTargetPort, setSelectedTargetPort] = useState<string>('');

    if (!open) return null;

    const sourceDevice = devices.find((d) => d.id === sourceDeviceId);
    const targetDevice = devices.find((d) => d.id === targetDeviceId);

    if (!sourceDevice || !targetDevice) return null;

    // 使用可能なポート（未接続のもののみ）
    const availableSourcePorts = sourceDevice.ports.filter((p) => !p.connectedTo);
    const availableTargetPorts = targetDevice.ports.filter((p) => !p.connectedTo);

    const handleConnect = () => {
        if (selectedSourcePort && selectedTargetPort) {
            onSelect(selectedSourcePort, selectedTargetPort);
            setSelectedSourcePort('');
            setSelectedTargetPort('');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-[500px] max-h-[80vh] overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                    <h3 className="text-lg font-bold text-white">ポート選択</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="p-4 space-y-4">
                    <p className="text-sm text-slate-400">
                        接続するポートを選択してください
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        {/* ソースデバイス */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                {sourceDevice.hostname}
                            </label>
                            <select
                                value={selectedSourcePort}
                                onChange={(e) => setSelectedSourcePort(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">ポートを選択...</option>
                                {availableSourcePorts.map((port) => (
                                    <option key={port.id} value={port.id}>
                                        {port.name}
                                    </option>
                                ))}
                            </select>
                            {availableSourcePorts.length === 0 && (
                                <p className="text-xs text-red-400 mt-1">
                                    使用可能なポートがありません
                                </p>
                            )}
                        </div>

                        {/* ターゲットデバイス */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                {targetDevice.hostname}
                            </label>
                            <select
                                value={selectedTargetPort}
                                onChange={(e) => setSelectedTargetPort(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">ポートを選択...</option>
                                {availableTargetPorts.map((port) => (
                                    <option key={port.id} value={port.id}>
                                        {port.name}
                                    </option>
                                ))}
                            </select>
                            {availableTargetPorts.length === 0 && (
                                <p className="text-xs text-red-400 mt-1">
                                    使用可能なポートがありません
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-700">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={handleConnect}
                        disabled={!selectedSourcePort || !selectedTargetPort}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        接続
                    </button>
                </div>
            </div>
        </div>
    );
}
