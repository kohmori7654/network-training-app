'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Check, AlertCircle, Copy } from 'lucide-react';

interface Props {
    json: string;
    type: 'success' | 'error';
    onClose: () => void;
}

/**
 * JSONのエクスポート結果を表示するモーダル。
 * 成功時：コピー完了の報告とJSONの表示（念のため）
 * 失敗時：コピー失敗の報告と手動コピー/ダウンロードの誘導
 */
export default function JsonResultModal({ json, type, onClose }: Props) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isCopied, setIsCopied] = useState(false);

    useEffect(() => {
        // モーダルが開いた時にフォーカスし、可能なら全選択
        textareaRef.current?.focus();
        textareaRef.current?.select();
    }, []);

    const handleCopy = async () => {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(json);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            } catch (e) {
                console.error('Copy failed', e);
            }
        }
        // フォールバック: テキストエリアを選択してコピーコマンド
        textareaRef.current?.select();
        document.execCommand('copy');
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

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

    const isSuccess = type === 'success';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
                {/* ヘッダー */}
                <div className={`flex justify-between items-center px-4 py-3 border-b border-slate-700 shrink-0 ${isSuccess ? 'bg-teal-900/20' : 'bg-red-900/20'}`}>
                    <div className="flex items-center gap-2">
                        {isSuccess ? <Check className="text-teal-400" size={20} /> : <AlertCircle className="text-red-400" size={20} />}
                        <h3 className="text-lg font-bold text-white">
                            {isSuccess ? 'JSONをコピーしました' : 'JSONを取得できませんでした'}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors p-1"
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 説明 */}
                <div className="px-4 py-3 bg-slate-800 shrink-0">
                    <p className="text-sm text-slate-300">
                        {isSuccess
                            ? 'クリップボードにコピーされています。念のため以下のテキストを確認するか、ダウンロードして保存してください。'
                            : '埋め込み表示などの制限により、クリップボードへの自動コピーができませんでした。下のテキストを手動でコピーするか、ダウンロードしてください。'}
                    </p>
                </div>

                {/* JSON テキストエリア */}
                <div className="flex-1 min-h-0 px-4 pb-0">
                    <textarea
                        ref={textareaRef}
                        readOnly
                        value={json}
                        className={`w-full h-full min-h-[150px] p-3 bg-slate-900 border rounded text-slate-200 font-mono text-xs resize-none focus:outline-none focus:ring-2 focus:border-transparent ${isSuccess ? 'border-teal-500/30 focus:ring-teal-500' : 'border-red-500/30 focus:ring-red-500'}`}
                        spellCheck={false}
                        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    />
                </div>

                {/* アクションボタン */}
                <div className="flex justify-end gap-3 px-4 py-3 border-t border-slate-700 shrink-0 bg-slate-800 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                    >
                        閉じる
                    </button>

                    <button
                        onClick={handleCopy}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors border border-slate-600"
                    >
                        {isCopied ? <Check size={16} /> : <Copy size={16} />}
                        {isCopied ? 'コピー完了' : '再度コピー'}
                    </button>

                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded transition-colors shadow-lg shadow-teal-900/20"
                    >
                        <Download size={16} />
                        ダウンロード
                    </button>
                </div>
            </div>
        </div>
    );
}
