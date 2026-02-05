/**
 * GymbRoomService - Manages shared workout rooms (Gymbro Rooms)
 * 
 * Architecture:
 * - Room document: metadata, status, hostId
 * - Members subcollection: per-user documents for membership
 * - ActiveMetrics subcollection: per-user real-time workout metrics
 * - WorkoutLog subcollection: append-only exercise log for analytics
 * - Invites subcollection: pending invitations
 * 
 * Key Design Decisions:
 * - Per-user metrics documents avoid Firestore's 1 write/sec limit
 * - Batch writes for atomic multi-document operations
 * - Host-only control for room state transitions
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

import {
    db,
    auth,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
    writeBatch,
    runTransaction,
    addDoc
} from '../firebase-config.js';

/**
 * @typedef {Object} RoomConfig
 * @property {string} name - Room display name
 * @property {string} [workoutId] - Optional linked workout template
 * @property {number} [maxCapacity=8] - Maximum members allowed
 * @property {'friends_only'|'invite_only'|'public'} [privacy='friends_only']
 */

/**
 * @typedef {Object} RoomMember
 * @property {string} uid
 * @property {string} displayName
 * @property {string} [photoUrl]
 * @property {boolean} readyStatus
 * @property {'host'|'member'} role
 * @property {Date} joinedAt
 */

/**
 * @typedef {Object} ActiveMetrics
 * @property {string} uid
 * @property {string} currentExercise
 * @property {number} currentSet
 * @property {number} totalVolume
 * @property {number} totalSets
 * @property {number} lastSetWeight
 * @property {number} lastSetReps
 * @property {Date} lastUpdate
 */

/**
 * @typedef {Object} ServiceResult
 * @property {boolean} success
 * @property {*} [data]
 * @property {string} [error]
 * @property {string} [code]
 */

export class GymbRoomService {
    constructor() {
        this.collectionName = 'gymbro_rooms';
        this._retryConfig = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 8000
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
     * Get current user's profile data
     * @returns {Promise<Object>}
     */
    async _getUserProfile() {
        const user = auth.currentUser;
        if (!user) throw new Error('Utente non autenticato');

        return {
            displayName: user.displayName || 'Utente',
            photoUrl: user.photoURL || null,
            email: user.email
        };
    }

    /**
     * Generate a short, readable room ID
     * @returns {string}
     */
    _generateRoomId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 for readability
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
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

                // Don't retry for validation/permission errors
                if (error.code === 'permission-denied' ||
                    error.code === 'invalid-argument' ||
                    error.message?.includes('già') ||
                    error.message?.includes('non trovata')) {
                    throw error;
                }

                const delay = Math.min(
                    this._retryConfig.baseDelay * Math.pow(2, attempt),
                    this._retryConfig.maxDelay
                );

                console.warn(`[GymbRoomService] ${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    // ============================================
    // ROOM MANAGEMENT
    // ============================================

    /**
     * Create a new Gymbro Room
     * Uses batch write to atomically create room + add host as first member
     * 
     * @param {RoomConfig} config - Room configuration
     * @returns {Promise<ServiceResult>}
     */
    async createRoom(config) {
        return this._withRetry(async () => {
            const hostUid = this._getUid();
            const profile = await this._getUserProfile();

            // Validation
            if (!config?.name || typeof config.name !== 'string') {
                return { success: false, error: 'Nome room richiesto', code: 'invalid-argument' };
            }

            if (config.name.length > 50) {
                return { success: false, error: 'Nome troppo lungo (max 50 caratteri)', code: 'invalid-argument' };
            }

            const roomId = this._generateRoomId();
            const roomRef = doc(db, this.collectionName, roomId);
            const memberRef = doc(db, this.collectionName, roomId, 'members', hostUid);
            const metricsRef = doc(db, this.collectionName, roomId, 'activeMetrics', hostUid);

            const batch = writeBatch(db);

            // Create room document
            batch.set(roomRef, {
                hostId: hostUid,
                name: config.name.trim(),
                workoutId: config.workoutId || null,
                status: 'lobby',
                maxCapacity: config.maxCapacity || 8,
                privacy: config.privacy || 'friends_only',
                createdAt: serverTimestamp(),
                lastActivity: serverTimestamp()
            });

            // Add host as first member
            batch.set(memberRef, {
                displayName: profile.displayName,
                photoUrl: profile.photoUrl,
                readyStatus: true, // Host is always ready
                role: 'host',
                joinedAt: serverTimestamp()
            });

            // Initialize host's metrics
            batch.set(metricsRef, {
                currentExercise: null,
                currentSet: 0,
                totalVolume: 0,
                totalSets: 0,
                lastSetWeight: 0,
                lastSetReps: 0,
                lastUpdate: serverTimestamp()
            });

            await batch.commit();

            console.log(`[GymbRoomService] Room ${roomId} created by ${hostUid}`);
            return { success: true, data: { roomId, status: 'lobby' } };

        }, 'createRoom');
    }

    /**
     * Join an existing room
     * 
     * @param {string} roomId - Room to join
     * @returns {Promise<ServiceResult>}
     */
    async joinRoom(roomId) {
        return this._withRetry(async () => {
            const uid = this._getUid();
            const profile = await this._getUserProfile();

            if (!roomId || typeof roomId !== 'string') {
                return { success: false, error: 'ID room non valido', code: 'invalid-argument' };
            }

            const roomRef = doc(db, this.collectionName, roomId);
            const memberRef = doc(db, this.collectionName, roomId, 'members', uid);
            const metricsRef = doc(db, this.collectionName, roomId, 'activeMetrics', uid);

            // Use transaction to check room state and join atomically
            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);

                if (!roomSnap.exists()) {
                    throw new Error('Room non trovata');
                }

                const roomData = roomSnap.data();

                if (roomData.status === 'finished' || roomData.status === 'archived') {
                    throw new Error('Room terminata');
                }

                // Check if already a member
                const memberSnap = await transaction.get(memberRef);
                if (memberSnap.exists()) {
                    throw new Error('Sei già nella room');
                }

                // Check capacity
                const membersSnap = await getDocs(collection(db, this.collectionName, roomId, 'members'));
                if (membersSnap.size >= roomData.maxCapacity) {
                    throw new Error('Room piena');
                }

                // Add as member
                transaction.set(memberRef, {
                    displayName: profile.displayName,
                    photoUrl: profile.photoUrl,
                    readyStatus: false,
                    role: 'member',
                    joinedAt: serverTimestamp()
                });

                // Initialize metrics
                transaction.set(metricsRef, {
                    currentExercise: null,
                    currentSet: 0,
                    totalVolume: 0,
                    totalSets: 0,
                    lastSetWeight: 0,
                    lastSetReps: 0,
                    lastUpdate: serverTimestamp()
                });

                // Update room activity
                transaction.update(roomRef, {
                    lastActivity: serverTimestamp()
                });
            });

            console.log(`[GymbRoomService] User ${uid} joined room ${roomId}`);
            return { success: true, data: { roomId } };

        }, 'joinRoom');
    }

    /**
     * Leave a room
     * If host leaves, room is archived
     * 
     * @param {string} roomId - Room to leave
     * @returns {Promise<ServiceResult>}
     */
    async leaveRoom(roomId) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            if (!roomId || typeof roomId !== 'string') {
                return { success: false, error: 'ID room non valido', code: 'invalid-argument' };
            }

            const roomRef = doc(db, this.collectionName, roomId);
            const memberRef = doc(db, this.collectionName, roomId, 'members', uid);
            const metricsRef = doc(db, this.collectionName, roomId, 'activeMetrics', uid);

            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return { success: false, error: 'Room non trovata', code: 'not-found' };
            }

            const roomData = roomSnap.data();
            const isHost = roomData.hostId === uid;

            const batch = writeBatch(db);

            // Remove member and their metrics
            batch.delete(memberRef);
            batch.delete(metricsRef);

            if (isHost) {
                // Archive the room if host leaves
                batch.update(roomRef, {
                    status: 'archived',
                    archivedAt: serverTimestamp(),
                    archivedReason: 'host_left'
                });
                console.log(`[GymbRoomService] Host ${uid} left, archiving room ${roomId}`);
            } else {
                // Just update activity
                batch.update(roomRef, {
                    lastActivity: serverTimestamp()
                });
            }

            await batch.commit();

            console.log(`[GymbRoomService] User ${uid} left room ${roomId}`);
            return { success: true, data: { wasHost: isHost } };

        }, 'leaveRoom');
    }

    /**
     * Update ready status in lobby
     * 
     * @param {string} roomId 
     * @param {boolean} isReady 
     * @returns {Promise<ServiceResult>}
     */
    async setReadyStatus(roomId, isReady) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const memberRef = doc(db, this.collectionName, roomId, 'members', uid);

            await updateDoc(memberRef, {
                readyStatus: !!isReady
            });

            return { success: true };

        }, 'setReadyStatus');
    }

    /**
     * Start the workout (host only)
     * Transitions room from 'lobby' to 'active'
     * 
     * @param {string} roomId 
     * @returns {Promise<ServiceResult>}
     */
    async startWorkout(roomId) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            if (!roomId) {
                return { success: false, error: 'ID room richiesto', code: 'invalid-argument' };
            }

            const roomRef = doc(db, this.collectionName, roomId);

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);

                if (!roomSnap.exists()) {
                    throw new Error('Room non trovata');
                }

                const roomData = roomSnap.data();

                if (roomData.hostId !== uid) {
                    throw new Error('Solo l\'host può avviare l\'allenamento');
                }

                if (roomData.status !== 'lobby') {
                    throw new Error('L\'allenamento è già in corso o terminato');
                }

                transaction.update(roomRef, {
                    status: 'active',
                    startedAt: serverTimestamp(),
                    lastActivity: serverTimestamp()
                });
            });

            console.log(`[GymbRoomService] Workout started in room ${roomId}`);
            return { success: true, data: { status: 'active' } };

        }, 'startWorkout');
    }

    /**
     * End the workout (host only)
     * Transitions room from 'active' to 'finished'
     * 
     * @param {string} roomId 
     * @returns {Promise<ServiceResult>}
     */
    async endWorkout(roomId) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            if (!roomId) {
                return { success: false, error: 'ID room richiesto', code: 'invalid-argument' };
            }

            const roomRef = doc(db, this.collectionName, roomId);

            let finalMetrics = [];

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);

                if (!roomSnap.exists()) {
                    throw new Error('Room non trovata');
                }

                const roomData = roomSnap.data();

                if (roomData.hostId !== uid) {
                    throw new Error('Solo l\'host può terminare l\'allenamento');
                }

                if (roomData.status !== 'active') {
                    throw new Error('L\'allenamento non è in corso');
                }

                // Get final metrics for summary
                const metricsSnap = await getDocs(
                    collection(db, this.collectionName, roomId, 'activeMetrics')
                );

                finalMetrics = metricsSnap.docs.map(d => ({
                    uid: d.id,
                    ...d.data()
                }));

                transaction.update(roomRef, {
                    status: 'finished',
                    finishedAt: serverTimestamp(),
                    lastActivity: serverTimestamp(),
                    finalLeaderboard: finalMetrics.sort((a, b) => b.totalVolume - a.totalVolume)
                });
            });

            console.log(`[GymbRoomService] Workout ended in room ${roomId}`);
            return {
                success: true,
                data: {
                    status: 'finished',
                    leaderboard: finalMetrics.sort((a, b) => b.totalVolume - a.totalVolume)
                }
            };

        }, 'endWorkout');
    }

    // ============================================
    // QUERIES
    // ============================================

    /**
     * Get room details
     * 
     * @param {string} roomId 
     * @returns {Promise<ServiceResult>}
     */
    async getRoom(roomId) {
        return this._withRetry(async () => {
            const roomRef = doc(db, this.collectionName, roomId);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return { success: false, error: 'Room non trovata', code: 'not-found' };
            }

            return {
                success: true,
                data: {
                    roomId,
                    ...roomSnap.data(),
                    createdAt: roomSnap.data().createdAt?.toDate?.(),
                    startedAt: roomSnap.data().startedAt?.toDate?.(),
                    finishedAt: roomSnap.data().finishedAt?.toDate?.()
                }
            };

        }, 'getRoom');
    }

    /**
     * Get all members of a room
     * 
     * @param {string} roomId 
     * @returns {Promise<ServiceResult>}
     */
    async getRoomMembers(roomId) {
        return this._withRetry(async () => {
            const membersRef = collection(db, this.collectionName, roomId, 'members');
            const q = query(membersRef, orderBy('joinedAt', 'asc'));

            const membersSnap = await getDocs(q);

            const members = membersSnap.docs.map(d => ({
                uid: d.id,
                ...d.data(),
                joinedAt: d.data().joinedAt?.toDate?.()
            }));

            return { success: true, data: members };

        }, 'getRoomMembers');
    }

    /**
     * Get current leaderboard (active metrics sorted by volume)
     * 
     * @param {string} roomId 
     * @returns {Promise<ServiceResult>}
     */
    async getLeaderboard(roomId) {
        return this._withRetry(async () => {
            const metricsRef = collection(db, this.collectionName, roomId, 'activeMetrics');
            const metricsSnap = await getDocs(metricsRef);

            const leaderboard = metricsSnap.docs
                .map(d => ({
                    uid: d.id,
                    ...d.data(),
                    lastUpdate: d.data().lastUpdate?.toDate?.()
                }))
                .sort((a, b) => b.totalVolume - a.totalVolume)
                .map((m, i) => ({ ...m, rank: i + 1 }));

            return { success: true, data: leaderboard };

        }, 'getLeaderboard');
    }

    /**
     * Get user's active rooms (rooms they're currently a member of)
     * 
     * @returns {Promise<ServiceResult>}
     */
    async getMyActiveRooms() {
        return this._withRetry(async () => {
            const uid = this._getUid();

            // Query all rooms and filter by membership
            // Note: This is a limitation - ideally we'd have a userRooms subcollection per user
            const roomsRef = collection(db, this.collectionName);
            const q = query(
                roomsRef,
                where('status', 'in', ['lobby', 'active']),
                orderBy('lastActivity', 'desc'),
                limit(20)
            );

            const roomsSnap = await getDocs(q);

            const myRooms = [];

            for (const roomDoc of roomsSnap.docs) {
                const memberRef = doc(db, this.collectionName, roomDoc.id, 'members', uid);
                const memberSnap = await getDoc(memberRef);

                if (memberSnap.exists()) {
                    myRooms.push({
                        roomId: roomDoc.id,
                        ...roomDoc.data(),
                        myRole: memberSnap.data().role,
                        createdAt: roomDoc.data().createdAt?.toDate?.()
                    });
                }
            }

            return { success: true, data: myRooms };

        }, 'getMyActiveRooms');
    }

    // ============================================
    // INVITATIONS
    // ============================================

    /**
     * Invite a user to the room (host only)
     * 
     * @param {string} roomId 
     * @param {string} inviteeUid 
     * @returns {Promise<ServiceResult>}
     */
    async inviteMember(roomId, inviteeUid) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            if (!inviteeUid) {
                return { success: false, error: 'ID utente richiesto', code: 'invalid-argument' };
            }

            const roomRef = doc(db, this.collectionName, roomId);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return { success: false, error: 'Room non trovata', code: 'not-found' };
            }

            const roomData = roomSnap.data();

            if (roomData.hostId !== uid) {
                return { success: false, error: 'Solo l\'host può invitare', code: 'permission-denied' };
            }

            // Check if already invited
            const invitesRef = collection(db, this.collectionName, roomId, 'invites');
            const existingInvite = await getDocs(
                query(invitesRef, where('inviteeUid', '==', inviteeUid))
            );

            if (!existingInvite.empty) {
                return { success: false, error: 'Utente già invitato', code: 'already-exists' };
            }

            // Check if already a member
            const memberRef = doc(db, this.collectionName, roomId, 'members', inviteeUid);
            const memberSnap = await getDoc(memberRef);

            if (memberSnap.exists()) {
                return { success: false, error: 'Utente già nella room', code: 'already-exists' };
            }

            // Create invite
            await addDoc(invitesRef, {
                inviteeUid,
                invitedBy: uid,
                roomName: roomData.name,
                status: 'pending',
                createdAt: serverTimestamp()
            });

            console.log(`[GymbRoomService] User ${inviteeUid} invited to room ${roomId}`);
            return { success: true };

        }, 'inviteMember');
    }

    /**
     * Get pending invites for the current user
     * 
     * @returns {Promise<ServiceResult>}
     */
    async getMyInvites() {
        return this._withRetry(async () => {
            const uid = this._getUid();

            // This requires a collection group query
            // For now, we'll need to query each room's invites
            // A better approach would be a top-level invites collection
            const roomsRef = collection(db, this.collectionName);
            const roomsSnap = await getDocs(query(roomsRef, where('status', 'in', ['lobby', 'active'])));

            const invites = [];

            for (const roomDoc of roomsSnap.docs) {
                const invitesRef = collection(db, this.collectionName, roomDoc.id, 'invites');
                const inviteSnap = await getDocs(
                    query(invitesRef, where('inviteeUid', '==', uid), where('status', '==', 'pending'))
                );

                for (const inviteDoc of inviteSnap.docs) {
                    invites.push({
                        inviteId: inviteDoc.id,
                        roomId: roomDoc.id,
                        ...inviteDoc.data(),
                        createdAt: inviteDoc.data().createdAt?.toDate?.()
                    });
                }
            }

            return { success: true, data: invites };

        }, 'getMyInvites');
    }

    /**
     * Accept an invitation
     * 
     * @param {string} roomId 
     * @param {string} inviteId 
     * @returns {Promise<ServiceResult>}
     */
    async acceptInvite(roomId, inviteId) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const inviteRef = doc(db, this.collectionName, roomId, 'invites', inviteId);
            const inviteSnap = await getDoc(inviteRef);

            if (!inviteSnap.exists()) {
                return { success: false, error: 'Invito non trovato', code: 'not-found' };
            }

            const inviteData = inviteSnap.data();

            if (inviteData.inviteeUid !== uid) {
                return { success: false, error: 'Questo invito non è per te', code: 'permission-denied' };
            }

            // Join the room
            const joinResult = await this.joinRoom(roomId);

            if (!joinResult.success) {
                return joinResult;
            }

            // Delete the invite
            await deleteDoc(inviteRef);

            return { success: true, data: { roomId } };

        }, 'acceptInvite');
    }

    /**
     * Decline an invitation
     * 
     * @param {string} roomId 
     * @param {string} inviteId 
     * @returns {Promise<ServiceResult>}
     */
    async declineInvite(roomId, inviteId) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const inviteRef = doc(db, this.collectionName, roomId, 'invites', inviteId);
            const inviteSnap = await getDoc(inviteRef);

            if (!inviteSnap.exists()) {
                return { success: false, error: 'Invito non trovato', code: 'not-found' };
            }

            const inviteData = inviteSnap.data();

            if (inviteData.inviteeUid !== uid) {
                return { success: false, error: 'Questo invito non è per te', code: 'permission-denied' };
            }

            await deleteDoc(inviteRef);

            return { success: true };

        }, 'declineInvite');
    }

    // ============================================
    // HOST ACTIONS
    // ============================================

    /**
     * Kick a member from the room (host only)
     * 
     * @param {string} roomId 
     * @param {string} memberUid 
     * @returns {Promise<ServiceResult>}
     */
    async kickMember(roomId, memberUid) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            const roomRef = doc(db, this.collectionName, roomId);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return { success: false, error: 'Room non trovata', code: 'not-found' };
            }

            if (roomSnap.data().hostId !== uid) {
                return { success: false, error: 'Solo l\'host può rimuovere membri', code: 'permission-denied' };
            }

            if (memberUid === uid) {
                return { success: false, error: 'Usa leaveRoom per uscire', code: 'invalid-argument' };
            }

            const memberRef = doc(db, this.collectionName, roomId, 'members', memberUid);
            const metricsRef = doc(db, this.collectionName, roomId, 'activeMetrics', memberUid);

            const batch = writeBatch(db);
            batch.delete(memberRef);
            batch.delete(metricsRef);
            await batch.commit();

            console.log(`[GymbRoomService] User ${memberUid} kicked from room ${roomId}`);
            return { success: true };

        }, 'kickMember');
    }

    /**
     * Transfer host role to another member
     * 
     * @param {string} roomId 
     * @param {string} newHostUid 
     * @returns {Promise<ServiceResult>}
     */
    async transferHost(roomId, newHostUid) {
        return this._withRetry(async () => {
            const uid = this._getUid();

            if (uid === newHostUid) {
                return { success: false, error: 'Sei già l\'host', code: 'invalid-argument' };
            }

            const roomRef = doc(db, this.collectionName, roomId);
            const currentHostMemberRef = doc(db, this.collectionName, roomId, 'members', uid);
            const newHostMemberRef = doc(db, this.collectionName, roomId, 'members', newHostUid);

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                const newHostSnap = await transaction.get(newHostMemberRef);

                if (!roomSnap.exists()) {
                    throw new Error('Room non trovata');
                }

                if (roomSnap.data().hostId !== uid) {
                    throw new Error('Solo l\'host può trasferire il ruolo');
                }

                if (!newHostSnap.exists()) {
                    throw new Error('Il nuovo host deve essere un membro della room');
                }

                // Update room
                transaction.update(roomRef, { hostId: newHostUid });

                // Update roles
                transaction.update(currentHostMemberRef, { role: 'member' });
                transaction.update(newHostMemberRef, { role: 'host' });
            });

            console.log(`[GymbRoomService] Host transferred from ${uid} to ${newHostUid} in room ${roomId}`);
            return { success: true };

        }, 'transferHost');
    }
}

// Export singleton instance
export const gymbRoomService = new GymbRoomService();
