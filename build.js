/* eslint-disable no-console */
/**
 * GymBro / IronFlow — Production build script (P1.10)
 *
 * Responsibilities:
 *  - Clean and repopulate `dist/` from the project root.
 *  - Exclude sensitive/dev-only artifacts (see EXCLUDED_ROOT_DIRS / EXCLUDED_ROOT_FILES).
 *  - Minify JS with Terser (keeping a `.map` source map next to each file).
 *  - Minify CSS with clean-css.
 *  - Leave HTML as-is (DOM manipulation is fragile; CSP handles most hardening).
 *
 * Output layout mirrors the project root but only contains the files that
 * should be publicly served (never `functions/`, `android/`, `.backup/`, etc.).
 */

const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');

let Terser;
let CleanCSS;
try {
    Terser = require('terser');
} catch (err) {
    console.warn('[build] terser not found — JS will be copied without minification. Run `npm install` first.');
}
try {
    CleanCSS = require('clean-css');
} catch (err) {
    console.warn('[build] clean-css not found — CSS will be copied without minification. Run `npm install` first.');
}

// --- Config ---------------------------------------------------------------

// Directories at the repo root that must NEVER be copied into dist.
// P0.8/P3.37: `functions/` contains server secrets; `android/` is the native
// build output (also never-be-shipped); `.backup/` contains pre-minified
// sources; `myapp-native/` is a removed legacy duplicate.
const EXCLUDED_ROOT_DIRS = new Set([
    'dist',
    'android',
    'node_modules',
    '.git',
    '.github',
    '.vscode',
    '.gemini',
    '.kiro',
    '.windsurf',
    '.backup',
    'myapp-native',
    'functions',
    'scripts'
]);

// Individual files at the repo root that must not be shipped.
const EXCLUDED_ROOT_FILES = new Set([
    'build.js',
    'package.json',
    'package-lock.json',
    'capacitor.config.json',
    '.gitignore',
    '.firebaserc',
    'firebase.json',
    'firestore.rules',
    'firestore_debug.rules',
    'firestore.indexes.json',
    'initial_data.json',
    'README.md',
    'START_HERE.md',
    'sync-state.md',
    // Test / demo pages must not be deployed.
    'migrate-emails.html',
    'test-export.html',
    'test-word-export.html',
    'test-oauth-config.html',
    'test-toon-implementation.html',
    'test-lucide-index.png'
]);

// Any file name matching one of these globs (tested anywhere in the tree)
// is skipped. We keep this conservative to avoid surprising behavior.
const EXCLUDED_FILE_GLOBS = [
    /^\..+$/,                 // any dotfile
    /\.map$/,                 // stray source maps in the source tree
    /^.*\.(md|markdown)$/i,   // markdown docs
    /^.*\.(log|tmp|bak|orig)$/i
];

// --- Helpers --------------------------------------------------------------

function relative(p) {
    return path.relative(srcDir, p) || '.';
}

function shouldSkipFile(fileName, fullPath) {
    if (EXCLUDED_FILE_GLOBS.some((re) => re.test(fileName))) return true;
    // exclude the repo root .env / .env.local even if named specifically
    if (/^\.env(\..*)?$/.test(fileName)) return true;
    return false;
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanDist() {
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
        console.log('[build] cleaned', relative(distDir));
    }
    ensureDir(distDir);
}

async function processJs(src, dest) {
    const raw = fs.readFileSync(src, 'utf8');
    if (!Terser) {
        fs.writeFileSync(dest, raw);
        return;
    }
    try {
        const fileBase = path.basename(dest);
        const result = await Terser.minify({ [fileBase]: raw }, {
            ecma: 2020,
            compress: {
                passes: 2,
                drop_console: false,   // keep useful logs for incident triage
                drop_debugger: true,
                pure_funcs: ['console.debug']
            },
            mangle: true,
            format: {
                comments: false,
                ascii_only: false
            },
            sourceMap: {
                filename: fileBase,
                url: `${fileBase}.map`
            }
        });

        if (result.error) throw result.error;

        fs.writeFileSync(dest, result.code, 'utf8');
        if (result.map) {
            fs.writeFileSync(`${dest}.map`, result.map, 'utf8');
        }
    } catch (err) {
        console.warn(`[build] terser failed for ${relative(src)} — copying as-is (${err.message})`);
        fs.writeFileSync(dest, raw);
    }
}

function processCss(src, dest) {
    const raw = fs.readFileSync(src, 'utf8');
    if (!CleanCSS) {
        fs.writeFileSync(dest, raw);
        return;
    }
    try {
        const minifier = new CleanCSS({
            level: {
                1: { specialComments: 0 },
                2: { all: false, mergeMedia: true }
            },
            returnPromise: false,
            sourceMap: true,
            sourceMapInlineSources: false
        });
        const output = minifier.minify(raw);
        if (output.errors && output.errors.length) {
            console.warn(`[build] clean-css errors for ${relative(src)}:`, output.errors);
        }
        fs.writeFileSync(dest, output.styles, 'utf8');
        if (output.sourceMap) {
            fs.writeFileSync(`${dest}.map`, output.sourceMap.toString(), 'utf8');
        }
    } catch (err) {
        console.warn(`[build] clean-css failed for ${relative(src)} — copying as-is (${err.message})`);
        fs.writeFileSync(dest, raw);
    }
}

async function copyEntry(entrySrc, entryDest, isRoot) {
    const stats = fs.statSync(entrySrc);

    if (stats.isDirectory()) {
        ensureDir(entryDest);
        const children = fs.readdirSync(entrySrc);
        for (const child of children) {
            const childSrc = path.join(entrySrc, child);
            const childDest = path.join(entryDest, child);
            const childRel = path.relative(srcDir, childSrc);

            if (isRoot && (EXCLUDED_ROOT_DIRS.has(child) || EXCLUDED_ROOT_FILES.has(child))) {
                continue;
            }
            // Never ship dotfiles/dotdirs (e.g. .firebase, .env, .kiro, .backup)
            if (child.startsWith('.')) continue;
            const childStats = fs.statSync(childSrc);
            if (childStats.isFile() && shouldSkipFile(child, childSrc)) continue;
            if (childStats.isDirectory() && EXCLUDED_ROOT_DIRS.has(child)) continue;

            // Defense in depth: never descend into a `node_modules` deeper in the tree
            if (child === 'node_modules') continue;

            await copyEntry(childSrc, childDest, false);
        }
        return;
    }

    if (!stats.isFile()) return;

    const ext = path.extname(entrySrc).toLowerCase();
    ensureDir(path.dirname(entryDest));

    if (ext === '.js' && !entrySrc.includes(`${path.sep}lib${path.sep}`)) {
        // Skip re-minifying 3rd-party `lib/*.min.js` bundles.
        if (/\.min\.js$/.test(entrySrc)) {
            fs.copyFileSync(entrySrc, entryDest);
            return;
        }
        await processJs(entrySrc, entryDest);
        return;
    }

    if (ext === '.css' && !/\.min\.css$/.test(entrySrc)) {
        processCss(entrySrc, entryDest);
        return;
    }

    fs.copyFileSync(entrySrc, entryDest);
}

async function main() {
    const started = Date.now();
    console.log('[build] starting');
    cleanDist();
    await copyEntry(srcDir, distDir, true);
    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    console.log(`[build] completed in ${elapsed}s — dist/ ready`);
}

main().catch((err) => {
    console.error('[build] failed:', err);
    process.exit(1);
});
