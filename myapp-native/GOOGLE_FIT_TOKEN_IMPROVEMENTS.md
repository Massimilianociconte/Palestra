# Google Fit Token & Data Improvements

## Data: 24 Novembre 2025

## Problema Risolto
Il token di Google Fit scadeva troppo velocemente (ogni ora) e richiedeva riconnessioni manuali frequenti.

## Soluzioni Implementate

### 1. Token Duration Estesa
- **OAuth Flow Migliorato**: Aggiunto `prompt=consent` per forzare il consent e ottenere sempre un refresh token
- **Refresh Token**: Il sistema ora usa correttamente il refresh token per rinnovare automaticamente l'access token
- **Auto-Refresh Proattivo**: Sistema che controlla ogni 5 minuti se il token sta per scadere e lo refresha automaticamente
- **Refresh Anticipato**: Il token viene refreshato quando mancano 15-20 minuti alla scadenza (invece di aspettare l'ultimo momento)

### 2. Calcoli Dati Ultra-Precisi

#### Sonno
- **Filtro Segmenti**: Conta solo i segmenti di sonno effettivo (light, deep, REM), escludendo "awake" e "out-of-bed"
- **Raggruppamento Giornaliero**: Raggruppa correttamente i segmenti per giorno
- **Log Dettagliato**: Mostra ore di sonno per ogni giorno con numero di segmenti
- **Tipi Sonno Gestiti**:
  - Type 2: Sleep generico
  - Type 4: Light sleep
  - Type 5: Deep sleep
  - Type 6: REM sleep
  - Type 1, 3: Awake/Out-of-bed (ESCLUSI)

#### Battito Cardiaco
- **Filtro Fisiologico**: Esclude valori non validi (<30 bpm o >220 bpm)
- **Rimozione Outliers**: Usa metodo IQR (Interquartile Range) per rimuovere valori anomali
- **Media Ponderata**: Calcola la media solo sui valori validi dopo il filtro
- **Log Dettagliato**: Mostra quanti valori sono stati usati vs scartati

#### Passi
- **Gestione Duplicati**: Usa Map per evitare di contare due volte gli stessi intervalli temporali
- **Multi-Source**: Gestisce correttamente dati da più fonti (phone, watch, etc.)
- **Valore Massimo**: Se ci sono stime multiple per lo stesso intervallo, prende il valore più alto
- **Log Dettagliato**: Mostra intervalli unici vs data points totali

### 3. Sistema Auto-Refresh

#### Caratteristiche
- **Interval Check**: Controlla ogni 5 minuti lo stato del token
- **Refresh Proattivo**: Refresha quando mancano 15 minuti alla scadenza
- **Load-Time Refresh**: Se il token è scaduto al caricamento, lo refresha automaticamente
- **Error Handling**: Gestisce correttamente errori di refresh token scaduto/revocato

#### Tempistiche
- Token Google OAuth: ~60 minuti di validità
- Check auto-refresh: ogni 5 minuti
- Soglia refresh proattivo: 15 minuti prima della scadenza
- Soglia refresh on-demand: 10 minuti prima della scadenza

### 4. Logging Migliorato

Tutti i metodi ora loggano:
- Numero di data points ricevuti
- Valori calcolati con dettagli
- Filtri applicati e valori scartati
- Timestamp e scadenze token
- Errori con contesto specifico

## Benefici

1. **Nessuna Riconnessione Manuale**: Il token si rinnova automaticamente in background
2. **Dati Più Accurati**: Calcoli precisi con filtri per outliers e duplicati
3. **Trasparenza**: Log dettagliati per debug e verifica
4. **Affidabilità**: Gestione robusta degli errori e fallback
5. **User Experience**: L'utente non deve più preoccuparsi del token

## Test Consigliati

1. Connetti Google Fit e verifica che il token venga salvato
2. Aspetta 45 minuti e verifica che il token venga refreshato automaticamente
3. Sincronizza i dati e verifica i log per:
   - Passi totali e intervalli unici
   - Ore di sonno per giorno
   - Battito cardiaco con outliers rimossi
4. Lascia l'app aperta per 2-3 ore e verifica che non richieda riconnessione

## Note Tecniche

- Il refresh token di Google non scade (a meno che non venga revocato dall'utente)
- L'access token scade dopo ~60 minuti
- Il sistema ora gestisce automaticamente il ciclo di vita del token
- Se il refresh token viene revocato, l'utente deve riconnettersi (comportamento corretto)

## File Modificati

- `js/health-connect-service.js`: Tutte le funzioni di fetch dati e gestione token
