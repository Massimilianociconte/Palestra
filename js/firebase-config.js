// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup, signInWithCredential } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    initializeFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    arrayUnion,
    arrayRemove,
    serverTimestamp,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    deleteDoc,
    onSnapshot,
    writeBatch,
    runTransaction,
    increment,
    addDoc,
    Timestamp,
    persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyB2kwY2t8QqVDfKeC4gh_TuyX_vHNwVuwU",
    authDomain: "ironflow-a9bc9.firebaseapp.com",
    projectId: "ironflow-a9bc9",
    storageBucket: "ironflow-a9bc9.firebasestorage.app",
    messagingSenderId: "254296220548",
    appId: "1:254296220548:web:3549b12f2888144a5cf3d1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ============================================================
// P2.25 — Firebase App Check (reCAPTCHA v3)
// ------------------------------------------------------------
// Set the reCAPTCHA v3 *site key* in `window.__APP_CHECK_SITE_KEY__`
// BEFORE this module is imported (e.g. via an inline <script> in the HTML
// head). When the variable is absent we skip App Check so local dev and
// current production keep working unchanged.
//
// To enable in production:
//   1. Register the domain in Firebase Console > App Check > reCAPTCHA v3.
//   2. Copy the site key into the bootstrap script, e.g.:
//        <script>window.__APP_CHECK_SITE_KEY__ = "6Lc..."</script>
//   3. For the Capacitor Android app, switch to Play Integrity provider in
//      MainActivity instead.
//
// Debug tokens for local dev can be registered by setting
//   window.FIREBASE_APPCHECK_DEBUG_TOKEN = true
// before this module loads.
// ============================================================
try {
    // The Firebase App Check SDK reads `self.FIREBASE_APPCHECK_DEBUG_TOKEN`
    // automatically for local development tokens; no extra wiring is needed.
    const siteKey = typeof window !== "undefined" ? window.__APP_CHECK_SITE_KEY__ : null;
    if (siteKey && typeof siteKey === "string" && siteKey.length > 8) {
        initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: true
        });
        console.info("[firebase-config] App Check initialized (reCAPTCHA v3)");
    } else {
        console.info("[firebase-config] App Check not initialized — set window.__APP_CHECK_SITE_KEY__ to enable");
    }
} catch (err) {
    console.warn("[firebase-config] App Check init failed:", err && err.message);
}

const auth = getAuth(app);
const functions = getFunctions(app);

const db = (() => {
    try {
        return initializeFirestore(app, {
            localCache: persistentLocalCache()
        });
    } catch (error) {
        console.warn("Persistent cache setup error:", error);
        return getFirestore(app);
    }
})();

export {
    auth,
    db,
    functions,
    httpsCallable,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithCredential,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    arrayUnion,
    arrayRemove,
    serverTimestamp,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    deleteDoc,
    onSnapshot,
    writeBatch,
    runTransaction,
    increment,
    addDoc,
    Timestamp
};
