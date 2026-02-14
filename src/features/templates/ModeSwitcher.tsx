
import React from 'react';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { LayoutGrid, Network } from 'lucide-react';

export const ModeSwitcher: React.FC = () => {
    const { currentMode, setMode } = useTemplateStore();

    return (
        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-600 w-fit">
            <button
                className={`flex items-center px-4 py-2 rounded-md transition-colors text-sm ${currentMode === 'free' ? 'bg-slate-600 shadow text-blue-400 font-medium' : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
                onClick={() => setMode('free')}
            >
                <Network className="w-4 h-4 mr-2" />
                Free Mode
            </button>
            <button
                className={`flex items-center px-4 py-2 rounded-md transition-colors text-sm ${currentMode === 'preset' ? 'bg-slate-600 shadow text-blue-400 font-medium' : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
                onClick={() => setMode('preset')}
            >
                <LayoutGrid className="w-4 h-4 mr-2" />
                Template Mode
            </button>
        </div>
    );
};
