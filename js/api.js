/* 
   IRONFLOW - API Service
   Handles synchronization with JSONbin.io
*/

// Prevent redeclaration if script is loaded multiple times
if (typeof StorageService === 'undefined') {
    class StorageService {
        constructor() {
            this.apiKey = localStorage.getItem('ironflow_apikey') || '';
            this.binId = localStorage.getItem('ironflow_binid') || '';
            this.baseUrl = 'https://api.jsonbin.io/v3/b';
        }

        hasCredentials() {
            return this.apiKey && this.binId;
        }

        saveCredentials(key, binId) {
            this.apiKey = key;
            this.binId = binId;
            localStorage.setItem('ironflow_apikey', key);
            localStorage.setItem('ironflow_binid', binId);
        }

        async syncData() {
            if (!this.hasCredentials()) {
                console.warn('No API credentials found. Using local storage only.');
                return { success: false, message: 'Credenziali mancanti' };
            }

            // 1. Get Local Data
            const localWorkouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
            const localLogs = JSON.parse(localStorage.getItem('ironflow_logs') || '[]');
            const localProfile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');

            const payload = {
                workouts: localWorkouts,
                logs: localLogs,
                profile: localProfile,
                lastUpdated: new Date().toISOString()
            };

            try {
                // 2. PUT to JSONbin (Update existing bin)
                const response = await fetch(`${this.baseUrl}/${this.binId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Master-Key': this.apiKey
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error('API Error: ' + response.statusText);

                const result = await response.json();
                console.log('Data synced to cloud:', result);
                return { success: true, message: 'Sincronizzazione completata' };

            } catch (error) {
                console.error('Sync failed:', error);
                return { success: false, message: 'Errore Sync: ' + error.message };
            }
        }

        async loadFromCloud() {
            if (!this.hasCredentials()) return;

            try {
                const response = await fetch(`${this.baseUrl}/${this.binId}/latest`, {
                    method: 'GET',
                    headers: {
                        'X-Master-Key': this.apiKey
                    }
                });

                if (!response.ok) throw new Error('API Error');

                const result = await response.json();
                const data = result.record;

                if (data) {
                    // Only overwrite if cloud has data, or if local is empty. 
                    // Prevent wiping local work with empty cloud bin.
                    if (data.workouts && Array.isArray(data.workouts) && data.workouts.length > 0) {
                        localStorage.setItem('ironflow_workouts', JSON.stringify(data.workouts));
                    }
                    if (data.logs) localStorage.setItem('ironflow_logs', JSON.stringify(data.logs));
                    if (data.profile) localStorage.setItem('ironflow_profile', JSON.stringify(data.profile));

                    console.log('Data loaded from cloud');
                    return true;
                }
            } catch (error) {
                console.error('Load failed:', error);
                return false;
            }
        }
    }

    window.StorageService = StorageService;
}

if (!window.storageService) {
    window.storageService = new window.StorageService();
}
