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
    return (
        <div className="w-52 bg-slate-900 border-r border-slate-700 p-4 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-white mb-2">デバイス</h2>
            <p className="text-xs text-slate-400 mb-4">
                キャンバスにドラッグ＆ドロップ
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

            <div className="mt-auto">
                <a
                    href="https://docs.google.com/forms/d/e/1FAIpQLScT4ACzc0oRbFXxloKq49WZVOA5TEFi5a_uSQ9i4zlaqCDk4w/viewform?usp=header"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full p-2 mb-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded transition-colors shadow-md"
                >
                    <MessageSquare size={16} />
                    <span>コンタクト/バグ報告</span>
                </a>

                <div className="text-xs text-slate-500 border-t border-slate-700 pt-4">
                    <p className="mb-1">💡 ヒント:</p>
                    <ul className="list-disc list-inside space-y-1">
                        <li>ノード間をドラッグして接続</li>
                        <li>PCはダブルクリックで設定</li>
                        <li>デバイスをクリックで詳細表示</li>
                    </ul>
                </div>
                <div className="text-xs text-slate-500 border-t border-slate-700 pt-4 mt-4">
                    <p className="mb-1">⌨️ ターミナル:</p>
                    <ul className="list-disc list-inside space-y-1">
                        <li><kbd className="bg-slate-700 px-1 rounded">Tab</kbd> コマンド補完</li>
                        <li><kbd className="bg-slate-700 px-1 rounded">?</kbd> ヘルプ表示</li>
                        <li><kbd className="bg-slate-700 px-1 rounded">↑↓</kbd> コマンド履歴</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
