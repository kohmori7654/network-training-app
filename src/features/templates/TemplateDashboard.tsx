'use client';

import React, { useState, useCallback } from 'react';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { NetworkTemplate } from '@/features/templates/types';
import { useNetworkStore } from '@/stores/useNetworkStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { Play, Trash2, Lock, LogOut, X, User, Link2, Check } from 'lucide-react';

export const TemplateDashboard: React.FC = () => {
    const {
        officialTemplates,
        userTemplates,
        setMode,
        currentUser,
        setCurrentUser,
        logout: storeLogout,
        isMockAuthEnabled,
        deleteUserTemplate
    } = useTemplateStore();

    const importFromJson = useNetworkStore((state) => state.importFromJson);
    const { toast, confirm } = useNotificationStore();

    // Login Modal State
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    // Copied slug tracking
    const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

    const handleLoad = (template: NetworkTemplate) => {
        confirm(`テンプレート "${template.name}" を読み込みますか？\n現在のキャンバスの内容は上書きされます。`).then((ok) => {
            if (!ok) return;
            const success = importFromJson(template.data);
            if (success) {
                setMode('free');
            } else {
                toast('テンプレートの読み込みに失敗しました。');
            }
        });
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const ok = await confirm('本当にこのテンプレートを削除しますか？');
        if (ok) {
            await deleteUserTemplate(id);
        }
    };

    // クリップボードへコピー（iframe 埋め込み時も動作するよう execCommand フォールバック付き）
    const copyToClipboard = useCallback((text: string): Promise<boolean> => {
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
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

    const handleCopyUrl = useCallback((slug: string) => {
        const url = `${window.location.origin}${window.location.pathname}?template=${slug}`;
        copyToClipboard(url).then((ok) => {
            if (ok) {
                setCopiedSlug(slug);
                setTimeout(() => setCopiedSlug(null), 2000);
            } else {
                toast('URLのコピーに失敗しました。');
            }
        });
    }, [copyToClipboard, toast]);

    // Firebase Auth Imports
    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError('');

        try {
            const { signInWithEmailAndPassword } = await import('firebase/auth');
            const { auth } = await import('@/lib/firebase');

            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            setCurrentUser({
                id: userCredential.user.uid,
                name: userCredential.user.email?.split('@')[0] || 'User',
                isAdmin: false
            });

            setIsLoginModalOpen(false);
            setEmail('');
            setPassword('');
        } catch (error: any) {
            console.error(error);
            setLoginError('ログインに失敗しました。メールアドレスとパスワードを確認してください。');
        }
    };

    const handleLogout = async () => {
        try {
            const { signOut } = await import('firebase/auth');
            const { auth } = await import('@/lib/firebase');
            await signOut(auth);
            storeLogout();
        } catch (error) {
            console.error('Logout error', error);
        }
    };

    const allTemplates = [...officialTemplates, ...userTemplates];

    return (
        <div className="flex-1 bg-slate-950 p-6 overflow-y-auto relative">
            <header className="mb-6 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-slate-100">テンプレート一覧</h2>
                    <p className="text-sm text-slate-400">学習用のプリセット構成を選択して、すぐに演習を開始できます。</p>
                </div>
                <div>
                    {isMockAuthEnabled ? (
                        <div className="flex items-center gap-2">
                            <span className="text-xs bg-emerald-900/60 text-emerald-300 border border-emerald-700 px-2 py-1 rounded-full flex items-center">
                                <User className="w-3 h-3 mr-1" />
                                {currentUser?.name} でログイン中
                            </span>
                            <button
                                onClick={handleLogout}
                                className="text-xs text-slate-400 hover:text-red-400 flex items-center transition-colors"
                            >
                                <LogOut className="w-3 h-3 mr-1" /> ログアウト
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsLoginModalOpen(true)}
                            className="text-xs bg-slate-700 text-slate-200 px-3 py-1.5 rounded hover:bg-slate-600 transition-colors border border-slate-600"
                        >
                            ログイン (認証)
                        </button>
                    )}
                </div>
            </header>

            {/* テンプレートテーブル */}
            <div className="mb-6">
                <h3 className="text-base font-semibold mb-3 text-slate-300 border-b border-slate-700 pb-1">登録済みテンプレート一覧</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-800 text-slate-300">
                                <th className="px-4 py-3 text-left font-medium w-12">#</th>
                                <th className="px-4 py-3 text-left font-medium min-w-[160px]">テンプレート名</th>
                                <th className="px-4 py-3 text-left font-medium">説明</th>
                                <th className="px-4 py-3 text-right font-medium w-[200px]">アクション</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {allTemplates.map((tmpl, index) => (
                                <tr key={tmpl.id} className="bg-slate-900 hover:bg-slate-800/70 transition-colors">
                                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{index + 1}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-100 font-medium">{tmpl.name}</span>
                                            {tmpl.isOfficial && (
                                                <span className="bg-blue-900/50 text-blue-300 text-[10px] px-1.5 py-0.5 rounded-full flex items-center border border-blue-700/50 shrink-0">
                                                    <Lock className="w-2.5 h-2.5 mr-0.5" /> 公式
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-0.5">
                                            {tmpl.author} • {new Date(tmpl.createdAt).toLocaleDateString('ja-JP')}
                                        </p>
                                    </td>
                                    <td className="px-4 py-3 text-slate-400 text-xs leading-relaxed">{tmpl.description}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* URLコピーボタン */}
                                            <button
                                                onClick={() => handleCopyUrl(tmpl.slug)}
                                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs transition-colors border ${copiedSlug === tmpl.slug
                                                    ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700'
                                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-600 hover:border-slate-500'
                                                    }`}
                                                title="テンプレートURLをコピー"
                                            >
                                                {copiedSlug === tmpl.slug ? (
                                                    <><Check className="w-3 h-3" /> Copied</>
                                                ) : (
                                                    <><Link2 className="w-3 h-3" /> URL</>
                                                )}
                                            </button>

                                            {/* 構成ロードボタン */}
                                            <button
                                                onClick={() => handleLoad(tmpl)}
                                                className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors font-medium"
                                            >
                                                <Play className="w-3 h-3" /> ロード
                                            </button>

                                            {/* 削除ボタン（自分のテンプレートのみ） */}
                                            {!tmpl.isOfficial && tmpl.authorId === currentUser?.id && (
                                                <button
                                                    onClick={(e) => handleDelete(e, tmpl.id)}
                                                    className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
                                                    title="削除"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {allTemplates.length === 0 && (
                    <p className="text-sm text-slate-500 mt-4 text-center">
                        テンプレートがまだ登録されていません。
                    </p>
                )}
            </div>

            {/* Login Modal (Dark Mode) */}
            {isLoginModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-lg p-6 w-80 shadow-xl border border-slate-700">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-100">ログイン</h3>
                            <button onClick={() => setIsLoginModalOpen(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleLoginSubmit}>
                            <div className="mb-3">
                                <label className="block text-sm font-medium text-slate-200 mb-1">メールアドレス</label>
                                <input
                                    type="email"
                                    className="w-full border border-slate-600 bg-slate-900 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@baudroie.com"
                                />
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-200 mb-1">パスワード</label>
                                <input
                                    type="password"
                                    className="w-full border border-slate-600 bg-slate-900 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="admin"
                                />
                            </div>
                            {loginError && (
                                <p className="text-red-400 text-xs mb-3">{loginError}</p>
                            )}
                            <button
                                type="submit"
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-medium transition-colors"
                            >
                                ログイン
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
