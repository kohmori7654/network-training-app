
import React, { useState } from 'react';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { NetworkTemplate } from '@/features/templates/types';
import { useNetworkStore } from '@/stores/useNetworkStore';
import { Play, Trash2, Lock, LogOut, X, User } from 'lucide-react';

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

    // Login Modal State
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    const handleLoad = (template: NetworkTemplate) => {
        if (confirm(`テンプレート "${template.name}" を読み込みますか？\n現在のキャンバスの内容は上書きされます。`)) {
            const success = importFromJson(template.data);
            if (success) {
                setMode('free');
            } else {
                alert('テンプレートの読み込みに失敗しました。');
            }
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('本当にこのテンプレートを削除しますか？')) {
            await deleteUserTemplate(id);
        }
    };

    // Firebase Auth Imports
    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError('');

        try {
            // Dynamic import to avoid SSR issues if any
            const { signInWithEmailAndPassword } = await import('firebase/auth');
            const { auth } = await import('@/lib/firebase');

            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            // Store User in Zustand (Mapping Firebase User to App User)
            setCurrentUser({
                id: userCredential.user.uid,
                name: userCredential.user.email?.split('@')[0] || 'User',
                isAdmin: false // Can be determined by custom claims or config
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

    const TemplateCard = ({ template }: { template: NetworkTemplate }) => (
        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow relative group">
            <div className="flex justify-between items-start mb-1">
                <div>
                    <h3 className="font-bold text-gray-800 text-sm">{template.name}</h3>
                    <p className="text-[10px] text-gray-500">作成者: {template.author} • {new Date(template.createdAt).toLocaleDateString()}</p>
                </div>
                {template.isOfficial ? (
                    <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full flex items-center shrink-0">
                        <Lock className="w-3 h-3 mr-1" /> テスト用
                    </span>
                ) : (
                    template.authorId === currentUser?.id && (
                        <button
                            onClick={(e) => handleDelete(e, template.id)}
                            className="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="削除"
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    )
                )}
            </div>

            <p className="text-xs text-gray-600 mb-3 line-clamp-2 h-8">{template.description}</p>

            <button
                onClick={() => handleLoad(template)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-1.5 px-3 rounded flex items-center justify-center transition-colors text-xs font-medium"
            >
                <Play className="w-3 h-3 mr-1.5" /> 構成をロード
            </button>
        </div>
    );

    return (
        <div className="flex-1 bg-gray-50 p-6 overflow-y-auto relative">
            <header className="mb-6 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">テンプレート一覧</h2>
                    <p className="text-sm text-gray-600">学習用のプリセット構成を選択して、すぐに演習を開始できます。</p>
                </div>
                <div>
                    {isMockAuthEnabled ? (
                        <div className="flex items-center gap-2">
                            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full flex items-center">
                                <User className="w-3 h-3 mr-1" />
                                {currentUser?.name} でログイン中
                            </span>
                            <button
                                onClick={handleLogout}
                                className="text-xs text-gray-500 hover:text-red-600 flex items-center"
                            >
                                <LogOut className="w-3 h-3 mr-1" /> ログアウト
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsLoginModalOpen(true)}
                            className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded hover:bg-gray-900 transition-colors"
                        >
                            ログイン (認証)
                        </button>
                    )}
                </div>
            </header>

            <div className="mb-6">
                <h3 className="text-base font-semibold mb-3 text-gray-700 border-b pb-1">登録済みテンプレート一覧</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[...officialTemplates, ...userTemplates].map(tmpl => (
                        <TemplateCard key={tmpl.id} template={tmpl} />
                    ))}
                </div>
                {userTemplates.length === 0 && !isMockAuthEnabled && (
                    <p className="text-sm text-gray-500 mt-4 text-center">
                        ※ ログインして「フリー描画モード」で作成した構成を保存すると、ここに表示されます。
                    </p>
                )}
            </div>

            {/* Login Modal */}
            {isLoginModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-80 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-gray-900">ログイン</h3>
                            <button onClick={() => setIsLoginModalOpen(false)} className="text-gray-500 hover:text-gray-700">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleLoginSubmit}>
                            <div className="mb-3">
                                <label className="block text-sm font-medium text-gray-900 mb-1">メールアドレス</label>
                                <input
                                    type="email"
                                    className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@baudroie.com"
                                />
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-900 mb-1">パスワード</label>
                                <input
                                    type="password"
                                    className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="admin"
                                />
                            </div>
                            {loginError && (
                                <p className="text-red-500 text-xs mb-3">{loginError}</p>
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
