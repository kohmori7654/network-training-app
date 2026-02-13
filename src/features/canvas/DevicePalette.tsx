import React from 'react';
import { Monitor, Server, Layers, MessageSquare } from 'lucide-react';
import useNetworkStore from '@/stores/useNetworkStore';

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
    const [activeTab, setActiveTab] = React.useState<'devices' | 'memo'>('devices');
    const {
        memos,
        activeMemoId,
        setActiveMemo,
        updateMemo,
        exportToJson,
        devices,
        connections
    } = useNetworkStore();

    const activeMemo = memos.find(m => m.id === activeMemoId);
    const isJsonView = activeMemo?.type === 'json';

    const displayContent = React.useMemo(() => {
        if (isJsonView) {
            return exportToJson();
        }
        return activeMemo?.content || '';
    }, [isJsonView, exportToJson, activeMemo?.content, activeMemoId, devices, connections]); // dependencies for realtime update

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
                    onClick={() => setActiveTab('memo')}
                    className={`flex-1 py-3 text-xs font-bold text-center transition-colors ${activeTab === 'memo'
                        ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                >
                    メモ
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {activeTab === 'devices' ? (
                    <div className="flex flex-col gap-4 p-4">
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
                    <div className="flex flex-col h-full bg-slate-800 p-2 gap-2">
                        <select
                            value={activeMemoId}
                            onChange={(e) => setActiveMemo(e.target.value)}
                            className="w-full p-2 bg-slate-900 text-white text-xs rounded border border-slate-700 outline-none focus:border-blue-500 cursor-pointer"
                        >
                            {memos.map(memo => (
                                <option key={memo.id} value={memo.id}>
                                    {memo.title}
                                </option>
                            ))}
                        </select>
                        <textarea
                            value={displayContent}
                            onChange={(e) => {
                                if (!isJsonView && activeMemo) {
                                    updateMemo(activeMemo.id, e.target.value);
                                }
                            }}
                            readOnly={isJsonView || activeMemo?.readOnly}
                            placeholder="ここにメモを入力できます。&#13;&#10;内容はJSONに保存されます。"
                            className={`flex-1 w-full bg-slate-900 p-3 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 border-none ${isJsonView ? 'text-green-400 font-mono' : 'text-slate-300'
                                }`}
                            style={{ lineHeight: '1.5' }}
                        />
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
