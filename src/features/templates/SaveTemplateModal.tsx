
import React, { useState } from 'react';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { useNetworkStore } from '@/stores/useNetworkStore';
import { NetworkTemplate } from '@/features/templates/types';
import { Save, X } from 'lucide-react';

interface Props {
    onClose: () => void;
}

export const SaveTemplateModal: React.FC<Props> = ({ onClose }) => {
    const { currentUser, saveUserTemplate } = useTemplateStore();
    const exportToJson = useNetworkStore((state) => state.exportToJson);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    if (!currentUser) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        const data = exportToJson();

        const newTemplate: NetworkTemplate = {
            id: `tmpl-user-${Date.now()}`,
            name,
            description,
            isOfficial: false,
            author: currentUser.name,
            authorId: currentUser.id,
            createdAt: Date.now(),
            data: JSON.stringify(data) // Double stringify if exportToJson returns object, check store impl
        };

        // Note: Check what exportToJson returns. If object, stringify. 
        // Based on previous mockData, 'data' field expects a JSON string.
        // Assuming exportToJson returns the State object directly.
        if (typeof data !== 'string') {
            newTemplate.data = JSON.stringify(data);
        } else {
            newTemplate.data = data;
        }

        try {
            await saveUserTemplate(newTemplate);
            setIsSaving(false);
            onClose();
            alert('構成を保存しました！');
        } catch (error) {
            console.error(error);
            setIsSaving(false);
            alert('保存に失敗しました。権限がないか、ネットワークエラーの可能性があります。\n(Firestoreのセキュリティルールを確認してください)');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-25 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-900">テンプレートとして保存</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSave}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-900 mb-1">テンプレート名</label>
                        <input
                            type="text"
                            required
                            className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例: OSPF演習1"
                        />
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-900 mb-1">説明 (任意)</label>
                        <textarea
                            className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="この構成の目的やメモを入力..."
                        />
                    </div>

                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center"
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
