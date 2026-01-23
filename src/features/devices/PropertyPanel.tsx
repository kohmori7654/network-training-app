'use client';

import React from 'react';
import useNetworkStore from '@/stores/useNetworkStore';
import { Device, L2Switch, L3Switch, PC } from '@/stores/types';
import { Server, Layers, Monitor, Trash2 } from 'lucide-react';

export default function PropertyPanel() {
    const { devices, selectedDeviceId, removeDevice, disconnectPort } = useNetworkStore();

    const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

    if (!selectedDevice) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500">
                <p className="text-sm">デバイスを選択してください</p>
            </div>
        );
    }

    const handleDelete = () => {
        if (confirm(`${selectedDevice.hostname} を削除しますか？`)) {
            removeDevice(selectedDevice.id);
        }
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
                        <DetailItem label="MACテーブル" value={`${device.macAddressTable.length} エントリ`} />
                    </>
                );
            }
            case 'l3-switch': {
                const device = selectedDevice as L3Switch;
                return (
                    <>
                        <DetailItem label="モデル" value={device.model} />
                        <DetailItem label="ルート数" value={device.routingTable.length.toString()} />
                        <DetailItem label="ARPエントリ" value={device.arpTable.length.toString()} />
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
        // 全ポートを表示対象にする（未接続も含めるため）が、今の要件では接続ポートの管理が主
        // ただ「ポート追加」が見えるように、既存ポート一覧の下に追加ボタンを置く形にする

        const connectedPorts = selectedDevice.ports.filter((p) => p.connectedTo !== null);

        return (
            <div className="mt-4">
                <h4 className="text-sm font-medium text-slate-300 mb-2">
                    ポート ({connectedPorts.length}/{selectedDevice.ports.length} 接続中)
                </h4>

                {/* 接続済みポート一覧（切断ボタン付き） */}
                <div className="max-h-40 overflow-y-auto space-y-1 mb-2">
                    {connectedPorts.length > 0 ? (
                        connectedPorts.map((port) => {
                            // 接続先デバイスとポートを特定する
                            const targetDevice = devices.find((d) => d.ports.some((p) => p.id === port.connectedTo));
                            const targetPort = targetDevice?.ports.find((p) => p.id === port.connectedTo);

                            return (
                                <div
                                    key={port.id}
                                    className="flex items-center justify-between px-2 py-1 bg-slate-800 rounded text-xs group"
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${port.status === 'up' ? 'bg-green-400' : 'bg-red-400'}`} />
                                            <span className="text-slate-300 font-medium">{port.name}</span>
                                        </div>
                                        {targetDevice && targetPort && (
                                            <div className="pl-4 text-[10px] text-slate-500 flex items-center gap-1">
                                                <span>→</span>
                                                <span className="text-slate-400">{targetDevice.hostname}</span>
                                                <span className="text-slate-600">({targetPort.name})</span>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (confirm(`${port.name} の接続を切断しますか？`)) {
                                                disconnectPort(selectedDevice.id, port.id);
                                            }
                                        }}
                                        className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="接続を切断"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })
                    ) : (
                        <p className="text-xs text-slate-500">接続されているポートはありません</p>
                    )}
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
