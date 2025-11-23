// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, serverTimestamp, collection, query, where, orderBy, limit, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

export { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, doc, setDoc, getDoc, updateDoc, arrayUnion, serverTimestamp, collection, query, where, orderBy, limit, getDocs, deleteDoc };
