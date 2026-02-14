
import { create } from 'zustand';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, setDoc, deleteDoc, doc, onSnapshot, orderBy } from 'firebase/firestore';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NetworkTemplate, User } from './types';
import { OFFICIAL_TEMPLATES } from './mockData';

// --- Types & Interface ---

interface TemplateStoreState {
    // Mode State
    currentMode: 'free' | 'preset';

    // Auth State (Mock)
    currentUser: User | null;
    isMockAuthEnabled: boolean; // Flag to easily toggle login state

    // Data State
    officialTemplates: NetworkTemplate[];
    userTemplates: NetworkTemplate[];

    // Actions
    setMode: (mode: 'free' | 'preset') => void;
    setCurrentUser: (user: User | null) => void;
    logout: () => void;
    subscribeToTemplates: () => () => void; // Returns unsubscribe function

    // Repository Methods (Future: Replace implementation with Firebase calls)
    loadUserTemplates: () => void;
    saveUserTemplate: (template: NetworkTemplate) => Promise<void>;
    deleteUserTemplate: (templateId: string) => Promise<void>;

    // Helpers
    findTemplateBySlug: (slug: string) => NetworkTemplate | undefined;
}

// --- Mock User ---
const MOCK_USER: User = {
    id: 'user-mock-001',
    name: 'Demo User',
    isAdmin: false,
};

// --- Store Implementation ---

export const useTemplateStore = create<TemplateStoreState>()(
    persist(
        (set, get) => ({
            // Default State
            currentMode: 'free',
            currentUser: null,
            isMockAuthEnabled: false,
            officialTemplates: OFFICIAL_TEMPLATES,
            userTemplates: [],

            // Actions
            setMode: (mode) => set({ currentMode: mode }),

            setCurrentUser: (user: User | null) => {
                set({ currentUser: user, isMockAuthEnabled: !!user });
                if (user) {
                    get().loadUserTemplates();
                } else {
                    set({ userTemplates: [] });
                }
            },

            logout: () => {
                set({ currentUser: null, isMockAuthEnabled: false });
            },

            subscribeToTemplates: () => {
                const q = query(
                    collection(db, 'templates'),
                    orderBy('createdAt', 'desc')
                );

                const unsubscribe = onSnapshot(q, (querySnapshot) => {
                    const templates: NetworkTemplate[] = [];
                    querySnapshot.forEach((doc) => {
                        templates.push({ id: doc.id, ...doc.data() } as NetworkTemplate);
                    });
                    set({ userTemplates: templates });
                }, (error) => {
                    console.error("Error subscribing to templates: ", error);
                });

                return unsubscribe;
            },

            // --- Data Repository Layer (Firestore) ---

            loadUserTemplates: async () => {
                const user = get().currentUser;
                if (!user) return;

                try {
                    const q = query(
                        collection(db, 'templates'),
                        where('authorId', '==', user.id)
                    );
                    const querySnapshot = await getDocs(q);
                    const templates: NetworkTemplate[] = [];
                    querySnapshot.forEach((doc) => {
                        // Flatten data: ID from doc.id, rest from doc.data()
                        templates.push({ id: doc.id, ...doc.data() } as NetworkTemplate);
                    });
                    set({ userTemplates: templates });
                } catch (e) {
                    console.error("Error loading templates: ", e);
                }
            },

            saveUserTemplate: async (template: NetworkTemplate) => {
                const user = get().currentUser;
                if (!user) return;

                // Ensure authorId is set correctly to current user
                const dataToSave = { ...template, authorId: user.id };

                // Optimistic UI Update
                const currentTemplates = get().userTemplates;
                const existsIndex = currentTemplates.findIndex(t => t.id === template.id);
                if (existsIndex >= 0) {
                    const newTemplates = [...currentTemplates];
                    newTemplates[existsIndex] = dataToSave;
                    set({ userTemplates: newTemplates });
                } else {
                    set({ userTemplates: [...currentTemplates, dataToSave] });
                }

                try {
                    // If the template has a temporary ID or we rely on Firestore ID, logic differs.
                    // For now, let's treat 'template.id' as the document ID if it looks persistent, 
                    // otherwise addDoc for new. 
                    // However, our app generates UUIDs. We can use setDoc with that UUID.
                    await setDoc(doc(db, 'templates', template.id), dataToSave);
                } catch (e) {
                    console.error("Error adding document: ", e);
                    throw e; // Propagate error to UI
                }
            },

            deleteUserTemplate: async (templateId: string) => {
                // Optimistic UI Update
                const current = get().userTemplates;
                set({ userTemplates: current.filter(t => t.id !== templateId) });

                try {
                    await deleteDoc(doc(db, 'templates', templateId));
                } catch (e) {
                    console.error("Error deleting document: ", e);
                }
            },

            // Helpers
            findTemplateBySlug: (slug: string) => {
                const all = [...get().officialTemplates, ...get().userTemplates];
                return all.find(t => t.slug === slug);
            }
        }),
        {
            name: 'network-templates-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                // STOP persisting userTemplates to LocalStorage to avoid conflicts.
                // Only persist Auth/Mode state if desired, but for now let's keep it minimal.
                // userTemplates: state.userTemplates 
                currentMode: state.currentMode
            }),
        }
    )
);
