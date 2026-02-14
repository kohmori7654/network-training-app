'use client';

import React, { useState } from 'react';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { useNetworkStore } from '@/stores/useNetworkStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { NetworkTemplate } from '@/features/templates/types';
import { Save, X } from 'lucide-react';

interface Props {
    onClose: () => void;
}

export const SaveTemplateModal: React.FC<Props> = ({ onClose }) => {
    const { currentUser, saveUserTemplate } = useTemplateStore();
    const exportToJson = useNetworkStore((state) => state.exportToJson);
    const toast = useNotificationStore((s) => s.toast);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [slug, setSlug] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    if (!currentUser) return null;

    // テンプレート名からslug候補を自動生成
    const generateSlug = (templateName: string): string => {
        // 英数字・ハイフンのみ残す簡易変換。日本語はタイムスタンプベースに。
        const sanitized = templateName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-');
        return sanitized || `tmpl-${Date.now()}`;
    };

    const handleNameChange = (value: string) => {
        setName(value);
        // slugが手動入力されていなければ自動生成
        if (!slug || slug === generateSlug(name)) {
            setSlug(generateSlug(value));
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        const data = exportToJson();
        const finalSlug = slug || `tmpl-${Date.now()}`;

        const newTemplate: NetworkTemplate = {
            id: `tmpl-user-${Date.now()}`,
            slug: finalSlug,
            name,
            description,
            isOfficial: false,
            author: currentUser.name,
            authorId: currentUser.id,
            createdAt: Date.now(),
            data: typeof data !== 'string' ? JSON.stringify(data) : data,
        };

        try {
            await saveUserTemplate(newTemplate);
            setIsSaving(false);
            onClose();
            toast('構成を保存しました！');
        } catch (error) {
            console.error(error);
            setIsSaving(false);
            toast('保存に失敗しました。権限がないか、ネットワークエラーの可能性があります。\n(Firestoreのセキュリティルールを確認してください)');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 w-96 shadow-xl border border-slate-700">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-slate-100">テンプレートとして保存</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSave}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-200 mb-1">テンプレート名</label>
                        <input
                            type="text"
                            required
                            className="w-full border border-slate-600 bg-slate-900 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            value={name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            placeholder="例: OSPF演習1"
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-200 mb-1">
                            URL識別子 (slug)
                            <span className="text-slate-500 text-xs ml-1">※保存後は変更不可</span>
                        </label>
                        <input
                            type="text"
                            className="w-full border border-slate-600 bg-slate-900 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-xs"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                            placeholder="自動生成されます"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                            URLに使用: ?template={slug || '...'}
                        </p>
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-200 mb-1">説明 (任意)</label>
                        <textarea
                            className="w-full border border-slate-600 bg-slate-900 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24 resize-none"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="この構成の目的やメモを入力..."
                        />
                    </div>

                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-slate-400 hover:bg-slate-700 rounded transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center transition-colors"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {isSaving ? '保存中...' : '保存する'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
