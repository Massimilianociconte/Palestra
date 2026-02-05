/**
 * Storage Utilities - Gestione sicura di localStorage
 * Fornisce wrapper per operazioni di storage con error handling,
 * quota management e validazione dati.
 * 
 * @author IronFlow Team
 * @version 1.0.0
 */

// ============================================
// CONSTANTS
// ============================================

const STORAGE_PREFIX = 'ironflow_';
const STORAGE_QUOTA_WARNING_THRESHOLD = 0.9; // 90% of quota
const MAX_SAFE_ITEM_SIZE = 4 * 1024 * 1024; // 4MB per item (safe limit)

// ============================================
// SAFE JSON UTILITIES
// ============================================

/**
 * Safely parse JSON with fallback value.
 * Prevents app crashes from corrupted localStorage data.
 * 
 * @param {string} jsonString - JSON string to parse
 * @param {*} fallback - Fallback value if parsing fails (default: null)
 * @param {string} context - Optional context for error logging
 * @returns {*} Parsed object or fallback value
 */
export function safeJSONParse(jsonString, fallback = null, context = '') {
    if (jsonString === null || jsonString === undefined) {
        return fallback;
    }
    
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.warn(
            `[StorageUtils] JSON parse error${context ? ` in ${context}` : ''}:`,
            error.message
        );
        return fallback;
    }
}

/**
 * Safely stringify JSON with error handling.
 * 
 * @param {*} obj - Object to stringify
 * @param {string} context - Optional context for error logging
 * @returns {string|null} JSON string or null on error
 */
export function safeJSONStringify(obj, context = '') {
    try {
        return JSON.stringify(obj);
    } catch (error) {
        console.error(
            `[StorageUtils] JSON stringify error${context ? ` in ${context}` : ''}:`,
            error.message
        );
        return null;
    }
}

// ============================================
// LOCAL STORAGE WRAPPER
// ============================================

/**
 * Safely get item from localStorage with JSON parsing.
 * 
 * @param {string} key - Storage key (with or without prefix)
 * @param {*} fallback - Fallback value if key doesn't exist or parse fails
 * @returns {*} Stored value or fallback
 */
export function getStorageItem(key, fallback = null) {
    const fullKey = key.startsWith(STORAGE_PREFIX) ? key : STORAGE_PREFIX + key;
    
    try {
        const raw = localStorage.getItem(fullKey);
        if (raw === null) return fallback;
        return safeJSONParse(raw, fallback, fullKey);
    } catch (error) {
        console.error(`[StorageUtils] Error reading ${fullKey}:`, error.message);
        return fallback;
    }
}

/**
 * Safely set item in localStorage with JSON stringification.
 * Includes quota management and data size validation.
 * 
 * @param {string} key - Storage key (with or without prefix)
 * @param {*} value - Value to store
 * @param {Object} options - Optional configuration
 * @param {boolean} options.compress - Whether to attempt compression (future feature)
 * @returns {{success: boolean, error?: string}} Result object
 */
export function setStorageItem(key, value, options = {}) {
    const fullKey = key.startsWith(STORAGE_PREFIX) ? key : STORAGE_PREFIX + key;
    
    try {
        const jsonString = safeJSONStringify(value, fullKey);
        if (jsonString === null) {
            return { success: false, error: 'Failed to stringify value' };
        }
        
        // Check item size before attempting to store
        const sizeBytes = new Blob([jsonString]).size;
        if (sizeBytes > MAX_SAFE_ITEM_SIZE) {
            console.warn(`[StorageUtils] Item ${fullKey} is too large (${(sizeBytes / 1024 / 1024).toFixed(2)}MB)`);
            return { success: false, error: 'Item too large for localStorage' };
        }
        
        localStorage.setItem(fullKey, jsonString);
        return { success: true };
        
    } catch (error) {
        // Handle quota exceeded error
        if (error.name === 'QuotaExceededError' || 
            error.code === 22 || 
            error.message.includes('quota')) {
            console.error(`[StorageUtils] Storage quota exceeded for ${fullKey}`);
            
            // Attempt cleanup and retry
            const cleaned = attemptStorageCleanup();
            if (cleaned) {
                try {
                    localStorage.setItem(fullKey, safeJSONStringify(value, fullKey));
                    console.log(`[StorageUtils] Successfully stored ${fullKey} after cleanup`);
                    return { success: true, cleaned: true };
                } catch (retryError) {
                    return { success: false, error: 'Storage quota exceeded even after cleanup' };
                }
            }
            
            return { success: false, error: 'Storage quota exceeded' };
        }
        
        console.error(`[StorageUtils] Error writing ${fullKey}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Remove item from localStorage.
 * 
 * @param {string} key - Storage key (with or without prefix)
 */
export function removeStorageItem(key) {
    const fullKey = key.startsWith(STORAGE_PREFIX) ? key : STORAGE_PREFIX + key;
    try {
        localStorage.removeItem(fullKey);
    } catch (error) {
        console.error(`[StorageUtils] Error removing ${fullKey}:`, error.message);
    }
}

// ============================================
// STORAGE QUOTA MANAGEMENT
// ============================================

/**
 * Estimate current localStorage usage.
 * 
 * @returns {{used: number, total: number, percentage: number}} Usage stats in bytes
 */
export function getStorageUsage() {
    let used = 0;
    
    try {
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                used += localStorage[key].length * 2; // UTF-16 = 2 bytes per char
            }
        }
    } catch (error) {
        console.error('[StorageUtils] Error calculating usage:', error.message);
    }
    
    // Most browsers have 5-10MB limit
    const estimated_total = 5 * 1024 * 1024; // 5MB conservative estimate
    
    return {
        used,
        total: estimated_total,
        percentage: (used / estimated_total) * 100,
        usedMB: (used / 1024 / 1024).toFixed(2),
        isNearQuota: (used / estimated_total) > STORAGE_QUOTA_WARNING_THRESHOLD
    };
}

/**
 * Attempt to free up storage space by removing old/unnecessary data.
 * Prioritizes removing:
 * 1. Old AI history entries
 * 2. Cached data
 * 3. Debug/temp data
 * 
 * @returns {boolean} Whether cleanup was successful
 */
export function attemptStorageCleanup() {
    console.log('[StorageUtils] Attempting storage cleanup...');
    let freedSpace = false;
    
    try {
        // 1. Trim AI history to last 15 entries
        const aiHistory = getStorageItem('ai_plan_history', []);
        if (aiHistory.length > 15) {
            setStorageItem('ai_plan_history', aiHistory.slice(0, 15));
            console.log(`[StorageUtils] Trimmed AI history from ${aiHistory.length} to 15 entries`);
            freedSpace = true;
        }
        
        // 2. Remove any temp/cache keys
        const tempKeys = ['temp_', 'cache_', 'debug_'];
        for (let key in localStorage) {
            if (tempKeys.some(prefix => key.includes(prefix))) {
                localStorage.removeItem(key);
                console.log(`[StorageUtils] Removed temp key: ${key}`);
                freedSpace = true;
            }
        }
        
        // 3. Trim old logs (keep last 100)
        const logs = getStorageItem('logs', []);
        if (logs.length > 100) {
            const trimmedLogs = logs.slice(-100);
            setStorageItem('logs', trimmedLogs);
            console.log(`[StorageUtils] Trimmed logs from ${logs.length} to 100 entries`);
            freedSpace = true;
        }
        
    } catch (error) {
        console.error('[StorageUtils] Error during cleanup:', error.message);
    }
    
    return freedSpace;
}

// ============================================
// DATE UTILITIES
// ============================================

/**
 * Standardize date to ISO format (YYYY-MM-DD).
 * Handles various input formats consistently.
 * 
 * @param {string|Date|number} input - Date input (string, Date object, or timestamp)
 * @returns {string|null} ISO date string (YYYY-MM-DD) or null if invalid
 */
export function standardizeDate(input) {
    if (!input) return null;
    
    try {
        let date;
        
        if (input instanceof Date) {
            date = input;
        } else if (typeof input === 'number') {
            date = new Date(input);
        } else if (typeof input === 'string') {
            // Handle common formats
            // DD/MM/YYYY
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
                const [day, month, year] = input.split('/');
                date = new Date(`${year}-${month}-${day}`);
            }
            // DD-MM-YYYY
            else if (/^\d{2}-\d{2}-\d{4}$/.test(input)) {
                const [day, month, year] = input.split('-');
                date = new Date(`${year}-${month}-${day}`);
            }
            // Already ISO or parseable
            else {
                date = new Date(input);
            }
        }
        
        if (date && !isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
        
        return null;
    } catch (error) {
        console.warn(`[StorageUtils] Invalid date format: ${input}`);
        return null;
    }
}

/**
 * Get current date as ISO string (YYYY-MM-DD).
 * 
 * @returns {string} Current date in ISO format
 */
export function getTodayISO() {
    return new Date().toISOString().split('T')[0];
}

// ============================================
// DATA VALIDATION HELPERS
// ============================================

/**
 * Validate that a value is a non-empty array.
 * 
 * @param {*} value - Value to check
 * @returns {boolean} True if valid non-empty array
 */
export function isValidArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Validate that a value is a non-null object.
 * 
 * @param {*} value - Value to check
 * @returns {boolean} True if valid object
 */
export function isValidObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Clamp a number within a range.
 * 
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// Export a default object for convenience
export default {
    safeJSONParse,
    safeJSONStringify,
    getStorageItem,
    setStorageItem,
    removeStorageItem,
    getStorageUsage,
    attemptStorageCleanup,
    standardizeDate,
    getTodayISO,
    isValidArray,
    isValidObject,
    clamp
};
