/**
 * PR Tracker Service
 * Rileva e notifica automaticamente i Personal Records
 * Cross-platform: APK Android, WebApp Android, WebApp iOS
 *
 * v2.0 - Nuova logica:
 * - Trigger esclusivo su onWorkoutEnd (fine allenamento)
 * - Notifica aggregata singola "Master"
 * - Redirect a PR Hub con analisi comparativa
 */

const PR_STORAGE_KEY = "ironflow_personal_records";
const PR_HISTORY_KEY = "ironflow_pr_history";
const PR_SESSION_KEY = "ironflow_session_prs";

export class PRTracker {
  constructor() {
    this.personalRecords = this.loadPRs();
    this.prHistory = this.loadPRHistory();
    this.sessionPRs = []; // PRs detected in current session
    this.isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
    this.isNativeApp = window.Capacitor?.isNativePlatform?.() || false;
    this.notificationPermission = "default";

    this.init();
  }

  async init() {
    // Richiedi permesso notifiche
    await this.requestNotificationPermission();

    console.log(
      `🏆 PR Tracker v2.0 inizializzato - Platform: ${this.getPlatformName()}`,
    );
  }

  getPlatformName() {
    if (this.isNativeApp) return "Native Android";
    if (this.isIOS) return "iOS WebApp";
    if (this.isAndroid) return "Android WebApp";
    return "Desktop";
  }

  // --- Storage Methods ---
  loadPRs() {
    try {
      return JSON.parse(localStorage.getItem(PR_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  savePRs() {
    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(this.personalRecords));
  }

  loadPRHistory() {
    try {
      return JSON.parse(localStorage.getItem(PR_HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  savePRHistory() {
    // Mantieni solo gli ultimi 100 PR
    const trimmed = this.prHistory.slice(0, 100);
    localStorage.setItem(PR_HISTORY_KEY, JSON.stringify(trimmed));
  }

  // --- PR Detection ---

  /**
   * Normalizza il nome dell'esercizio per il confronto
   */
  normalizeExerciseName(name) {
    return (name || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[()[\]{}]/g, "")
      .replace(/\d+\s*(kg|lb|lbs)?/gi, "")
      .trim();
  }

  /**
   * Calcola 1RM stimato usando formule appropriate al numero di ripetizioni.
   * - Brzycki per reps 1-10 (più accurato per basse ripetizioni)
   * - Epley per reps 11-30 (più adatto per alti range)
   * - Oltre 30 reps: troppo aerobico per stimare forza massimale
   */
  calculate1RM(weight, reps) {
    if (reps <= 0 || weight <= 0) return 0;
    if (reps === 1) return weight;

    // Oltre 30 reps è troppo aerobico per una stima affidabile
    if (reps > 30) {
      console.debug(
        `[PRTracker] ${reps} reps troppo alto per stima 1RM, usando formula conservativa`,
      );
      // Usa una stima molto conservativa per evitare valori gonfiati
      return Math.round(weight * 1.15);
    }

    // Per 2-10 reps: Formula Brzycki (più accurata per basse rep)
    // 1RM = weight * (36 / (37 - reps))
    if (reps <= 10) {
      return Math.round(weight * (36 / (37 - reps)));
    }

    // Per 11-30 reps: Formula Epley (migliore per alti range)
    // 1RM = weight * (1 + reps/30)
    return Math.round(weight * (1 + reps / 30));
  }

  /**
   * Analizza un log di allenamento e rileva i PR
   * @returns {Array} Lista di nuovi PR rilevati
   */
  detectPRsFromLog(logData) {
    const newPRs = [];

    if (!logData || !logData.exercises) return newPRs;

    logData.exercises.forEach((exercise) => {
      const exerciseName = (exercise.name || "").trim();
      if (!exerciseName) return;

      const normalizedName = this.normalizeExerciseName(exerciseName);

      // Inizializza il record se non esiste
      if (!this.personalRecords[normalizedName]) {
        this.personalRecords[normalizedName] = {
          displayName: exerciseName,
          maxWeight: 0,
          max1RM: 0,
          maxVolume: 0,
          maxReps: 0,
          lastUpdated: null,
        };
      }

      const currentPR = this.personalRecords[normalizedName];
      let hasPR = false;
      const prDetails = {
        exercise: exerciseName,
        date: logData.date,
        records: [],
      };

      // Analizza ogni set
      (exercise.sets || []).forEach((set) => {
        const weight = parseFloat(set.weight) || 0;
        const reps = parseInt(set.reps) || 0;

        if (weight <= 0 || reps <= 0) return;

        // 1. PR Peso Massimo
        if (weight > currentPR.maxWeight) {
          prDetails.records.push({
            type: "weight",
            label: "💪 Peso Massimo",
            oldValue: currentPR.maxWeight,
            newValue: weight,
            unit: "kg",
          });
          currentPR.maxWeight = weight;
          hasPR = true;
        }

        // 2. PR 1RM Stimato
        const estimated1RM = this.calculate1RM(weight, reps);
        if (estimated1RM > currentPR.max1RM) {
          prDetails.records.push({
            type: "1rm",
            label: "🎯 1RM Stimato",
            oldValue: currentPR.max1RM,
            newValue: estimated1RM,
            unit: "kg",
          });
          currentPR.max1RM = estimated1RM;
          hasPR = true;
        }

        // 3. PR Reps Massime (con almeno 70% del peso max)
        if (currentPR.maxWeight > 0 && weight >= currentPR.maxWeight * 0.7) {
          if (reps > currentPR.maxReps) {
            prDetails.records.push({
              type: "reps",
              label: "🔥 Max Ripetizioni",
              oldValue: currentPR.maxReps,
              newValue: reps,
              unit: "reps",
              context: `@ ${weight}kg`,
            });
            currentPR.maxReps = reps;
            hasPR = true;
          }
        }
      });

      // 4. PR Volume Totale per Esercizio
      const exerciseVolume = (exercise.sets || []).reduce((sum, set) => {
        return sum + (parseFloat(set.weight) || 0) * (parseInt(set.reps) || 0);
      }, 0);

      if (exerciseVolume > currentPR.maxVolume) {
        prDetails.records.push({
          type: "volume",
          label: "📊 Volume Massimo",
          oldValue: currentPR.maxVolume,
          newValue: Math.round(exerciseVolume),
          unit: "kg",
        });
        currentPR.maxVolume = Math.round(exerciseVolume);
        hasPR = true;
      }

      if (hasPR) {
        currentPR.lastUpdated = new Date().toISOString();
        currentPR.displayName = exerciseName; // Aggiorna il nome visualizzato
        newPRs.push(prDetails);
      }
    });

    // Salva i PR aggiornati
    if (newPRs.length > 0) {
      this.savePRs();

      // Aggiungi allo storico con timestamp per tracciamento temporale
      newPRs.forEach((pr) => {
        this.prHistory.unshift({
          ...pr,
          timestamp: new Date().toISOString(),
        });
      });
      this.savePRHistory();

      // Accumula PRs della sessione corrente
      this.sessionPRs.push(...newPRs);
    }

    return newPRs;
  }

  /**
   * Resetta i PR della sessione corrente
   * Chiamare all'inizio di un nuovo workout
   */
  resetSessionPRs() {
    this.sessionPRs = [];
    console.log("🏆 Session PRs reset");
  }

  /**
   * Ottieni i PR della sessione corrente
   */
  getSessionPRs() {
    return this.sessionPRs;
  }

  /**
   * Notifica aggregata post-workout (v2.0)
   * Mostra una singola notifica "Master" e reindirizza al PR Hub
   */
  async notifyAggregatedPRs() {
    if (this.sessionPRs.length === 0) {
      console.log("🏆 Nessun nuovo PR in questa sessione");
      return false;
    }

    const totalRecords = this.sessionPRs.reduce(
      (sum, pr) => sum + pr.records.length,
      0,
    );
    const exerciseCount = this.sessionPRs.length;

    console.log(
      `🏆 Sessione completata: ${totalRecords} record in ${exerciseCount} esercizi`,
    );

    // Costruisci notifica aggregata
    const title = "🏆 Progressi Straordinari!";
    const body = `Hai superato ${totalRecords} record personali in ${exerciseCount} esercizi. Tocca per analizzarli.`;

    // 1. Notifica Native (Android APK)
    if (this.isNativeApp) {
      await this.sendAggregatedNativeNotification(title, body, totalRecords);
    }

    // 2. Web Notification
    if (this.notificationPermission === "granted") {
      this.sendAggregatedWebNotification(title, body);
    }

    // 3. In-App Toast con CTA
    this.showAggregatedToast(totalRecords, exerciseCount);

    // 4. Vibrazione celebrativa
    this.vibrateDevice([100, 50, 100, 50, 100, 50, 200]);

    return true;
  }

  /**
   * Reindirizza al PR Hub con i dati della sessione
   */
  navigateToPRHub() {
    if (this.sessionPRs.length === 0) return;

    const encodedPRs = encodeURIComponent(JSON.stringify(this.sessionPRs));
    window.location.href = `records.html?session_prs=${encodedPRs}`;
  }

  async sendAggregatedNativeNotification(title, body, count) {
    try {
      if (window.Capacitor?.Plugins?.LocalNotifications) {
        await window.Capacitor.Plugins.LocalNotifications.schedule({
          notifications: [
            {
              id: Date.now(),
              title: title,
              body: body,
              channelId: "pr_notifications",
              sound: "default",
              smallIcon: "ic_stat_icon",
              largeIcon: "ic_launcher",
              extra: {
                type: "pr_aggregated",
                count: count,
                action: "open_pr_hub",
              },
            },
          ],
        });
        console.log("✅ Aggregated native notification sent");
      }
    } catch (error) {
      console.warn("Native notification failed:", error);
    }
  }

  sendAggregatedWebNotification(title, body) {
    try {
      const notification = new Notification(title, {
        body: body,
        icon: "/assets/icon.svg",
        badge: "/assets/icon.svg",
        tag: "pr-aggregated",
        renotify: true,
        requireInteraction: true,
        vibrate: [100, 50, 100, 50, 200],
        data: { type: "pr_aggregated", action: "open_pr_hub" },
      });

      notification.onclick = () => {
        window.focus();
        this.navigateToPRHub();
        notification.close();
      };

      // Auto-close dopo 15 secondi
      setTimeout(() => notification.close(), 15000);
    } catch (error) {
      console.warn("Web notification failed:", error);
    }
  }

  showAggregatedToast(totalRecords, exerciseCount) {
    // Rimuovi toast esistenti
    const existingToast = document.getElementById("pr-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = "pr-toast";
    toast.innerHTML = `
            <button class="pr-toast-close" id="prToastClose" aria-label="Chiudi">×</button>
            <div class="pr-toast-content">
                <div class="pr-toast-icon">🏆</div>
                <div class="pr-toast-text">
                    <div class="pr-toast-title">Nuovi Record!</div>
                    <div class="pr-toast-body">${totalRecords} PR in ${exerciseCount} esercizi</div>
                </div>
                <button class="pr-toast-cta" id="prToastCTA">Vedi →</button>
            </div>
        `;

    toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 16px;
            z-index: 9999;
            background: rgba(26, 26, 46, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 215, 0, 0.3);
            color: #fff;
            padding: 12px 16px;
            border-radius: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            animation: prToastSlideIn 0.3s ease-out;
            max-width: 280px;
            font-family: var(--font-body, system-ui, sans-serif);
        `;

    // Aggiungi stili se non esistono
    if (!document.getElementById("pr-toast-styles")) {
      const styles = document.createElement("style");
      styles.id = "pr-toast-styles";
      styles.textContent = `
                @keyframes prToastSlideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes prToastSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(20px); }
                }
                .pr-toast-close {
                    position: absolute;
                    top: 6px;
                    right: 8px;
                    background: none;
                    border: none;
                    color: rgba(255,255,255,0.5);
                    font-size: 1.2rem;
                    cursor: pointer;
                    padding: 2px 6px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .pr-toast-close:hover {
                    color: #fff;
                }
                .pr-toast-content {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .pr-toast-icon {
                    font-size: 1.5rem;
                }
                .pr-toast-text {
                    flex: 1;
                }
                .pr-toast-title {
                    font-weight: 700;
                    font-size: 0.9rem;
                    color: #FFD700;
                }
                .pr-toast-body {
                    font-size: 0.75rem;
                    opacity: 0.8;
                }
                .pr-toast-cta {
                    background: linear-gradient(135deg, #FFD700, #FFA500);
                    border: none;
                    color: #1a1a2e;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-weight: 700;
                    font-size: 0.75rem;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .pr-toast-cta:hover {
                    transform: scale(1.05);
                    box-shadow: 0 2px 8px rgba(255, 215, 0, 0.4);
                }
            `;
      document.head.appendChild(styles);
    }

    document.body.appendChild(toast);

    // Close button handler
    document.getElementById("prToastClose").addEventListener("click", () => {
      this._dismissToast(toast);
    });

    // CTA click handler
    document.getElementById("prToastCTA").addEventListener("click", () => {
      toast.remove();
      this.navigateToPRHub();
    });

    // Auto-remove dopo 5 secondi
    setTimeout(() => {
      this._dismissToast(toast);
    }, 5000);
  }

  _dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.style.animation = "prToastSlideOut 0.3s ease-in forwards";
    setTimeout(() => toast.remove(), 300);
  }

  // --- Notification System ---

  async requestNotificationPermission() {
    try {
      if ("Notification" in window) {
        const permission = await Notification.requestPermission();
        this.notificationPermission = permission;
        console.log(`🔔 Permesso notifiche: ${permission}`);
        return permission === "granted";
      }
    } catch (error) {
      console.warn("Notifiche non supportate:", error);
    }
    return false;
  }

  /**
   * @deprecated Use notifyAggregatedPRs() instead for post-workout notification
   * Kept for backward compatibility
   */
  async notifyPR(prDetails) {
    const { exercise, records } = prDetails;

    if (records.length === 0) return;

    // Costruisci il messaggio
    const mainRecord = records[0];
    const title = `🏆 NUOVO PR: ${exercise}`;
    const improvement =
      mainRecord.oldValue > 0
        ? ` (+${(mainRecord.newValue - mainRecord.oldValue).toFixed(1)}${mainRecord.unit})`
        : "";
    const body = `${mainRecord.label}: ${mainRecord.newValue}${mainRecord.unit}${improvement}`;

    console.log(`🏆 PR Notification: ${title} - ${body}`);

    // 1. Notifica Native (Android APK via Capacitor)
    if (this.isNativeApp) {
      await this.sendNativeNotification(title, body);
    }

    // 2. Web Notification API
    if (this.notificationPermission === "granted") {
      this.sendWebNotification(title, body);
    }

    // 3. In-App Toast (sempre visibile)
    this.showInAppToast(title, body, records);

    // 4. Vibrazione (se supportata)
    this.vibrateDevice();
  }

  async sendNativeNotification(title, body) {
    try {
      if (window.Capacitor?.Plugins?.LocalNotifications) {
        await window.Capacitor.Plugins.LocalNotifications.schedule({
          notifications: [
            {
              id: Date.now(),
              title: title,
              body: body,
              channelId: "pr_notifications",
              sound: "default",
              smallIcon: "ic_stat_icon",
              largeIcon: "ic_launcher",
            },
          ],
        });
        console.log("✅ Native notification sent");
      }
    } catch (error) {
      console.warn("Native notification failed:", error);
    }
  }

  sendWebNotification(title, body) {
    try {
      // Crea notifica con opzioni ottimizzate per mobile
      const notification = new Notification(title, {
        body: body,
        icon: "/assets/icon.svg",
        badge: "/assets/icon.svg",
        tag: "pr-notification",
        renotify: true,
        requireInteraction: !this.isIOS, // iOS non supporta bene
        vibrate: [200, 100, 200],
        data: { type: "pr" },
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // Auto-close dopo 10 secondi
      setTimeout(() => notification.close(), 10000);
    } catch (error) {
      console.warn("Web notification failed:", error);
    }
  }

  showInAppToast(title, body, records) {
    // Rimuovi toast esistenti
    const existingToast = document.getElementById("pr-toast");
    if (existingToast) existingToast.remove();

    // Semplifica il titolo
    const shortTitle = title.replace("🏆 NUOVO PR: ", "");

    // Crea il toast
    const toast = document.createElement("div");
    toast.id = "pr-toast";
    toast.innerHTML = `
            <button class="pr-toast-close" id="prSingleToastClose" aria-label="Chiudi">×</button>
            <div class="pr-toast-content">
                <div class="pr-toast-icon">🏆</div>
                <div class="pr-toast-text">
                    <div class="pr-toast-title">${shortTitle}</div>
                    <div class="pr-toast-body">${body}</div>
                    ${records.length > 1 ? `<div class="pr-toast-extra">+${records.length - 1} altri</div>` : ""}
                </div>
            </div>
        `;

    // Stili inline - posizione meno invasiva in basso a destra
    toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 16px;
            z-index: 9999;
            background: rgba(26, 26, 46, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 215, 0, 0.3);
            color: #fff;
            padding: 12px 16px;
            border-radius: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            animation: prToastSlideIn 0.3s ease-out;
            max-width: 260px;
            font-family: var(--font-body, system-ui, sans-serif);
        `;

    // Aggiungi stili di animazione se non esistono
    if (!document.getElementById("pr-toast-styles")) {
      const styles = document.createElement("style");
      styles.id = "pr-toast-styles";
      styles.textContent = `
                @keyframes prToastSlideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes prToastSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(20px); }
                }
                .pr-toast-close {
                    position: absolute;
                    top: 6px;
                    right: 8px;
                    background: none;
                    border: none;
                    color: rgba(255,255,255,0.5);
                    font-size: 1.2rem;
                    cursor: pointer;
                    padding: 2px 6px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .pr-toast-close:hover {
                    color: #fff;
                }
                .pr-toast-content {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .pr-toast-icon {
                    font-size: 1.5rem;
                }
                .pr-toast-text {
                    flex: 1;
                }
                .pr-toast-title {
                    font-weight: 700;
                    font-size: 0.85rem;
                    color: #FFD700;
                }
                .pr-toast-body {
                    font-size: 0.75rem;
                    opacity: 0.8;
                }
                .pr-toast-extra {
                    font-size: 0.65rem;
                    opacity: 0.6;
                    margin-top: 2px;
                }
            `;
      document.head.appendChild(styles);
    }

    document.body.appendChild(toast);

    // Close button handler
    document
      .getElementById("prSingleToastClose")
      .addEventListener("click", () => {
        this._dismissToast(toast);
      });

    // Auto-remove dopo 5 secondi
    setTimeout(() => {
      this._dismissToast(toast);
    }, 5000);
  }

  vibrateDevice() {
    try {
      if ("vibrate" in navigator) {
        navigator.vibrate([100, 50, 100, 50, 200]);
      }
    } catch (e) {
      // Vibrazione non supportata
    }
  }

  // --- Utility Methods ---

  /**
   * Ottieni tutti i PR per un esercizio specifico
   */
  getPRsForExercise(exerciseName) {
    const normalized = this.normalizeExerciseName(exerciseName);
    return this.personalRecords[normalized] || null;
  }

  /**
   * Ottieni tutti i PR
   */
  getAllPRs() {
    return Object.entries(this.personalRecords)
      .map(([key, pr]) => ({
        normalizedName: key,
        ...pr,
      }))
      .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  }

  /**
   * Ottieni lo storico PR
   */
  getPRHistory(limit = 20) {
    return this.prHistory.slice(0, limit);
  }

  /**
   * Ottieni lista esercizi per l'AI (per normalizzazione)
   */
  getExerciseListForAI() {
    return Object.values(this.personalRecords)
      .map((pr) => pr.displayName)
      .filter(Boolean);
  }
}

// Singleton export
export const prTracker = new PRTracker();
