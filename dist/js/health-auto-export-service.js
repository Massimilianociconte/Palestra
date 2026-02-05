/**
 * Health Auto Export Service
 * Integrazione con l'app iOS "Health Auto Export" per ricevere dati Apple Health
 * 
 * L'app invia dati via webhook alle Firebase Functions
 */

class HealthAutoExportService {
    constructor() {
        this.isConfigured = false;
        this.setupInfo = null;
    }

    /**
     * Inizializza il servizio
     */
    async init() {
        if (typeof firebase === 'undefined') {
            console.error('HealthAutoExportService: Firebase not loaded');
            return false;
        }
        
        const user = firebase.auth().currentUser;
        if (!user) {
            console.log('HealthAutoExportService: User not authenticated');
            return false;
        }

        // Check if already configured
        await this.checkConfiguration();
        return true;
    }

    /**
     * Verifica se l'utente ha già configurato Health Auto Export
     */
    async checkConfiguration() {
        try {
            const user = firebase.auth().currentUser;
            if (!user) return false;

            const userDoc = await firebase.firestore()
                .collection('users')
                .doc(user.uid)
                .get();

            if (userDoc.exists) {
                const data = userDoc.data();
                this.isConfigured = data.appleHealthEnabled === true;
                return this.isConfigured;
            }
            return false;
        } catch (error) {
            console.error('Error checking Health Auto Export config:', error);
            return false;
        }
    }

    /**
     * Ottiene le istruzioni di setup per l'utente
     */
    async getSetupInstructions() {
        try {
            const getSetup = firebase.functions().httpsCallable('getHealthAutoExportSetup');
            const result = await getSetup();
            
            this.setupInfo = result.data.setup;
            return this.setupInfo;
        } catch (error) {
            console.error('Error getting setup instructions:', error);
            throw error;
        }
    }

    /**
     * Recupera gli ultimi dati health salvati
     */
    async getLatestHealthData(days = 7) {
        try {
            const user = firebase.auth().currentUser;
            if (!user) throw new Error('User not authenticated');

            const endDate = new Date();
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            
            const snapshot = await firebase.firestore()
                .collection('users')
                .doc(user.uid)
                .collection('health')
                .where('source', '==', 'apple_health_auto_export')
                .orderBy('appleHealthLastUpdate', 'desc')
                .limit(days)
                .get();

            const healthData = [];
            snapshot.forEach(doc => {
                healthData.push({
                    date: doc.id,
                    ...doc.data()
                });
            });

            return healthData;
        } catch (error) {
            console.error('Error fetching health data:', error);
            return [];
        }
    }

    /**
     * Genera il QR code con le info di setup (per facilitare la configurazione)
     */
    generateSetupQRData() {
        if (!this.setupInfo) {
            console.warn('Setup info not loaded. Call getSetupInstructions first.');
            return null;
        }

        return JSON.stringify({
            url: this.setupInfo.webhookUrl,
            headers: this.setupInfo.headers
        });
    }

    /**
     * Mostra il modal di setup
     */
    async showSetupModal() {
        try {
            const setup = await this.getSetupInstructions();
            
            const modalHtml = `
                <div class="modal fade" id="healthAutoExportModal" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">
                                    <i class="bi bi-apple me-2"></i>
                                    Configura Health Auto Export
                                </h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="alert alert-info">
                                    <i class="bi bi-info-circle me-2"></i>
                                    <strong>Health Auto Export</strong> è un'app iOS che esporta automaticamente 
                                    i dati di Apple Health verso la tua webapp.
                                </div>
                                
                                <h6 class="mt-4">📱 Step 1: Scarica l'app</h6>
                                <p>
                                    <a href="https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069" 
                                       target="_blank" class="btn btn-dark">
                                        <i class="bi bi-apple me-2"></i>App Store (€2.99)
                                    </a>
                                </p>
                                
                                <h6 class="mt-4">⚙️ Step 2: Configura l'automazione</h6>
                                <ol>
                                    <li>Apri l'app e concedi accesso a Apple Health</li>
                                    <li>Vai su <strong>Automations</strong> → <strong>Create new</strong></li>
                                    <li>Seleziona i dati: Steps, Heart Rate, Sleep, Workouts, etc.</li>
                                    <li>Imposta <strong>Destination</strong>: <code>REST API</code></li>
                                </ol>
                                
                                <h6 class="mt-4">🔗 Step 3: Inserisci questi dati</h6>
                                <div class="bg-light p-3 rounded">
                                    <div class="mb-3">
                                        <label class="form-label fw-bold">Webhook URL:</label>
                                        <div class="input-group">
                                            <input type="text" class="form-control font-monospace" 
                                                   value="${setup.webhookUrl}" readonly id="webhookUrl">
                                            <button class="btn btn-outline-secondary" type="button" 
                                                    onclick="navigator.clipboard.writeText('${setup.webhookUrl}')">
                                                <i class="bi bi-clipboard"></i>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div class="mb-3">
                                        <label class="form-label fw-bold">Headers (aggiungi entrambi):</label>
                                        <div class="font-monospace small bg-white p-2 rounded border">
                                            <div class="mb-1">
                                                <strong>x-user-id:</strong> 
                                                <code>${setup.userId}</code>
                                                <button class="btn btn-sm btn-link p-0 ms-2" 
                                                        onclick="navigator.clipboard.writeText('${setup.userId}')">
                                                    <i class="bi bi-clipboard"></i>
                                                </button>
                                            </div>
                                            <div>
                                                <strong>x-api-key:</strong> 
                                                <code>${setup.apiKey.substring(0, 20)}...</code>
                                                <button class="btn btn-sm btn-link p-0 ms-2" 
                                                        onclick="navigator.clipboard.writeText('${setup.apiKey}')">
                                                    <i class="bi bi-clipboard"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="mb-0">
                                        <label class="form-label fw-bold">Method:</label>
                                        <code>POST</code>
                                    </div>
                                </div>
                                
                                <h6 class="mt-4">⏰ Step 4: Imposta la frequenza</h6>
                                <p>Consigliato: <strong>Ogni ora</strong> o <strong>Ogni giorno</strong></p>
                                
                                <div class="alert alert-success mt-4">
                                    <i class="bi bi-check-circle me-2"></i>
                                    Una volta configurato, i dati di Apple Health arriveranno automaticamente!
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Chiudi</button>
                                <button type="button" class="btn btn-primary" onclick="healthAutoExportService.verifyConnection()">
                                    <i class="bi bi-check2-circle me-2"></i>Verifica Connessione
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove existing modal if present
            const existingModal = document.getElementById('healthAutoExportModal');
            if (existingModal) existingModal.remove();
            
            // Add modal to page
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('healthAutoExportModal'));
            modal.show();
            
            return setup;
        } catch (error) {
            console.error('Error showing setup modal:', error);
            alert('Errore nel caricamento delle istruzioni. Riprova.');
        }
    }

    /**
     * Verifica se la connessione funziona
     */
    async verifyConnection() {
        try {
            const data = await this.getLatestHealthData(1);
            
            if (data.length > 0) {
                const lastSync = data[0].appleHealthLastUpdate?.toDate?.() || new Date(data[0].appleHealthLastUpdate);
                alert(`✅ Connessione attiva!\n\nUltimo sync: ${lastSync.toLocaleString()}`);
                return true;
            } else {
                alert('⏳ Nessun dato ricevuto ancora.\n\nAssicurati di aver configurato l\'app Health Auto Export e atteso almeno un ciclo di sync.');
                return false;
            }
        } catch (error) {
            console.error('Error verifying connection:', error);
            alert('❌ Errore nella verifica. Controlla la configurazione.');
            return false;
        }
    }

    /**
     * Disconnetti Health Auto Export
     */
    async disconnect() {
        try {
            const user = firebase.auth().currentUser;
            if (!user) throw new Error('User not authenticated');

            await firebase.firestore()
                .collection('users')
                .doc(user.uid)
                .update({
                    appleHealthEnabled: false,
                    appleHealthLastSync: null
                });

            this.isConfigured = false;
            return true;
        } catch (error) {
            console.error('Error disconnecting:', error);
            return false;
        }
    }
}

// Export singleton instance
const healthAutoExportService = new HealthAutoExportService();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof firebase !== 'undefined') {
            firebase.auth().onAuthStateChanged(user => {
                if (user) healthAutoExportService.init();
            });
        }
    });
}
