import { create } from 'zustand';

interface ConfirmState {
    message: string;
    resolve: (value: boolean) => void;
}

interface NotificationState {
    /** アラート（トースト）表示メッセージ。null なら非表示 */
    alertMessage: string | null;
    /** 確認ダイアログの状態。null なら非表示 */
    confirmState: ConfirmState | null;
    /** アラートを表示（ページ内モーダル） */
    toast: (message: string) => void;
    /** アラートを閉じる */
    dismissToast: () => void;
    /** 確認ダイアログを表示。OK で true、キャンセルで false を返す Promise */
    confirm: (message: string) => Promise<boolean>;
    /** 確認ダイアログで OK を選択 */
    confirmOk: () => void;
    /** 確認ダイアログでキャンセルを選択 */
    confirmCancel: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
    alertMessage: null,
    confirmState: null,

    toast: (message: string) => {
        set({ alertMessage: message });
    },

    dismissToast: () => {
        set({ alertMessage: null });
    },

    confirm: (message: string) => {
        return new Promise<boolean>((resolve) => {
            set({
                confirmState: {
                    message,
                    resolve,
                },
            });
        });
    },

    confirmOk: () => {
        const { confirmState } = get();
        if (confirmState) {
            confirmState.resolve(true);
            set({ confirmState: null });
        }
    },

    confirmCancel: () => {
        const { confirmState } = get();
        if (confirmState) {
            confirmState.resolve(false);
            set({ confirmState: null });
        }
    },
}));
