'use client';

import React from 'react';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { X, CheckCircle, AlertCircle } from 'lucide-react';

/**
 * アプリ全体の alert/confirm をページ内モーダルで表示するオーバーレイ。
 * ブラウザのネイティブポップアップを使用せず、埋め込み環境でも安定して動作する。
 */
export default function NotificationOverlay() {
    const alertMessage = useNotificationStore((s) => s.alertMessage);
    const confirmState = useNotificationStore((s) => s.confirmState);
    const dismissToast = useNotificationStore((s) => s.dismissToast);
    const confirmOk = useNotificationStore((s) => s.confirmOk);
    const confirmCancel = useNotificationStore((s) => s.confirmCancel);

    return (
        <>
            {/* アラート（トースト）モーダル */}
            {alertMessage && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div
                        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-[90vw] max-w-md p-6"
                        role="alertdialog"
                        aria-labelledby="alert-title"
                        aria-describedby="alert-desc"
                    >
                        <div className="flex items-start gap-3">
                            <CheckCircle className="text-teal-400 shrink-0 mt-0.5" size={24} />
                            <div className="flex-1 min-w-0">
                                <p id="alert-desc" className="text-slate-200 text-sm whitespace-pre-wrap">
                                    {alertMessage}
                                </p>
                            </div>
                            <button
                                onClick={dismissToast}
                                className="text-slate-400 hover:text-white transition-colors p-1 shrink-0"
                                aria-label="閉じる"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={dismissToast}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded transition-colors"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 確認ダイアログモーダル */}
            {confirmState && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div
                        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-[90vw] max-w-md p-6"
                        role="alertdialog"
                        aria-labelledby="confirm-title"
                        aria-describedby="confirm-desc"
                        aria-modal="true"
                    >
                        <div className="flex items-start gap-3">
                            <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={24} />
                            <div className="flex-1 min-w-0">
                                <p id="confirm-desc" className="text-slate-200 text-sm whitespace-pre-wrap">
                                    {confirmState.message}
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={confirmCancel}
                                className="px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={confirmOk}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded transition-colors"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
