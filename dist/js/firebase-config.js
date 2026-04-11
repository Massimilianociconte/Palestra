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
