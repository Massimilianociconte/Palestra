# GymBro Tech Stack

## Frontend

- **Vanilla JavaScript** (ES6 modules)
- **HTML5/CSS3** with custom styling (no framework)
- **PWA** with service worker and manifest
- **Capacitor 7.x** for native Android wrapper

## Backend & Services

- **Firebase**:
  - Firestore for data storage
  - Firebase Functions (Node.js 20) for server-side logic
  - Firebase Hosting
  - Firebase Auth
- **Google Gemini AI** for workout analysis (`@google/generative-ai`)
- **Google Fit API** via `googleapis` for health data
- **Terra API** for Apple Health/wearable integration

## Key Dependencies

### Root (package.json)
- `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` - Native mobile
- `@capacitor/filesystem`, `@capacitor/share` - Native features

### Functions (functions/package.json)
- `firebase-admin`, `firebase-functions` - Backend
- `googleapis` - Google Fit integration
- `@google/generative-ai` - Gemini AI
- `dotenv` - Environment config

## Build & Commands

```bash
# Build web assets to dist/
npm run build

# Deploy Firebase Functions
cd functions && npm run deploy

# Firebase emulator for local testing
cd functions && npm run serve

# View Firebase function logs
cd functions && npm run logs

# Sync Capacitor after web changes
npx cap sync android
```

## Project Configuration

- `capacitor.config.json` - Capacitor/Android settings (appId: `com.gymbro.app`)
- `firebase.json` - Firebase hosting and functions config
- `firestore.rules` - Database security rules
- `manifest.json` - PWA manifest

## Code Conventions

- ES6 module imports/exports
- Classes for services (e.g., `FirestoreService`, `HealthConnectService`)
- localStorage for offline data with cloud sync
- Async/await for all async operations
- Console logging with emoji prefixes for debugging (📒, 📚, etc.)
