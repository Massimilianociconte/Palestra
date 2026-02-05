/**
 * FriendshipService - Manages friend relationships in Gymbro
 * 
 * Architecture:
 * - Single source of truth: One document per friendship pair
 * - Deterministic ID: friendshipId = sorted(uidA, uidB).join('_')
 * - Status: pending_from_a, pending_from_b, accepted, blocked
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

import {
    db,
    auth,
    functions,
    httpsCallable,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    getDocs,
    serverTimestamp,
    runTransaction
} from '../firebase-config.js';

/**
 * @typedef {Object} Friendship
 * @property {string[]} participants - Array of two UIDs [uidA, uidB]
 * @property {'pending_from_a'|'pending_from_b'|'accepted'|'blocked'} status
 * @property {string} createdBy - UID of user who sent the request
 * @property {Date} createdAt - When the request was created
 * @property {Date|null} respondedAt - When the request was accepted/rejected
 * @property {Object} metadata - Additional metadata (future: nicknames, etc.)
 */

/**
 * @typedef {Object} ServiceResult
 * @property {boolean} success
 * @property {*} [data]
 * @property {string} [error]
 * @property {string} [code]
 */

export class FriendshipService {
    constructor() {
        this.collectionName = 'friendships';
        this._retryConfig = {
            maxRetries: 3,
            baseDelay: 1000, // 1 second
            maxDelay: 8000   // 8 seconds
        };
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    /**
     * Get current authenticated user's UID
     * @returns {string}
     * @throws {Error} If user is not authenticated
     */
    _getUid() {
        const user = auth.currentUser;
        if (!user) throw new Error('Utente non autenticato');
        return user.uid;
    }

    /**
     * Generate deterministic friendship ID from two UIDs
     * Always returns the same ID regardless of order
     * @param {string} uidA 
     * @param {string} uidB 
     * @returns {string}
     */
    _getFriendshipId(uidA, uidB) {
        return [uidA, uidB].sort().join('_');
    }

    /**
     * Determine the pending status based on who sent the request
     * @param {string} senderUid 
     * @param {string[]} sortedParticipants 
     * @returns {'pending_from_a'|'pending_from_b'}
     */
    _getPendingStatus(senderUid, sortedParticipants) {
        return sortedParticipants[0] === senderUid ? 'pending_from_a' : 'pending_from_b';
    }

    /**
     * Execute with exponential backoff retry
     * @param {Function} operation 
     * @param {string} operationName 
     * @returns {Promise<ServiceResult>}
     */
    async _withRetry(operation, operationName) {
        let lastError;

        for (let attempt = 0; attempt < this._retryConfig.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                // Don't retry for validation errors or permission denied
                if (error.code === 'permission-denied' ||
                    error.code === 'invalid-argument' ||
                    error.message?.includes('già')) {
                    throw error;
                }

                // Calculate delay with exponential backoff
                const delay = Math.min(
                    this._retryConfig.baseDelay * Math.pow(2, attempt),
                    this._retryConfig.maxDelay
                );

                console.warn(`[FriendshipService] ${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Send a friend request to another user
     * Uses transaction to ensure atomicity and prevent race conditions
     * 
     * @param {string} toUid - UID of user to send request to
     * @returns {Promise<ServiceResult>}
     */
    async sendFriendRequest(toUid) {
        return this._withRetry(async () => {
            const fromUid = this._getUid();

            // Validation
            if (!toUid || typeof toUid !== 'string') {
                return { success: false, error: 'ID utente non valido', code: 'invalid-argument' };
            }

            if (fromUid === toUid) {
                return { success: false, error: 'Non puoi inviare una richiesta a te stesso', code: 'invalid-argument' };
            }

            const friendshipId = this._getFriendshipId(fromUid, toUid);
            const sortedParticipants = [fromUid, toUid].sort();
            const pendingStatus = this._getPendingStatus(fromUid, sortedParticipants);

            const friendshipRef = doc(db, this.collectionName, friendshipId);

            // Use transaction for atomicity
            const result = await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(friendshipRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();

                    if (data.status === 'accepted') {
                        throw new Error('Siete già amici');
                    }

                    if (data.status === 'blocked') {
                        throw new Error('Non è possibile inviare la richiesta');
                    }

                    // Check if there's already a pending request
                    if (data.status.startsWith('pending_')) {
                        if (data.createdBy === fromUid) {
                            throw new Error('Richiesta già inviata');
                        } else {
                            // The other user already sent us a request - auto-accept!
                            transaction.update(friendshipRef, {
                                status: 'accepted',
                                respondedAt: serverTimestamp()
                            });
                            return { autoAccepted: true };
                        }
                    }
                }

                // Create new friendship request
                transaction.set(friendshipRef, {
                    participants: sortedParticipants,
                    status: pendingStatus,
                    createdBy: fromUid,
                    createdAt: serverTimestamp(),
                    respondedAt: null,
                    metadata: {}
                });

                return { created: true };
            });

            if (result.autoAccepted) {
                console.log(`[FriendshipService] Friend request auto-accepted (mutual request)`);
                return { success: true, data: { status: 'accepted', autoAccepted: true } };
            }

            console.log(`[FriendshipService] Friend request sent from ${fromUid} to ${toUid}`);
            return { success: true, data: { friendshipId, status: pendingStatus } };

        }, 'sendFriendRequest');
    }

    /**
     * Accept a pending friend request
     * 
     * @param {string} senderUid - UID of user who sent the request
     * @returns {Promise<ServiceResult>}
     */
    async acceptFriendRequest(senderUid) {
        return this._withRetry(async () => {
            const acceptorUid = this._getUid();

            if (!senderUid || typeof senderUid !== 'string') {
                return { success: false, error: 'ID utente non valido', code: 'invalid-argument' };
            }

            const friendshipId = this._getFriendshipId(acceptorUid, senderUid);
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            const result = await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(friendshipRef);

                if (!docSnap.exists()) {
                    throw new Error('Richiesta di amicizia non trovata');
                }

                const data = docSnap.data();

                if (data.status === 'accepted') {
                    throw new Error('Siete già amici');
                }

                if (data.status === 'blocked') {
                    throw new Error('Non è possibile accettare questa richiesta');
                }

                // Verify that the acceptor is NOT the one who sent the request
                if (data.createdBy === acceptorUid) {
                    throw new Error('Non puoi accettare la tua stessa richiesta');
                }

                // Verify the request is actually pending
                if (!data.status.startsWith('pending_')) {
                    throw new Error('Richiesta non in attesa');
                }

                transaction.update(friendshipRef, {
                    status: 'accepted',
                    respondedAt: serverTimestamp()
                });

                return { accepted: true };
            });

            console.log(`[FriendshipService] Friend request accepted: ${senderUid} <-> ${acceptorUid}`);
            return { success: true, data: { friendshipId, status: 'accepted' } };

        }, 'acceptFriendRequest');
    }

    /**
     * Reject a pending friend request
     * 
     * @param {string} senderUid - UID of user who sent the request
     * @returns {Promise<ServiceResult>}
     */
    async rejectFriendRequest(senderUid) {
        return this._withRetry(async () => {
            const rejectorUid = this._getUid();

            if (!senderUid || typeof senderUid !== 'string') {
                return { success: false, error: 'ID utente non valido', code: 'invalid-argument' };
            }

            const friendshipId = this._getFriendshipId(rejectorUid, senderUid);
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            const docSnap = await getDoc(friendshipRef);

            if (!docSnap.exists()) {
                return { success: false, error: 'Richiesta non trovata', code: 'not-found' };
            }

            const data = docSnap.data();

            // Verify the rejector is the recipient (not the sender)
            if (data.createdBy === rejectorUid) {
                return { success: false, error: 'Non puoi rifiutare la tua richiesta', code: 'invalid-argument' };
            }

            // Delete the friendship document
            await deleteDoc(friendshipRef);

            console.log(`[FriendshipService] Friend request rejected: ${senderUid} -> ${rejectorUid}`);
            return { success: true };

        }, 'rejectFriendRequest');
    }

    /**
     * Get all accepted friends for the current user
     * 
     * @returns {Promise<ServiceResult>}
     */
    async getFriends() {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const friendshipsRef = collection(db, this.collectionName);
            const q = query(
                friendshipsRef,
                where('participants', 'array-contains', uid),
                where('status', '==', 'accepted')
            );

            const querySnapshot = await getDocs(q);

            const friends = querySnapshot.docs.map(docSnap => {
                const data = docSnap.data();
                // Get the friend's UID (the one that's not us)
                const friendUid = data.participants.find(p => p !== uid);
                return {
                    friendshipId: docSnap.id,
                    friendUid,
                    since: data.respondedAt?.toDate?.() || data.createdAt?.toDate?.() || null
                };
            });

            // Sort by friendship date (most recent first)
            friends.sort((a, b) => {
                if (!a.since) return 1;
                if (!b.since) return -1;
                return b.since - a.since;
            });

            console.log(`[FriendshipService] Found ${friends.length} friends for ${uid}`);
            return { success: true, data: friends };

        }, 'getFriends');
    }

    /**
     * Get pending friend requests (both sent and received)
     * 
     * @returns {Promise<ServiceResult>}
     */
    async getPendingRequests() {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const friendshipsRef = collection(db, this.collectionName);
            const q = query(
                friendshipsRef,
                where('participants', 'array-contains', uid)
            );

            const querySnapshot = await getDocs(q);

            const pending = [];

            querySnapshot.docs.forEach(docSnap => {
                const data = docSnap.data();

                // Only process pending requests
                if (!data.status?.startsWith('pending_')) return;

                const otherUid = data.participants.find(p => p !== uid);
                const isInbound = data.createdBy !== uid; // We received it

                pending.push({
                    friendshipId: docSnap.id,
                    otherUid,
                    isInbound,
                    createdAt: data.createdAt?.toDate?.() || null,
                    createdBy: data.createdBy
                });
            });

            // Sort: inbound first, then by date
            pending.sort((a, b) => {
                if (a.isInbound !== b.isInbound) return a.isInbound ? -1 : 1;
                if (!a.createdAt) return 1;
                if (!b.createdAt) return -1;
                return b.createdAt - a.createdAt;
            });

            console.log(`[FriendshipService] Found ${pending.length} pending requests for ${uid}`);
            return { success: true, data: pending };

        }, 'getPendingRequests');
    }

    /**
     * Block a user
     * If friendship exists, sets status to 'blocked'
     * If no friendship exists, creates one with 'blocked' status
     * 
     * @param {string} blockedUid - UID of user to block
     * @returns {Promise<ServiceResult>}
     */
    async blockUser(blockedUid) {
        return this._withRetry(async () => {
            const blockerUid = this._getUid();

            if (!blockedUid || typeof blockedUid !== 'string') {
                return { success: false, error: 'ID utente non valido', code: 'invalid-argument' };
            }

            if (blockerUid === blockedUid) {
                return { success: false, error: 'Non puoi bloccare te stesso', code: 'invalid-argument' };
            }

            const friendshipId = this._getFriendshipId(blockerUid, blockedUid);
            const sortedParticipants = [blockerUid, blockedUid].sort();
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            // Use setDoc with merge to create OR update
            await setDoc(friendshipRef, {
                participants: sortedParticipants,
                status: 'blocked',
                blockedBy: blockerUid,
                blockedAt: serverTimestamp()
            }, { merge: true });

            console.log(`[FriendshipService] User ${blockedUid} blocked by ${blockerUid}`);
            return { success: true };

        }, 'blockUser');
    }

    /**
     * Unblock a user
     * 
     * @param {string} unblockedUid - UID of user to unblock
     * @returns {Promise<ServiceResult>}
     */
    async unblockUser(unblockedUid) {
        return this._withRetry(async () => {
            const unblockerUid = this._getUid();

            const friendshipId = this._getFriendshipId(unblockerUid, unblockedUid);
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            const docSnap = await getDoc(friendshipRef);

            if (!docSnap.exists()) {
                return { success: false, error: 'Utente non bloccato', code: 'not-found' };
            }

            const data = docSnap.data();

            if (data.status !== 'blocked') {
                return { success: false, error: 'Utente non bloccato', code: 'invalid-argument' };
            }

            if (data.blockedBy !== unblockerUid) {
                return { success: false, error: 'Non puoi sbloccare questo utente', code: 'permission-denied' };
            }

            // Delete the friendship (they can send a new request if they want)
            await deleteDoc(friendshipRef);

            console.log(`[FriendshipService] User ${unblockedUid} unblocked by ${unblockerUid}`);
            return { success: true };

        }, 'unblockUser');
    }

    /**
     * Remove a friend (unfriend)
     * 
     * @param {string} friendUid - UID of friend to remove
     * @returns {Promise<ServiceResult>}
     */
    async removeFriend(friendUid) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const friendshipId = this._getFriendshipId(uid, friendUid);
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            const docSnap = await getDoc(friendshipRef);

            if (!docSnap.exists()) {
                return { success: false, error: 'Amicizia non trovata', code: 'not-found' };
            }

            const data = docSnap.data();

            if (data.status !== 'accepted') {
                return { success: false, error: 'Non siete amici', code: 'invalid-argument' };
            }

            await deleteDoc(friendshipRef);

            console.log(`[FriendshipService] Friendship removed: ${uid} <-> ${friendUid}`);
            return { success: true };

        }, 'removeFriend');
    }

    /**
     * Check friendship status with another user
     * 
     * @param {string} otherUid - UID of user to check
     * @returns {Promise<ServiceResult>}
     */
    async checkFriendshipStatus(otherUid) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            if (uid === otherUid) {
                return { success: true, data: { status: 'self' } };
            }

            const friendshipId = this._getFriendshipId(uid, otherUid);
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            const docSnap = await getDoc(friendshipRef);

            if (!docSnap.exists()) {
                return { success: true, data: { status: 'none' } };
            }

            const data = docSnap.data();

            let displayStatus = data.status;

            // Add context for pending status
            if (data.status.startsWith('pending_')) {
                displayStatus = data.createdBy === uid ? 'pending_sent' : 'pending_received';
            }

            return {
                success: true,
                data: {
                    status: displayStatus,
                    friendshipId,
                    since: data.respondedAt?.toDate?.() || null
                }
            };

        }, 'checkFriendshipStatus');
    }

    /**
     * Find a user by their email address
     * Uses Cloud Function to bypass client-side permission issues
     * 
     * @param {string} email - Email address to search for
     * @returns {Promise<ServiceResult>}
     */
    async findUserByEmail(email) {
        return this._withRetry(async () => {
            this._getUid(); // Verify authenticated

            if (!email || typeof email !== 'string') {
                return { success: false, error: 'Email non valida', code: 'invalid-argument' };
            }

            // Use Cloud Function for search (bypasses permission issues)
            try {
                const searchUserByEmail = httpsCallable(functions, 'searchUserByEmail');
                const result = await searchUserByEmail({ email: email.toLowerCase().trim() });
                return result.data;
            } catch (error) {
                console.error('[FriendshipService] Cloud function error:', error);
                
                // Fallback to direct query if Cloud Function fails
                return this._findUserByEmailDirect(email);
            }

        }, 'findUserByEmail');
    }

    /**
     * Direct Firestore query fallback for findUserByEmail
     * @private
     */
    async _findUserByEmailDirect(email) {
        const uid = this._getUid();
        const normalizedEmail = email.toLowerCase().trim();

        // Query users collection for matching email
        const usersRef = collection(db, 'users');
        let q = query(usersRef, where('email', '==', normalizedEmail));
        let querySnapshot = await getDocs(q);

        // Fallback: try profile.email for legacy users
        if (querySnapshot.empty) {
            console.log('[FriendshipService] Root email not found, trying profile.email fallback');
            q = query(usersRef, where('profile.email', '==', normalizedEmail));
            querySnapshot = await getDocs(q);
        }

        if (querySnapshot.empty) {
            return { success: false, error: 'Nessun utente trovato con questa email', code: 'not-found' };
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();

        if (userDoc.id === uid) {
            return { success: false, error: 'Non puoi cercare te stesso', code: 'invalid-argument' };
        }

        const statusResult = await this.checkFriendshipStatus(userDoc.id);

        return {
            success: true,
            data: {
                uid: userDoc.id,
                displayName: userData.profile?.name || 'Utente',
                photoURL: userData.profile?.photoUrl || '',
                email: normalizedEmail,
                friendshipStatus: statusResult.success ? statusResult.data.status : 'none'
            }
        };
    }

    /**
     * Create instant friendship via QR code scan (bypasses approval)
     * Both users must have scanned each other's QR OR one scans the other's
     * For simplicity: scanning creates immediate friendship
     * 
     * @param {string} scannedUid - UID from scanned QR code
     * @returns {Promise<ServiceResult>}
     */
    async createInstantFriendship(scannedUid) {
        return this._withRetry(async () => {
            const scannerUid = this._getUid();

            if (!scannedUid || typeof scannedUid !== 'string') {
                return { success: false, error: 'QR Code non valido', code: 'invalid-argument' };
            }

            if (scannerUid === scannedUid) {
                return { success: false, error: 'Non puoi scansionare il tuo QR code', code: 'invalid-argument' };
            }

            const friendshipId = this._getFriendshipId(scannerUid, scannedUid);
            const sortedParticipants = [scannerUid, scannedUid].sort();
            const friendshipRef = doc(db, this.collectionName, friendshipId);

            // Use transaction for atomicity
            const result = await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(friendshipRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();

                    if (data.status === 'accepted') {
                        return { alreadyFriends: true };
                    }

                    if (data.status === 'blocked') {
                        throw new Error('Non è possibile aggiungere questo utente');
                    }

                    // If pending, upgrade to accepted (QR scan = instant accept)
                    if (data.status.startsWith('pending_')) {
                        transaction.update(friendshipRef, {
                            status: 'accepted',
                            respondedAt: serverTimestamp(),
                            acceptedVia: 'qr_scan'
                        });
                        return { upgraded: true };
                    }
                }

                // Create new instant friendship
                transaction.set(friendshipRef, {
                    participants: sortedParticipants,
                    status: 'accepted',
                    createdBy: scannerUid,
                    createdAt: serverTimestamp(),
                    respondedAt: serverTimestamp(),
                    acceptedVia: 'qr_scan',
                    metadata: {}
                });

                return { created: true };
            });

            if (result.alreadyFriends) {
                console.log(`[FriendshipService] Already friends: ${scannerUid} <-> ${scannedUid}`);
                return { success: true, data: { status: 'already_friends' } };
            }

            console.log(`[FriendshipService] Instant friendship created via QR: ${scannerUid} <-> ${scannedUid}`);
            return { success: true, data: { friendshipId, status: 'accepted', instant: true } };

        }, 'createInstantFriendship');
    }
}

// Export singleton instance
export const friendshipService = new FriendshipService();
