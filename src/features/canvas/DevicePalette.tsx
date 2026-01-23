'use client';

import React from 'react';
import { Monitor, Server, Layers, MessageSquare } from 'lucide-react';

interface DevicePaletteItemProps {
    type: string;
    label: string;
    icon: React.ReactNode;
    description: string;
}

function DevicePaletteItem({ type, label, icon, description }: DevicePaletteItemProps) {
    const onDragStart = (event: React.DragEvent) => {
        event.dataTransfer.setData('application/device-type', type);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            className="flex flex-col items-center p-4 bg-slate-800 rounded-lg cursor-grab hover:bg-slate-700 transition-colors border border-slate-700 hover:border-blue-500"
        >
            <div className="text-blue-400 mb-2">{icon}</div>
            <span className="text-sm font-medium text-white">{label}</span>
            <span className="text-xs text-slate-400 text-center mt-1">{description}</span>
        </div>
    );
}

export default function DevicePalette() {
    const [activeTab, setActiveTab] = React.useState<'devices' | 'hints'>('devices');

    return (
        <div className="w-52 bg-slate-900 border-r border-slate-700 flex flex-col">
            {/* タブヘッダー */}
            <div className="flex border-b border-slate-700">
                <button
                    onClick={() => setActiveTab('devices')}
                    className={`flex-1 py-3 text-xs font-bold text-center transition-colors ${activeTab === 'devices'
                        ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                >
                    デバイス
                </button>
                <button
                    onClick={() => setActiveTab('hints')}
                    className={`flex-1 py-3 text-xs font-bold text-center transition-colors ${activeTab === 'hints'
                        ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                >
                    解説
                </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
                {activeTab === 'devices' ? (
                    <div className="flex flex-col gap-4">
                        <p className="text-xs text-slate-400 mb-2 text-center">
                            ドラッグ＆ドロップで配置
                        </p>

                        <DevicePaletteItem
                            type="l2-switch"
                            label="L2 Switch"
                            icon={<Server size={32} />}
                            description="Catalyst 2960-X"
                        />

                        <DevicePaletteItem
                            type="l3-switch"
                            label="L3 Switch"
                            icon={<Layers size={32} />}
                            description="Catalyst 3750-X"
                        />

                        <DevicePaletteItem
                            type="pc"
                            label="PC"
                            icon={<Monitor size={32} />}
                            description="端末"
                        />
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 text-slate-300">
                        <div>
                            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                                💡 操作解説
                            </h3>
                            <ul className="text-xs space-y-2 list-disc list-inside text-slate-400">
                                <li>ノード間をドラッグして接続</li>
                                <li>PCはダブルクリックで設定</li>
                                <li>デバイスをクリックで詳細表示</li>
                                <li>Export JSONでやりかけの内容を保存できます(Chrome非対応)</li>
                                <li>Import JSONで保存した内容を開くことができます</li>
                            </ul>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                                ⌨️ ターミナル操作
                            </h3>
                            <ul className="text-xs space-y-2 text-slate-400">
                                <li className="flex items-center gap-2">
                                    <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-white font-mono">Tab</kbd>
                                    <span>コマンド補完</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-white font-mono">?</kbd>
                                    <span>ヘルプ表示</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-white font-mono">↑↓</kbd>
                                    <span>コマンド履歴</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-slate-700 mt-auto">
                <a
                    href="https://docs.google.com/forms/d/e/1FAIpQLScT4ACzc0oRbFXxloKq49WZVOA5TEFi5a_uSQ9i4zlaqCDk4w/viewform?usp=header"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full p-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded transition-colors shadow-md"
                >
                    <MessageSquare size={16} />
                    <span>コンタクト/バグ報告</span>
                </a>
            </div>
        </div>
    );
}
