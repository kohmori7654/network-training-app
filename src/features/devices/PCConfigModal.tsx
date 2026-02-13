'use client';

import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import useNetworkStore from '@/stores/useNetworkStore';
import { PC } from '@/stores/types';

interface PCConfigModalProps {
    open: boolean;
    deviceId: string | null;
    onClose: () => void;
}

export default function PCConfigModal({ open, deviceId, onClose }: PCConfigModalProps) {
    const { devices, updatePCConfig } = useNetworkStore();

    const [ipAddress, setIpAddress] = useState('');
    const [hostname, setHostname] = useState('');
    const [subnetMask, setSubnetMask] = useState('255.255.255.0');
    const [defaultGateway, setDefaultGateway] = useState('');

    // デバイスが変更されたらフォームを更新
    useEffect(() => {
        if (deviceId) {
            const device = devices.find((d) => d.id === deviceId);
            if (device && device.type === 'pc') {
                const pc = device as PC;
                setIpAddress(pc.ipAddress || '');
                setHostname(pc.hostname || '');
                setSubnetMask(pc.subnetMask || '255.255.255.0');
                setDefaultGateway(pc.defaultGateway || '');
            }
        }
    }, [deviceId, devices]);

    if (!open || !deviceId) return null;

    const device = devices.find((d) => d.id === deviceId);
    if (!device || device.type !== 'pc') return null;

    const handleSave = () => {
        updatePCConfig(deviceId, {
            hostname,
            ipAddress,
            subnetMask,
            defaultGateway,
        });
        onClose();
    };

    // 簡易IPアドレス検証
    const isValidIp = (ip: string) => {
        if (!ip) return true; // 空は許可
        const pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!pattern.test(ip)) return false;
        const parts = ip.split('.').map(Number);
        return parts.every((p) => p >= 0 && p <= 255);
    };

    const isFormValid = isValidIp(ipAddress) && isValidIp(subnetMask) && isValidIp(defaultGateway) && hostname.trim() !== '';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-[400px]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                    <h3 className="text-lg font-bold text-white">
                        PC設定 - {device.hostname}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">
                            ホスト名
                        </label>
                        <input
                            type="text"
                            value={hostname}
                            onChange={(e) => setHostname(e.target.value)}
                            placeholder="PC-1"
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">
                            IPアドレス
                        </label>
                        <input
                            type="text"
                            value={ipAddress}
                            onChange={(e) => setIpAddress(e.target.value)}
                            placeholder="192.168.1.10"
                            className={`w-full px-3 py-2 bg-slate-700 border rounded-md text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isValidIp(ipAddress) ? 'border-slate-600' : 'border-red-500'
                                }`}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">
                            サブネットマスク
                        </label>
                        <input
                            type="text"
                            value={subnetMask}
                            onChange={(e) => setSubnetMask(e.target.value)}
                            placeholder="255.255.255.0"
                            className={`w-full px-3 py-2 bg-slate-700 border rounded-md text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isValidIp(subnetMask) ? 'border-slate-600' : 'border-red-500'
                                }`}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">
                            デフォルトゲートウェイ
                        </label>
                        <input
                            type="text"
                            value={defaultGateway}
                            onChange={(e) => setDefaultGateway(e.target.value)}
                            placeholder="192.168.1.1"
                            className={`w-full px-3 py-2 bg-slate-700 border rounded-md text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isValidIp(defaultGateway) ? 'border-slate-600' : 'border-red-500'
                                }`}
                        />
                    </div>

                    <div className="text-xs text-slate-500">
                        <p>MACアドレス: {(device as PC).macAddress}</p>
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
                        onClick={handleSave}
                        disabled={!isFormValid}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Save size={16} />
                        保存
                    </button>
                </div>
            </div>
        </div>
    );
}
