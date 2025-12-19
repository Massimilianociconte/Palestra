import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from './firebase-config.js';
import { firestoreService } from './firestore-service.js';

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

    async logout() {
        try {
            await signOut(auth);
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

