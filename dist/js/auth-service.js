import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from './firebase-config.js';
import { firestoreService } from './firestore-service.js';

export class AuthService {
    constructor() {
        this.user = undefined;
        this.onUserChangeCallbacks = [];
        this._authReady = false;

        // Listen for auth state changes
        onAuthStateChanged(auth, (user) => {
            console.log('🔐 [AuthService] Auth state changed:', user?.email || 'null');
            this.user = user;
            this._authReady = true;
            this.notifyListeners(user);
        });
        
        // Log initial state
        console.log('🔐 [AuthService] Inizializzato, auth.currentUser:', auth.currentUser?.email || 'null');
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
            // Clear all local user data before signing out
            this._clearLocalUserData();
            
            await signOut(auth);
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Clear all local user data from localStorage
     * Called on logout to prevent data leakage between accounts
     */
    _clearLocalUserData() {
        console.log('🧹 [AuthService] Clearing local user data...');
        
        // List of all ironflow_ prefixed keys used by the app
        const keysToRemove = [
            'ironflow_workouts',
            'ironflow_logs',
            'ironflow_profile',
            'ironflow_body_stats',
            'ironflow_photos',
            'ironflow_ai_plan_history',
            'ironflow_last_sync',
            'ironflow_pending_changes',
            'ironflow_cached_exercises',
            'ironflow_pr_records',
            'ironflow_doms_data',
            'ironflow_health_data',
            'ironflow_terra_connection',
            'ironflow_google_fit_token',
            'ironflow_current_uid'  // Also clear the current user ID
        ];
        
        keysToRemove.forEach(key => {
            if (localStorage.getItem(key) !== null) {
                localStorage.removeItem(key);
                console.log(`🧹 [AuthService] Removed: ${key}`);
            }
        });
        
        // Also clear any keys that start with ironflow_ (catch-all)
        const allKeys = Object.keys(localStorage);
        allKeys.forEach(key => {
            if (key.startsWith('ironflow_') && !keysToRemove.includes(key)) {
                localStorage.removeItem(key);
                console.log(`🧹 [AuthService] Removed (catch-all): ${key}`);
            }
        });
        
        console.log('✅ [AuthService] Local user data cleared');
    }

    subscribe(callback) {
        this.onUserChangeCallbacks.push(callback);
        // Se l'auth è già pronto, chiama subito il callback
        if (this._authReady) {
            callback(this.user);
        }
    }

    notifyListeners(user) {
        this.onUserChangeCallbacks.forEach(cb => cb(user));
    }

    getCurrentUser() {
        // Usa this.user che viene aggiornato da onAuthStateChanged
        // invece di auth.currentUser che potrebbe non essere ancora pronto
        const user = this.user !== undefined ? this.user : auth.currentUser;
        console.log('🔐 [AuthService] getCurrentUser:', user?.email || 'null', '(this.user:', this.user?.email || 'undefined', ', auth.currentUser:', auth.currentUser?.email || 'null', ')');
        return user;
    }

    /**
     * Attende che l'autenticazione sia pronta
     * @param {number} timeout - Timeout in ms (default 10s)
     * @returns {Promise<User|null>}
     */
    waitForAuth(timeout = 10000) {
        return new Promise((resolve) => {
            // Se l'auth è già pronto, risolvi subito
            if (this._authReady) {
                console.log('🔐 [AuthService] waitForAuth: già pronto, user:', this.user?.email || 'null');
                resolve(this.user);
                return;
            }
            
            console.log('🔐 [AuthService] waitForAuth: attendo auth state...');
            
            // Timeout per evitare attese infinite
            const timeoutId = setTimeout(() => {
                console.warn('🔐 [AuthService] waitForAuth: timeout raggiunto');
                resolve(this.user || auth.currentUser || null);
            }, timeout);
            
            // Aspetta il primo callback
            const unsubscribe = (user) => {
                clearTimeout(timeoutId);
                // Rimuovi questo callback
                const index = this.onUserChangeCallbacks.indexOf(unsubscribe);
                if (index > -1) {
                    this.onUserChangeCallbacks.splice(index, 1);
                }
                console.log('🔐 [AuthService] waitForAuth: risolto con user:', user?.email || 'null');
                resolve(user);
            };
            
            this.onUserChangeCallbacks.push(unsubscribe);
        });
    }
    
    /**
     * Verifica se l'auth è pronto
     */
    isReady() {
        return this._authReady;
    }
}

// Singleton instance
export const authService = new AuthService();

