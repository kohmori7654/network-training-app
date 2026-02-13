'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Download, UploadCloud, RotateCcw, Network, ChevronRight, ChevronLeft, ClipboardCopy } from 'lucide-react';
import dynamic from 'next/dynamic';
import useNetworkStore from '@/stores/useNetworkStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import DevicePalette from '@/features/canvas/DevicePalette';
import PropertyPanel from '@/features/devices/PropertyPanel';
import TerminalPanel from '@/features/terminal/TerminalPanel';
import PCConfigModal from '@/features/devices/PCConfigModal';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { ModeSwitcher } from '@/features/templates/ModeSwitcher';
import { TemplateDashboard } from '@/features/templates/TemplateDashboard';
import { SaveTemplateModal } from '@/features/templates/SaveTemplateModal';
import JsonResultModal from '@/components/JsonResultModal';
import { Save } from 'lucide-react';

// React Flowはクライアントサイドのみでレンダリング
const NetworkCanvas = dynamic(
    () => import('@/features/canvas/NetworkCanvas'),
    { ssr: false }
);

type RightPanelTab = 'properties' | 'terminal';

const MIN_PANEL_WIDTH = 250;
const DEVICE_PALETTE_WIDTH = 208; // w-52 = 13rem
const MIN_CANVAS_WIDTH = 100;
const DEFAULT_PANEL_WIDTH = 320;

export default function MainLayout() {
    const { selectedDeviceId, exportToJson, importFromJson, resetState } = useNetworkStore();
    const { toast, confirm } = useNotificationStore();
    const [activeTab, setActiveTab] = useState<RightPanelTab>('properties');
    const [pcModalOpen, setPcModalOpen] = useState(false);
    const [pcModalDeviceId, setPcModalDeviceId] = useState<string | null>(null);

    // パネル状態
    const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
    const [isPanelOpen, setIsPanelOpen] = useState(true);
    const [isResizing, setIsResizing] = useState(false);

    const [isTerminalFullScreen, setIsTerminalFullScreen] = useState(false);

    // Template Mode State
    const { currentMode, isMockAuthEnabled, subscribeToTemplates } = useTemplateStore();
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    // Copy JSON 結果表示用モーダル
    const [jsonResult, setJsonResult] = useState<{ json: string; type: 'success' | 'error' } | null>(null);

    // Subscribe to templates for real-time updates
    useEffect(() => {
        const unsubscribe = subscribeToTemplates();
        return () => unsubscribe();
    }, [subscribeToTemplates]);

    // リサイズ用Ref
    const sidebarRef = useRef<HTMLDivElement>(null);

    // PCダブルクリック時のグローバルハンドラを登録
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.openPCConfigModal = (deviceId: string) => {
                setPcModalDeviceId(deviceId);
                setPcModalOpen(true);
            };
        }
        return () => {
            if (typeof window !== 'undefined') {
                delete window.openPCConfigModal;
            }
        };
    }, []);

    // リサイズ処理
    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback(
        (mouseMoveEvent: MouseEvent) => {
            if (isResizing) {
                const newWidth = document.body.clientWidth - mouseMoveEvent.clientX;
                const maxAllowedWidth = document.body.clientWidth - DEVICE_PALETTE_WIDTH - MIN_CANVAS_WIDTH;

                if (newWidth >= MIN_PANEL_WIDTH && newWidth <= maxAllowedWidth) {
                    setPanelWidth(newWidth);
                }
            }
        },
        [isResizing]
    );

    useEffect(() => {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [resize, stopResizing]);

    // エクスポート
    const handleExport = useCallback(() => {
        const json = exportToJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `network-topology-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [exportToJson]);

    // インポート
    const handleImport = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const text = await file.text();
            const success = importFromJson(text);
            if (success) {
                toast('トポロジをインポートしました');
            } else {
                toast('インポートに失敗しました。ファイル形式を確認してください。');
            }
        };
        input.click();
    }, [importFromJson]);

    // リセット
    const handleReset = useCallback(() => {
        confirm('【警告】\n\nすべての機器と設定を削除します。\nこの操作は取り消せません。\n\n本当に実行しますか？').then((ok) => {
            if (ok) resetState();
        });
    }, [resetState, confirm]);

    // クリップボードへコピー（iframe 埋め込み時も動作するよう execCommand フォールバック付き）
    const copyToClipboard = useCallback((text: string): Promise<boolean> => {
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        // iframe や古い環境では Clipboard API が使えない場合がある → フォールバック
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
        return Promise.resolve(ok);
    }, []);

    const handleCopyJson = useCallback(() => {
        const json = exportToJson();
        copyToClipboard(json).then((ok) => {
            if (ok) {
                // 成功時もポップアップで通知（ユーザー要望）
                setJsonResult({ json, type: 'success' });
            } else {
                // 失敗時（iframe等）
                setJsonResult({ json, type: 'error' });
            }
        });
    }, [exportToJson, copyToClipboard]);

    return (
        <div className="h-screen flex flex-col bg-slate-950 select-none">
            {/* ヘッダー */}
            <header className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                    <Network className="text-blue-400" size={28} />
                    <div>
                        <h1 className="text-lg font-bold text-white">Baudroie Virtual Campus</h1>
                        <p className="text-xs text-slate-500">※Chrome非推奨(ログ保存不可)、Edge,Firefox推奨</p>
                    </div>
                </div>

                <div className="mx-4">
                    <ModeSwitcher />
                </div>

                <div className="flex items-center gap-2">
                    {currentMode === 'free' && isMockAuthEnabled && (
                        <button
                            onClick={() => setIsSaveModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors mr-2"
                        >
                            <Save size={16} />
                            Save as Template
                        </button>
                    )}
                    <button
                        onClick={handleCopyJson}
                        className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded transition-colors"
                    >
                        <ClipboardCopy size={16} />
                        Copy JSON
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                    >
                        <Download size={16} />
                        Export JSON
                    </button>
                    <button
                        onClick={handleImport}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                    >
                        <UploadCloud size={16} />
                        Import JSON
                    </button>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                    >
                        <RotateCcw size={16} />
                        Reset
                    </button>
                </div>
            </header>

            {/* メインコンテンツ */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* 左: デバイスパレット */}
                <DevicePalette />

                {/* 中央: キャンバス or ダッシュボード */}
                <div className="flex-1 h-full relative flex flex-col">
                    {currentMode === 'preset' ? (
                        <TemplateDashboard />
                    ) : (
                        <NetworkCanvas />
                    )}

                    {/* 折り畳み展開ボタン（パネルが閉じているとき表示 - Free Mode Only） */}
                    {!isPanelOpen && currentMode === 'free' && (
                        <button
                            onClick={() => setIsPanelOpen(true)}
                            className="absolute top-4 right-0 bg-slate-800 text-blue-400 p-2 rounded-l-md border border-r-0 border-slate-600 shadow-md hover:bg-slate-700 z-10 transition-colors"
                            title="パネルを展開"
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                </div>

                {/* 右: プロパティ/ターミナルパネル (Free Mode Only) */}
                {isPanelOpen && currentMode === 'free' && (
                    <div
                        ref={sidebarRef}
                        className="flex h-full relative"
                        style={{ width: panelWidth }}
                    >
                        {/* リサイズハンドル */}
                        <div
                            className="w-1 cursor-col-resize hover:bg-blue-500 bg-slate-800 transition-colors absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center group"
                            onMouseDown={startResizing}
                        >
                            <div className="h-8 w-1 bg-slate-600 group-hover:bg-blue-300 rounded-full" />
                        </div>

                        {/* パネル本体 */}
                        <div className="flex-1 bg-slate-900 border-l border-slate-700 flex flex-col min-w-0">
                            {/* タブと制御ボタン */}
                            <div className="flex items-center border-b border-slate-700 bg-slate-900 pr-1">
                                <div className="flex-1 flex">
                                    <button
                                        onClick={() => setActiveTab('properties')}
                                        className={`flex-1 py-2 text-sm font-medium transition-colors ${activeTab === 'properties'
                                            ? 'text-blue-400 border-b-2 border-blue-400'
                                            : 'text-slate-400 hover:text-white'
                                            }`}
                                    >
                                        プロパティ
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('terminal')}
                                        className={`flex-1 py-2 text-sm font-medium transition-colors ${activeTab === 'terminal'
                                            ? 'text-blue-400 border-b-2 border-blue-400'
                                            : 'text-slate-400 hover:text-white'
                                            }`}
                                    >
                                        ターミナル
                                    </button>
                                </div>

                                {/* 折り畳みボタン */}
                                <button
                                    onClick={() => setIsPanelOpen(false)}
                                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded mx-1 transition-colors"
                                    title="パネルを折り畳む"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>

                            {/* パネル内容 */}
                            <div className="flex-1 overflow-hidden">
                                {activeTab === 'properties' ? (
                                    <PropertyPanel />
                                ) : (
                                    /* 全画面モード時は通常パネルにターミナルを表示しない */
                                    !isTerminalFullScreen && (
                                        <TerminalPanel
                                            deviceId={selectedDeviceId}
                                            isFullScreen={false}
                                            onToggleFullScreen={() => setIsTerminalFullScreen(true)}
                                        />
                                    )
                                )}
                                {/* 全画面モード中のプレースホルダー */}
                                {activeTab === 'terminal' && isTerminalFullScreen && (
                                    <div className="h-full flex items-center justify-center text-slate-500">
                                        <p className="text-sm">ターミナルは全画面表示中です</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* PC設定モーダル */}
            <PCConfigModal
                open={pcModalOpen}
                deviceId={pcModalDeviceId}
                onClose={() => {
                    setPcModalOpen(false);
                    setPcModalDeviceId(null);
                }}
            />

            {/* テンプレート保存モーダル */}
            {isSaveModalOpen && (
                <SaveTemplateModal onClose={() => setIsSaveModalOpen(false)} />
            )}

            {/* Copy JSON 結果モーダル */}
            {jsonResult && (
                <JsonResultModal
                    json={jsonResult.json}
                    type={jsonResult.type}
                    onClose={() => setJsonResult(null)}
                />
            )}

            {/* リサイズ中のオーバーレイ（操作感をスムーズにするため） */}
            {isResizing && (
                <div className="fixed inset-0 z-50 cursor-col-resize" />
            )}

            {/* ターミナル全画面表示（左カラム・デバイスパレットは覆わない: left-52 = w-52 と揃える） */}
            {isTerminalFullScreen && (
                <div className="fixed left-52 top-0 right-0 bottom-0 z-40 bg-black">
                    <TerminalPanel
                        deviceId={selectedDeviceId}
                        isFullScreen={true}
                        onToggleFullScreen={() => setIsTerminalFullScreen(false)}
                    />
                </div>
            )}
        </div>
    );
}
