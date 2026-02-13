
import React from 'react';
import { useTemplateStore } from '@/features/templates/useTemplateStore';
import { LayoutGrid, Network } from 'lucide-react'; // Example icons

export const ModeSwitcher: React.FC = () => {
    const { currentMode, setMode } = useTemplateStore();

    return (
        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-300 w-fit">
            <button
                className={`flex items-center px-4 py-2 rounded-md transition-colors ${currentMode === 'free' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-200'}`}
                onClick={() => setMode('free')}
            >
                <Network className="w-4 h-4 mr-2" />
                Free Mode
            </button>
            <button
                className={`flex items-center px-4 py-2 rounded-md transition-colors ${currentMode === 'preset' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-200'}`}
                onClick={() => setMode('preset')}
            >
                <LayoutGrid className="w-4 h-4 mr-2" />
                Preset Mode
            </button>
        </div>
    );
};
