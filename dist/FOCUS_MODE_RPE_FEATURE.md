# Feature: RPE (Rate of Perceived Exertion) in Focus Mode

## Obiettivo
Aggiungere il campo RPE (Rate of Perceived Exertion) alla modalità Focus per tracciare l'intensità percepita di ogni set e utilizzare questi dati per analisi AI più approfondite.

---

## Cos'è RPE?

**RPE (Rate of Perceived Exertion)** è una scala soggettiva da 1 a 10 che misura quanto difficile è stato un set:

- **1-3**: Molto facile, riscaldamento
- **4-6**: Moderato, lontano dal cedimento
- **7**: Difficile, 3 reps in riserva (RIR)
- **8**: Molto difficile, 2 RIR
- **9**: Quasi al cedimento, 1 RIR
- **10**: Cedimento muscolare completo, 0 RIR

**Perché è importante:**
- Misura oggettiva dell'intensità percepita
- Aiuta a programmare il volume ottimale
- Previene overtraining (RPE costantemente >9)
- Identifica undertraining (RPE costantemente <7)
- Migliora la consapevolezza corporea

---

## Implementazione

### 1. **UI Focus Mode**

**Prima (2 campi):**
```
[  KG  ] [  REPS  ]
```

**Dopo (3 campi):**
```
[  KG  ] [  REPS  ] [  RPE  ]
```

**Dettagli UI:**
- Campo input numerico con step 0.5 (permette 7.5, 8.5, etc.)
- Range: 1-10
- Placeholder: "1-10"
- Font size grande (2.5rem) come KG e REPS
- Pre-riempito se disponibile dal set precedente

### 2. **Salvataggio Dati**

**Struttura Set (Prima):**
```javascript
{
  weight: 60,
  reps: 10
}
```

**Struttura Set (Dopo):**
```javascript
{
  weight: 60,
  reps: 10,
  rpe: 8 // Nuovo campo
}
```

**Persistenza:**
- Salvato in `localStorage` con il log dell'allenamento
- Sincronizzato su Firestore
- Disponibile per analisi AI

### 3. **Visualizzazione Storico**

**Prima:**
```
✅ Set 1: 60kg x 10
```

**Dopo:**
```
✅ Set 1: 60kg x 10 @ RPE 8
```

---

## Integrazione AI

### Dati Passati all'AI

**1. RPE per Esercizio (Media)**
```javascript
{
  exercises: [
    "Panca Piana (3 sets @ RPE 8.3)",
    "Squat (4 sets @ RPE 9.0)"
  ]
}
```

**2. RPE Medio Workout**
```javascript
{
  avgRpe: 8.5 // Media di tutti i set del workout
}
```

### Analisi AI Espansa

**Sezione 2.3: Intensità & RPE**

L'AI ora analizza:

1. **RPE Medio per Workout**
   - Confronto con target ottimale (7-9 per ipertrofia, 8-10 per forza)
   - Trend nel tempo (in aumento, stabile, in calo)

2. **RPE per Esercizio**
   - Identifica esercizi con RPE troppo basso/alto
   - Suggerisce aggiustamenti specifici

3. **Correlazione RPE-Progressione**
   - "RPE alto ma nessuna progressione = possibile tecnica scadente"
   - "RPE basso + progressione = margine per aumentare intensità"

4. **Correlazione RPE-Wellness**
   - "RPE alto + sonno basso = rischio overtraining"
   - "RPE basso + energia alta = puoi spingere di più"

5. **Pattern RPE**
   - "RPE in calo nel tempo = adattamento positivo"
   - "RPE in aumento = possibile accumulo fatica"

6. **Suggerimenti Specifici**
   - "Mantieni RPE 7-8 su panca per 2 settimane"
   - "Riduci RPE a 6-7 su squat per deload"
   - "Aumenta RPE a 9 sull'ultimo set di ogni esercizio"

---

## Esempi di Analisi AI

### Esempio 1: RPE Ottimale
```
**2.3 Intensità & RPE**
Il tuo RPE medio è 8.2, perfetto per ipertrofia (target: 7-9).
Analizzando per esercizio:
- Panca Piana: RPE 8.5 (ottimo, vicino al cedimento)
- Squat: RPE 9.0 (molto alto, considera deload se persiste)
- Curl Bicipiti: RPE 6.5 (troppo basso, puoi aumentare peso o reps)

Raccomandazione: Mantieni RPE attuale su panca, riduci leggermente 
su squat (target 8-8.5), aumenta su curl (target 7.5-8).
```

### Esempio 2: RPE Troppo Basso (Undertraining)
```
**2.3 Intensità & RPE**
⚠️ Il tuo RPE medio è 5.8, significativamente sotto il target per 
ipertrofia (7-9). Questo indica che stai lasciando troppo margine 
prima del cedimento.

Impatto: Con RPE così basso, lo stimolo ipertrofico è subottimale.
Anche se il volume è alto (1800kg), l'intensità insufficiente limita 
i guadagni.

Azione: Nelle prossime 2 settimane, punta a RPE 7-8 su TUTTI gli 
esercizi. Questo significa fermarti a 2-3 reps dal cedimento, non 5-6.
```

### Esempio 3: RPE Troppo Alto (Overtraining)
```
**2.3 Intensità & RPE**
⚠️ Il tuo RPE medio è 9.5, costantemente al cedimento o oltre.
Correlando con wellness:
- Sonno: 5.3h (sotto target)
- Energia: 4/10 (bassa)
- DOMS: 7/10 (elevati)

Diagnosi: Possibile overtraining. RPE costantemente >9 + recupero 
insufficiente = rischio infortuni e regressione.

Azione Immediata:
1. Deload settimana prossima: RPE 6-7 su tutti gli esercizi
2. Aumenta sonno a 7-8h/notte
3. Riduci volume del 20% per 2 settimane
4. Dopo deload, riprendi con RPE 7-8 (non 9-10)
```

### Esempio 4: Correlazione RPE-Progressione
```
**3.2 Regressioni**
Panca Piana: -5% (da 65kg a 62kg 1RM)
Analisi RPE: RPE medio 9.2 (molto alto)

Ipotesi: Stai spingendo troppo forte (RPE 9+) ma la forza sta calando.
Possibili cause:
1. Tecnica compromessa per raggiungere RPE alto
2. Accumulo fatica (CNS fatigue)
3. Recupero insufficiente tra sessioni

Soluzione: Riduci RPE a 7-8 per 3 settimane, focus su tecnica perfetta.
Paradossalmente, RPE più basso + tecnica migliore = più progressione.
```

---

## Benefici

### Per l'Utente:
✅ **Consapevolezza**: Impara a percepire l'intensità reale
✅ **Autoregolazione**: Adatta il carico in base a come si sente
✅ **Prevenzione Overtraining**: Identifica quando sta spingendo troppo
✅ **Ottimizzazione**: Trova il sweet spot intensità/volume

### Per l'AI:
✅ **Dati Oggettivi**: Misura intensità percepita, non solo carico
✅ **Correlazioni**: RPE + wellness + progressioni = analisi profonda
✅ **Personalizzazione**: Suggerimenti basati su intensità reale
✅ **Predizione**: Identifica pattern che portano a stallo/overtraining

### Per il Sistema:
✅ **Completezza**: Dati più ricchi per analisi
✅ **Scientificità**: RPE è metrica validata dalla ricerca
✅ **Flessibilità**: Funziona con qualsiasi esercizio/carico

---

## Flusso Utente

### Durante Focus Mode:
1. Completa il set
2. Inserisci **KG**, **REPS**, **RPE**
3. Clicca "FATTO"
4. RPE viene salvato con il set
5. Visualizzato nello storico: "✅ Set 1: 60kg x 10 @ RPE 8"

### Dopo Allenamento:
1. RPE medio per esercizio calcolato automaticamente
2. RPE medio workout calcolato automaticamente
3. Dati disponibili per analisi AI

### In Analisi AI:
1. Vai su **Analisi** → "Chiedi al Coach AI"
2. L'AI analizza RPE in sezione "Intensità & RPE"
3. Ricevi suggerimenti specifici su come modulare intensità

---

## Note Tecniche

### Calcolo RPE Medio Esercizio:
```javascript
const rpeValues = exercise.sets
    .map(s => s.rpe)
    .filter(rpe => rpe && rpe > 0);
const avgRpe = rpeValues.length > 0 
    ? (rpeValues.reduce((sum, val) => sum + val, 0) / rpeValues.length).toFixed(1)
    : null;
```

### Calcolo RPE Medio Workout:
```javascript
const allRpeValues = log.exercises
    .flatMap(e => e.sets.map(s => s.rpe))
    .filter(rpe => rpe && rpe > 0);
const workoutAvgRpe = allRpeValues.length > 0
    ? (allRpeValues.reduce((sum, val) => sum + val, 0) / allRpeValues.length).toFixed(1)
    : null;
```

### Formato TOON per AI:
```
workoutLogs[2]{date,volume,exercises,avgRpe}:
  2025-11-23,1850,Panca Piana (3 sets @ RPE 8.3)|Squat (4 sets @ RPE 9.0),8.5
  2025-11-22,1900,Rematore (3 sets @ RPE 7.5)|Stacco (3 sets @ RPE 8.8),8.1
```

---

## Limitazioni & Note

### ✅ Cosa Funziona:
- RPE salvato per ogni set
- Calcolo automatico medie
- Visualizzazione nello storico
- Analisi AI completa

### ⚠️ Considerazioni:
- RPE è soggettivo (varia tra persone)
- Richiede pratica per calibrare correttamente
- Principianti potrebbero sottostimare/sovrastimare
- L'AI può aiutare a calibrare nel tempo

### 📝 Best Practices:
- Sii onesto con te stesso
- RPE 10 = cedimento VERO (non "potevo fare 1 in più")
- Usa step 0.5 per precisione (7.5, 8.5, etc.)
- Traccia sempre, anche se non sei sicuro
- L'AI ti aiuterà a calibrare nel tempo

---

## Testing

### Test Case 1: Salvataggio RPE
1. Avvia Focus Mode
2. Completa set con KG, REPS, RPE
3. ✅ Verifica che RPE sia salvato nel log
4. ✅ Verifica visualizzazione "@ RPE X" nello storico

### Test Case 2: Calcolo Medie
1. Completa workout con RPE variabili
2. ✅ Verifica RPE medio per esercizio
3. ✅ Verifica RPE medio workout

### Test Case 3: Analisi AI
1. Completa 3-4 workout con RPE
2. Genera report AI
3. ✅ Verifica sezione "Intensità & RPE"
4. ✅ Verifica correlazioni RPE-progressioni

---

## Prossimi Passi

### Possibili Miglioramenti Futuri:
1. **Grafico RPE nel Tempo**: Visualizzare trend RPE
2. **Alert RPE**: Notifica se RPE troppo alto/basso
3. **Suggerimenti Real-Time**: "RPE alto, considera ridurre peso"
4. **Calibrazione AI**: L'AI impara il tuo RPE ottimale
5. **Confronto RPE**: Confronta con altri utenti simili

---

## Documentazione Correlata
- `user.html` - Implementazione Focus Mode con RPE
- `js/firestore-service.js` - Calcolo medie RPE
- `js/ai-service.js` - Analisi AI con RPE
- `AI_REPORT_EXPANSION.md` - Struttura report AI completo
