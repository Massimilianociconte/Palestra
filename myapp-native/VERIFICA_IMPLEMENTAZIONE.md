# Guida Verifica Implementazione TOON e Trend Monitor

## Come Verificare che Tutto Funzioni Correttamente

### 1. Test Automatico (Consigliato)

Apri il file `test-toon-implementation.html` nel browser:

```
http://localhost:8000/test-toon-implementation.html
```

Clicca su ogni pulsante di test per verificare:
- ✅ Formato TOON funzionante
- ✅ Persistenza trend monitor
- ✅ Dati storici raccolti
- ✅ Progressioni/Regressioni calcolate
- ✅ Auto-refresh attivo

### 2. Verifica Manuale

#### A) Verifica Formato TOON

1. Apri la console del browser (F12)
2. Vai su `analysis.html`
3. Clicca su "Chiedi al Coach AI"
4. Nella console, cerca il log: `"Sending Advanced TOON Prompt size:"`
5. Verifica che il prompt contenga sezioni TOON come:
   ```
   workoutLogs[10]{date,volume,exercises}:
     2025-11-20,5000,Panca\,Squat
     ...
   ```

#### B) Verifica Persistenza Trend

1. Apri la console del browser
2. Esegui:
   ```javascript
   JSON.parse(localStorage.getItem('ironflow_trend_history'))
   ```
3. Dovresti vedere un array di snapshot con struttura:
   ```javascript
   [
     {
       timestamp: "2025-11-23T...",
       metrics: [...],
       domsHotspots: [...]
     },
     ...
   ]
   ```

#### C) Verifica Dati Storici

1. Apri la console del browser
2. Esegui:
   ```javascript
   import('./js/firestore-service.js').then(m => 
     m.firestoreService.gatherDataForAI()
   ).then(data => {
     console.log('PRs Attuali:', Object.keys(data.prs).length);
     console.log('PRs Storici:', Object.keys(data.historicalPrs || {}).length);
     console.log('Progressioni:', data.progressionData);
   })
   ```
3. Verifica che `progressionData` contenga esercizi con status `progressing`, `regressing` o `stable`

#### D) Verifica Auto-Refresh

1. Apri `analysis.html`
2. Nota i valori attuali nel "Trend Monitor"
3. Vai su `diary.html` e registra un nuovo allenamento
4. Torna su `analysis.html`
5. I valori del Trend Monitor dovrebbero aggiornarsi automaticamente

### 3. Verifica AI Reports

#### Report 1: Analisi Progressi (analysis.html)

1. Clicca su "Chiedi al Coach AI"
2. Verifica che il report menzioni:
   - ✅ Progressioni/Regressioni specifiche per esercizio
   - ✅ Confronto con dati storici (60-90 giorni fa)
   - ✅ Correlazione DOMS con performance
   - ✅ Suggerimenti basati su trend a lungo termine

#### Report 2: Prossima Sessione (user.html)

1. Vai su "Profilo" → "Prossima Sessione"
2. Clicca su "🤖 Genera"
3. Verifica che il suggerimento:
   - ✅ Consideri le progressioni recenti
   - ✅ Eviti gruppi muscolari con DOMS elevati
   - ✅ Rispetti lo stile di allenamento abituale
   - ✅ Adatti volume/intensità all'obiettivo (bulk/cut/strength)

#### Report 3: Resoconto Bisettimanale (analysis.html)

1. Vai su "Analisi"
2. Se è passato più di 9 giorni dall'ultimo resoconto, verrà generato automaticamente
3. Clicca su "📊 Storico Resoconti" per vedere i report passati
4. Verifica che il resoconto includa:
   - ✅ Andamento generale
   - ✅ Miglioramenti evidenti
   - ✅ Rischi/Regressioni
   - ✅ Focus prossimi 7 giorni
   - ✅ Riferimenti a DOMS persistenti

### 4. Verifica Sincronizzazione

#### LocalStorage → Firestore

1. Registra un allenamento
2. Vai su "Profilo" → "Sincronizza Ora"
3. Verifica il messaggio "Sincronizzato ora"
4. Apri Firestore Console e verifica che i dati siano presenti

#### Firestore → LocalStorage

1. Cancella `localStorage` (Console: `localStorage.clear()`)
2. Ricarica la pagina
3. Fai login
4. I dati dovrebbero essere ricaricati automaticamente da Firestore

### 5. Test con Dati Reali

Per testare completamente le progressioni/regressioni, hai bisogno di:

#### Dati Minimi Richiesti:
- ✅ Almeno 5 allenamenti negli ultimi 30 giorni
- ✅ Almeno 3 allenamenti 60-90 giorni fa (per confronto storico)
- ✅ Stessi esercizi in entrambi i periodi

#### Come Creare Dati di Test:

Se non hai dati storici, puoi crearli manualmente:

```javascript
// Apri console e esegui:
const logs = JSON.parse(localStorage.getItem('ironflow_logs') || '[]');

// Aggiungi log storico (80 giorni fa)
const historicalLog = {
  id: Date.now() - 1000,
  workoutName: 'Test Storico',
  date: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
  duration: '60 min',
  totalVolume: 4500,
  exercises: [
    {
      name: 'Panca Piana',
      sets: [
        { weight: 80, reps: 8 },
        { weight: 80, reps: 8 },
        { weight: 80, reps: 7 }
      ]
    },
    {
      name: 'Squat',
      sets: [
        { weight: 100, reps: 8 },
        { weight: 100, reps: 8 },
        { weight: 100, reps: 7 }
      ]
    }
  ]
};

logs.push(historicalLog);
localStorage.setItem('ironflow_logs', JSON.stringify(logs));

console.log('✅ Log storico aggiunto! Ora registra allenamenti recenti con gli stessi esercizi.');
```

Poi registra allenamenti recenti con gli stessi esercizi ma carichi diversi per vedere progressioni/regressioni.

### 6. Checklist Finale

- [ ] Test automatico completato (tutti i test PASSED)
- [ ] Formato TOON visibile nei prompt AI
- [ ] Trend history salvato in localStorage
- [ ] Progressioni/Regressioni calcolate correttamente
- [ ] Auto-refresh funzionante
- [ ] Report AI menzionano dati storici
- [ ] Sincronizzazione Firestore funzionante
- [ ] DOMS correlati con performance

### 7. Troubleshooting

#### Problema: "Nessuna progressione disponibile"
**Soluzione**: Servono dati storici (60-90 giorni fa). Usa lo script sopra per crearli.

#### Problema: "Trend monitor non si aggiorna"
**Soluzione**: 
1. Verifica che `storage` event listener sia attivo
2. Prova a ricaricare la pagina
3. Controlla console per errori

#### Problema: "AI non riceve dati TOON"
**Soluzione**:
1. Verifica che `aiService.encodeToTOON()` funzioni (test automatico)
2. Controlla console per errori durante la chiamata AI
3. Verifica che la API Key sia valida

#### Problema: "Snapshot non vengono salvati"
**Soluzione**:
1. Verifica che localStorage non sia pieno
2. Controlla console per errori
3. Prova a cancellare vecchi snapshot: `localStorage.removeItem('ironflow_trend_history')`

### 8. Metriche di Successo

L'implementazione è corretta se:

1. **Token Efficiency**: I prompt AI sono 50-70% più piccoli rispetto a JSON
2. **Persistenza**: Almeno 1 snapshot salvato ogni volta che valuti i trend
3. **Dati Completi**: L'AI riceve progressioni, regressioni e dati storici
4. **Auto-Update**: Il trend monitor si aggiorna entro 2 secondi da una modifica
5. **Sincronizzazione**: I dati persistono dopo logout/login

### 9. Supporto

Se riscontri problemi:

1. Controlla la console del browser per errori
2. Verifica che tutti i file siano stati modificati correttamente
3. Esegui il test automatico per identificare il problema specifico
4. Controlla che la versione di Gemini AI supporti i prompt lunghi

### 10. Prossimi Passi

Dopo aver verificato che tutto funzioni:

1. Usa l'app normalmente per 2-3 settimane
2. Accumula dati storici
3. Verifica che le progressioni/regressioni siano accurate
4. Testa i 3 report AI con dati reali
5. Monitora l'efficienza dei token (dovrebbe essere ~50% in meno)

---

**Nota**: Per una verifica completa delle progressioni/regressioni, è necessario avere dati storici reali. Se stai testando su un'installazione nuova, usa lo script di creazione dati di test fornito sopra.
