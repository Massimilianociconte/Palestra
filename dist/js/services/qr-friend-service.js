/**
 * QRFriendService - QR Code generation and scanning for instant friendships
 * 
 * Uses:
 * - QRCode.js library for generation (loaded from CDN)
 * - @capacitor/barcode-scanner for native scanning
 * 
 * @author Gymbro Team
 * @version 1.1.0
 */

import { auth } from '../firebase-config.js';
import { friendshipService } from './friendship-service.js';

// QR Code format: gymbro://friend/{uid}
const QR_PREFIX = 'gymbro://friend/';

export class QRFriendService {
    constructor() {
        this._scanner = null;
        this._qrLibLoaded = false;
    }

    /**
     * Get current user UID
     * @returns {string}
     */
    _getUid() {
        const user = auth.currentUser;
        if (!user) throw new Error('Utente non autenticato');
        return user.uid;
    }

    /**
     * Load QRCode.js library dynamically
     * @returns {Promise<void>}
     */
    async _loadQRLibrary() {
        if (this._qrLibLoaded && window.QRCode) {
            return;
        }

        // Check if already loaded
        if (window.QRCode) {
            this._qrLibLoaded = true;
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            script.onload = () => {
                console.log('[QRFriendService] QRCode library loaded');
                this._qrLibLoaded = true;
                resolve();
            };
            script.onerror = (err) => {
                console.error('[QRFriendService] Failed to load QRCode library:', err);
                reject(new Error('Impossibile caricare la libreria QR. Verifica la connessione internet.'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Generate QR code and render to canvas element
     * @param {HTMLCanvasElement} canvas - Canvas element to render to
     * @param {Object} options - QR generation options
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async renderQRToCanvas(canvas, options = {}) {
        try {
            const uid = this._getUid();
            const qrData = `${QR_PREFIX}${uid}`;

            console.log('[QRFriendService] Generating QR for UID:', uid);

            await this._loadQRLibrary();

            if (!window.QRCode) {
                throw new Error('Libreria QR non disponibile');
            }

            const size = options.size || 200;
            const color = options.color || '#00f3ff';

            await window.QRCode.toCanvas(canvas, qrData, {
                width: size,
                margin: 2,
                color: {
                    dark: color,
                    light: '#121212'
                },
                errorCorrectionLevel: 'H'
            });

            console.log('[QRFriendService] QR code generated successfully');
            return { success: true };
        } catch (error) {
            console.error('[QRFriendService] Error rendering QR:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if native scanner is available (Capacitor)
     * @returns {boolean}
     */
    isNativeScannerAvailable() {
        const isNative = typeof window.Capacitor !== 'undefined' && 
               window.Capacitor.isNativePlatform();
        console.log('[QRFriendService] isNativeScannerAvailable:', isNative);
        return isNative;
    }

    /**
     * Get the barcode scanner plugin from Capacitor
     * @returns {Promise<Object|null>}
     */
    async _getScanner() {
        if (this._scanner) return this._scanner;

        try {
            // Access the plugin through Capacitor.Plugins
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorBarcodeScanner) {
                this._scanner = window.Capacitor.Plugins.CapacitorBarcodeScanner;
                console.log('[QRFriendService] Scanner plugin found via Capacitor.Plugins');
                return this._scanner;
            }

            // Fallback: try to access via registered plugins
            if (window.CapacitorBarcodeScanner) {
                this._scanner = window.CapacitorBarcodeScanner;
                console.log('[QRFriendService] Scanner plugin found via window');
                return this._scanner;
            }

            console.warn('[QRFriendService] Scanner plugin not found');
            return null;
        } catch (error) {
            console.error('[QRFriendService] Error getting scanner:', error);
            return null;
        }
    }

    /**
     * Start QR code scanning using Capacitor plugin
     * @returns {Promise<{success: boolean, uid?: string, error?: string}>}
     */
    async startScan() {
        try {
            if (!this.isNativeScannerAvailable()) {
                return { success: false, error: 'Scanner disponibile solo su app Android' };
            }

            const scanner = await this._getScanner();
            if (!scanner) {
                return { success: false, error: 'Plugin scanner non trovato. Riavvia l\'app.' };
            }

            console.log('[QRFriendService] Starting scan...');

            // Use the Capacitor barcode scanner API
            const result = await scanner.scanBarcode({
                hint: 0, // QR_CODE = 0
                scanInstructions: 'Inquadra il QR Code del tuo amico',
                scanButton: false,
                cameraDirection: 1 // BACK camera
            });

            console.log('[QRFriendService] Scan result:', result);

            if (result && result.ScanResult) {
                const scannedData = result.ScanResult;
                
                // Validate QR format
                if (!scannedData.startsWith(QR_PREFIX)) {
                    return { success: false, error: 'QR Code non valido per GymBro' };
                }

                const scannedUid = scannedData.replace(QR_PREFIX, '');
                
                if (!scannedUid || scannedUid.length < 10) {
                    return { success: false, error: 'QR Code corrotto' };
                }

                return { success: true, uid: scannedUid };
            }

            return { success: false, error: 'Scansione annullata' };

        } catch (error) {
            console.error('[QRFriendService] Scan error:', error);
            
            // Handle user cancellation
            if (error.message?.includes('cancel') || error.message?.includes('Cancel')) {
                return { success: false, error: 'Scansione annullata' };
            }
            
            return { success: false, error: error.message || 'Errore durante la scansione' };
        }
    }

    /**
     * Scan QR and create instant friendship
     * @returns {Promise<{success: boolean, friendUid?: string, status?: string, error?: string}>}
     */
    async scanAndAddFriend() {
        try {
            // Step 1: Scan QR
            const scanResult = await this.startScan();
            
            if (!scanResult.success) {
                return scanResult;
            }

            const scannedUid = scanResult.uid;
            console.log('[QRFriendService] Scanned UID:', scannedUid);

            // Step 2: Create instant friendship (bypasses approval)
            const friendResult = await friendshipService.createInstantFriendship(scannedUid);

            if (!friendResult.success) {
                return { success: false, error: friendResult.error };
            }

            return {
                success: true,
                friendUid: scannedUid,
                status: friendResult.data.status,
                isNew: friendResult.data.status !== 'already_friends'
            };

        } catch (error) {
            console.error('[QRFriendService] scanAndAddFriend error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Parse a QR code string
     * @param {string} qrContent - Content from QR code
     * @returns {{success: boolean, uid?: string, error?: string}}
     */
    parseQRContent(qrContent) {
        if (!qrContent || typeof qrContent !== 'string') {
            return { success: false, error: 'Contenuto QR non valido' };
        }

        if (!qrContent.startsWith(QR_PREFIX)) {
            return { success: false, error: 'QR Code non valido per GymBro' };
        }

        const uid = qrContent.replace(QR_PREFIX, '').trim();

        if (!uid || uid.length < 10) {
            return { success: false, error: 'QR Code corrotto' };
        }

        return { success: true, uid };
    }
}

// Export singleton instance
export const qrFriendService = new QRFriendService();
