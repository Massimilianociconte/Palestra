# GymBro Project Structure

```
/
├── index.html          # Landing page
├── user.html           # User profile & health connect
├── creator.html        # Workout builder
├── diary.html          # Training log
├── analysis.html       # Analytics dashboard
├── body.html           # Body stats & heatmap
├── records.html        # PR records
│
├── js/                 # JavaScript modules
│   ├── main.js                    # App initialization
│   ├── firebase-config.js         # Firebase setup (sensitive)
│   ├── firestore-service.js       # Cloud data operations
│   ├── auth-service.js            # Authentication
│   ├── ai-service.js              # Gemini AI integration
│   ├── health-connect-service.js  # Google Fit/Terra
│   ├── health-toon-encoder.js     # TOON format encoding
│   ├── export-service.js          # Data export (PDF/Word)
│   ├── chart-renderer.js          # Chart.js visualizations
│   ├── trend-engine.js            # Progress analytics
│   ├── exercise-db.js             # Exercise database
│   ├── pr-tracker.js              # Personal records
│   ├── doms-insights.js           # Muscle soreness analysis
│   └── ...                        # Other feature modules
│
├── css/
│   ├── style.css              # Main styles
│   ├── advanced-charts.css    # Chart styling
│   ├── ai-reports-mobile.css  # AI report mobile styles
│   └── gymbro-chat.css        # Chat UI styles
│
├── functions/          # Firebase Cloud Functions
│   ├── index.js        # Function definitions
│   ├── package.json    # Node dependencies
│   └── .env            # OAuth credentials (not committed)
│
├── android/            # Capacitor Android project
│   └── app/src/main/
│       ├── java/com/gymbro/app/  # Native plugins
│       ├── assets/public/         # Web assets (copied)
│       └── res/                   # Android resources
│
├── dist/               # Build output (generated)
├── body-model/         # SVG body/muscle diagrams
├── assets/             # Static assets (icons)
│
├── build.js            # Build script (copies to dist/)
├── capacitor.config.json
├── firebase.json
├── firestore.rules
└── manifest.json
```

## Key Patterns

- **HTML pages** are standalone with shared JS modules
- **Services** are ES6 classes exported from `/js/` modules
- **Firebase config** in `js/firebase-config.js` (use `.example.js` as template)
- **Build output** goes to `/dist/` which Capacitor uses as `webDir`
- **Android assets** at `android/app/src/main/assets/public/` mirror web files

## Data Flow

1. User interacts with HTML pages
2. JS modules handle logic and call services
3. `FirestoreService` manages local/cloud sync
4. `localStorage` keys prefixed with `ironflow_` (legacy name)
5. Firebase Functions handle OAuth token exchange and server operations
