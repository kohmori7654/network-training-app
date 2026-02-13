'use client';

import React, { useEffect, useRef } from 'react';
import { X, Download } from 'lucide-react';

interface Props {
    json: string;
    onClose: () => void;
}

/**
 * クリップボードコピーが失敗した場合に表示するフォールバックモーダル。
 * 埋め込み iframe 環境では Clipboard API が制限されるため、
 * ユーザーが手動で選択・コピーするか、ダウンロードで取得できるようにする。
 */
export default function CopyJsonFallbackModal({ json, onClose }: Props) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
    }, []);

    const handleDownload = () => {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `network-topology-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-[90vw] max-w-2xl max-h-[85vh] flex flex-col">
                {/* ヘッダー */}
                <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700 shrink-0">
                    <h3 className="text-lg font-bold text-white">
                        JSON を取得する
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors p-1"
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 説明 */}
                <p className="px-4 py-2 text-sm text-slate-400 shrink-0">
                    埋め込み表示のためクリップボードへの自動コピーができませんでした。
                    下のテキストを選択して Ctrl+C でコピーするか、ダウンロードをご利用ください。
                </p>

                {/* JSON テキストエリア */}
                <textarea
                    ref={textareaRef}
                    readOnly
                    value={json}
                    className="flex-1 min-h-[200px] p-4 m-4 mt-0 bg-slate-900 border border-slate-600 rounded text-slate-200 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    spellCheck={false}
                />

                {/* アクションボタン */}
                <div className="flex justify-end gap-3 px-4 py-3 border-t border-slate-700 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                    >
                        閉じる
                    </button>
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded transition-colors"
                    >
                        <Download size={16} />
                        ダウンロード
                    </button>
                </div>
            </div>
        </div>
    );
}
