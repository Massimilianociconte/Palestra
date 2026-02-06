// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup, signInWithCredential } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
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
    enableIndexedDbPersistence
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
const db = getFirestore(app);
const functions = getFunctions(app);

// Enable offline persistence for resilience
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('Persistence failed: Multiple tabs open');
        } else if (err.code === 'unimplemented') {
            console.warn('Persistence not available in this browser');
        }
    });
} catch (e) {
    console.warn('Persistence setup error:', e);
}

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
