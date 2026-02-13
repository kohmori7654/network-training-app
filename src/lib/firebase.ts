import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
    apiKey: "AIzaSyC1bbMAOeEOsJMSd6_7JFR0mK_fQUg99PY",
    authDomain: "baudroie-virtual-campus.firebaseapp.com",
    projectId: "baudroie-virtual-campus",
    storageBucket: "baudroie-virtual-campus.firebasestorage.app",
    messagingSenderId: "140366507048",
    appId: "1:140366507048:web:8dfcddc2b566873a74591d",
    measurementId: "G-6GQRFWKJWF"
};

// Initialize Firebase (Singleton pattern to avoid re-initialization error in Next.js)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Analytics (Client-side only)
let analytics;
if (typeof window !== 'undefined') {
    isSupported().then(yes => yes && (analytics = getAnalytics(app)));
}

export { db, auth, analytics };
