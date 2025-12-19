
import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup, signInWithCredential } from './firebase-config.js';
import { firestoreService } from './firestore-service.js';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor } from '@capacitor/core';

export class AuthService {
    constructor() {
        this.user = undefined;
        this.onUserChangeCallbacks = [];

        // Listen for auth state changes
        onAuthStateChanged(auth, (user) => {
            this.user = user;
            this.notifyListeners(user);
        });
    }

    async register(email, password, name) {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Update profile name immediately
            if (name) {
                await updateProfile(user, { displayName: name });
            }

            // Initialize user data in Firestore (including default API key)
            await firestoreService.initializeNewUser(user);

            return { success: true, user };
        } catch (error) {
            console.error("Registration error:", error);
            return { success: false, message: error.message };
        }
    }

    async login(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            return { success: true, user: userCredential.user };
        } catch (error) {
            console.error("Login error:", error);
            return { success: false, message: error.message };
        }
    }

    async loginWithGoogle() {
        try {
            let userResult;

            if (Capacitor.isNativePlatform()) {
                // Native Platform (Android/iOS)
                console.log('📱 Using Native Google Sign-In');
                // Ensure initialized (safe to call multiple times)
                await GoogleAuth.initialize();

                const googleUser = await GoogleAuth.signIn();

                if (!googleUser) {
                    throw new Error('Google Sign-In cancelled');
                }

                // Create Firebase credential from the Google ID token
                const credential = GoogleAuthProvider.credential(googleUser.authentication.idToken);
                userResult = await signInWithCredential(auth, credential);

            } else {
                // Web Platform
                console.log('🌐 Using Web Google Sign-In');
                const provider = new GoogleAuthProvider();
                userResult = await signInWithPopup(auth, provider);
            }

            // Initialize user data in Firestore if new
            await firestoreService.initializeNewUser(userResult.user);
            return { success: true, user: userResult.user };
        } catch (error) {
            console.error("Google Login error:", error);
            // Handle common native errors (e.g. 10: Developer Error)
            let msg = error.message || JSON.stringify(error);
            if (msg.includes('10:') || msg.includes('12500:')) {
                msg = 'Errore configurazione Google (SHA-1 fingerprint mancante?). ' + msg;
            }
            return { success: false, message: msg };
        }
    }

    async logout() {
        try {
            await signOut(auth);
            // Clear all local data to prevent state pollution
            const keysToRemove = [
                'ironflow_workouts',
                'ironflow_logs',
                'ironflow_profile',
                'ironflow_body_stats',
                'ironflow_photos',
                'ironflow_ai_plan_history'
            ];
            keysToRemove.forEach(key => localStorage.removeItem(key));
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    subscribe(callback) {
        this.onUserChangeCallbacks.push(callback);
        if (this.user !== undefined) {
            callback(this.user);
        }
    }

    notifyListeners(user) {
        this.onUserChangeCallbacks.forEach(cb => cb(user));
    }

    getCurrentUser() {
        return auth.currentUser;
    }
}

// Singleton instance
export const authService = new AuthService();

