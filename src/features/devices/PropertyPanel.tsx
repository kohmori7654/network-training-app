'use client';

import React from 'react';
import useNetworkStore from '@/stores/useNetworkStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { Device, L2Switch, L3Switch, PC } from '@/stores/types';
import { Server, Layers, Monitor, Trash2 } from 'lucide-react';

export default function PropertyPanel() {
    const { devices, selectedDeviceId, removeDevice, disconnectPort } = useNetworkStore();
    const confirm = useNotificationStore((s) => s.confirm);

    const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

    if (!selectedDevice) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500">
                <p className="text-sm">デバイスを選択してください</p>
            </div>
        );
    }

    const handleDelete = () => {
        confirm(`${selectedDevice.hostname} を削除しますか？`).then((ok) => {
            if (ok) removeDevice(selectedDevice.id);
        });
    };

    const renderDeviceIcon = () => {
        switch (selectedDevice.type) {
            case 'l2-switch':
                return <Server className="text-emerald-400" size={24} />;
            case 'l3-switch':
                return <Layers className="text-blue-400" size={24} />;
            case 'pc':
                return <Monitor className="text-slate-400" size={24} />;
        }
    };

    const renderDetails = () => {
        switch (selectedDevice.type) {
            case 'l2-switch': {
                const device = selectedDevice as L2Switch;
                return (
                    <>
                        <DetailItem label="モデル" value={device.model} />
                        <DetailItem label="STPモード" value={device.stpState.mode} />
                        <DetailItem label="STPプライオリティ" value={device.stpState.priority.toString()} />
                        <DetailItem label="VLAN数" value={device.vlanDb.length.toString()} />
                        <DetailItem label="MACテーブル" value={`${(device.macAddressTable?.length || 0)} エントリ`} />
                    </>
                );
            }
            case 'l3-switch': {
                const device = selectedDevice as L3Switch;
                return (
                    <>
                        <DetailItem label="モデル" value={device.model} />
                        <DetailItem label="ルート数" value={device.routingTable.length.toString()} />
                        <DetailItem label="ARPエントリ" value={(device.arpTable?.length || 0).toString()} />
                        <DetailItem label="HSRPグループ" value={device.hsrpGroups.length.toString()} />
                        <DetailItem label="VLAN数" value={device.vlanDb.length.toString()} />
                    </>
                );
            }
            case 'pc': {
                const device = selectedDevice as PC;
                return (
                    <>
                        <DetailItem label="IPアドレス" value={device.ipAddress || '未設定'} />
                        <DetailItem label="サブネットマスク" value={device.subnetMask || '未設定'} />
                        <DetailItem label="デフォルトGW" value={device.defaultGateway || '未設定'} />
                        <DetailItem label="MACアドレス" value={device.macAddress} />
                    </>
                );
            }
        }
    };

    const renderPorts = () => {
        // 全ポートを表示対象にする
        const allPorts = selectedDevice.ports;
        const connectedCount = allPorts.filter((p) => !!p.connectedTo).length;

        return (
            <div className="mt-4">
                <h4 className="text-sm font-medium text-slate-300 mb-2">
                    ポート ({connectedCount}/{allPorts.length} 接続中)
                </h4>

                {/* ポート一覧（スクロール） */}
                <div className="max-h-60 overflow-y-auto space-y-1 mb-2 pr-1">
                    {allPorts.map((port) => {
                        const isConnected = !!port.connectedTo;
                        // 接続先デバイスとポートを特定する
                        const targetDevice = isConnected ? devices.find((d) => d.ports.some((p) => p.id === port.connectedTo)) : undefined;
                        const targetPort = targetDevice?.ports.find((p) => p.id === port.connectedTo);

                        return (
                            <div
                                key={port.id}
                                className={`flex items-center justify-between px-2 py-1 rounded text-xs group ${isConnected ? 'bg-slate-800' : 'bg-slate-900/50'}`}
                            >
                                <div className="flex flex-col gap-0.5 w-full">
                                    <div className="flex items-center gap-2">
                                        {/* LED Indicator Script */}
                                        {(() => {
                                            let ledClass = 'bg-slate-600'; // Default: Off/Down

                                            if (port.status === 'up') {
                                                if (selectedDevice.type === 'l2-switch' || selectedDevice.type === 'l3-switch') {
                                                    const sw = selectedDevice as (L2Switch | L3Switch);
                                                    const stpStatus = sw.stpState?.portStates?.[port.id];

                                                    if (stpStatus === 'blocking' || stpStatus === 'listening') {
                                                        ledClass = 'bg-amber-500'; // Amber: Blocking
                                                    } else if (stpStatus === 'learning') {
                                                        ledClass = 'bg-amber-500 animate-pulse'; // Blinking Amber: Learning
                                                    } else if (stpStatus === 'forwarding') {
                                                        ledClass = 'bg-green-500'; // Green: Forwarding
                                                    } else if (stpStatus === 'disabled') {
                                                        ledClass = 'bg-slate-600'; // Off: Disabled
                                                    } else {
                                                        ledClass = 'bg-green-500'; // Fallback Green if UP but no STP state
                                                    }
                                                } else {
                                                    // PC / Router (if added later)
                                                    ledClass = 'bg-green-500'; // Solid Green for Link Up
                                                }
                                            }

                                            // Optional: Add blink for activity if we had it, but for now STP states cover blinking
                                            return <span className={`w-2 h-2 rounded-full ${ledClass} shadow-[0_0_4px_rgba(0,0,0,0.5)]`} title={port.status === 'up' ? 'Link Up' : 'Link Down'} />;
                                        })()}
                                        <span className={`font-medium ${isConnected ? 'text-slate-300' : 'text-slate-500'}`}>{port.name}</span>
                                    </div>
                                    {isConnected && targetDevice && targetPort && (
                                        <div className="pl-4 text-[10px] text-slate-500 flex items-center gap-1">
                                            <span>→</span>
                                            <span className="text-slate-400">{targetDevice.hostname}</span>
                                            <span className="text-slate-600">({targetPort.name})</span>
                                        </div>
                                    )}
                                </div>
                                {isConnected ? (
                                    <button
                                        onClick={() => {
                                            confirm(`${port.name} の接続を切断しますか？`).then((ok) => {
                                                if (ok) disconnectPort(selectedDevice.id, port.id);
                                            });
                                        }}
                                        className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="接続を切断"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                ) : (
                                    <span className="text-[10px] text-slate-700">未使用</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 space-y-4">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {renderDeviceIcon()}
                    <div>
                        <h3 className="font-bold text-white">{selectedDevice.hostname}</h3>
                        <p className="text-xs text-slate-400">{selectedDevice.type}</p>
                    </div>
                </div>
                <button
                    onClick={handleDelete}
                    className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                    title="デバイスを削除"
                >
                    <Trash2 size={18} />
                </button>
            </div>

            {/* 詳細情報 */}
            <div className="space-y-2">
                {renderDetails()}
            </div>

            {/* ポート情報 */}
            {renderPorts()}
        </div>
    );
}

function DetailItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-slate-400">{label}</span>
            <span className="text-slate-200">{value}</span>
        </div>
    );
}
