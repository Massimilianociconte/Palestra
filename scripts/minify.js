#!/usr/bin/env node

/**
 * GymBro Safe Minification Script
 * ================================
 * Uses industry-standard AST-based tools:
 *   - terser v5 for JavaScript (handles template literals, regex, emoji, ES2022+)
 *   - clean-css v5 for CSS (handles calc(), var(), clamp(), content:, @keyframes, custom properties)
 *
 * Safety features:
 *   1. Backup originals to .backup/ before overwriting
 *   2. Dry-run mode (--dry-run) — compares sizes without writing
 *   3. Post-minification syntax validation (re-parse JS, re-parse CSS)
 *   4. Skips already-minified files (*.min.js, *.min.css)
 *   5. UTF-8 encoding preserved throughout
 *   6. No variable mangling by default (--mangle flag to enable)
 *   7. Atomic writes: only overwrites original if validation passes
 *   8. Detailed per-file report with compression ratios
 *
 * Usage:
 *   node scripts/minify.js --dry-run          # Preview only, no changes
 *   node scripts/minify.js                    # Minify and overwrite originals (with backup)
 *   node scripts/minify.js --mangle           # Also mangle variable names (more aggressive)
 *   node scripts/minify.js --no-backup        # Skip backup (use with caution)
 *   node scripts/minify.js --target=dist      # Minify dist/ folder instead of source
 */

const fs = require('fs');
const path = require('path');
const { minify: terserMinify } = require('terser');
const CleanCSS = require('clean-css');

// ============================================
// CONFIGURATION
// ============================================

const ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  jsDirs: ['js'],
  cssDirs: ['css'],
  skipPatterns: [/\.min\.js$/, /\.min\.css$/, /firebase-config\.js$/],
  backupDir: path.join(ROOT, '.backup'),
  encoding: 'utf8',
};

// terser options — CONSERVATIVE for maximum safety
const TERSER_BASE_OPTIONS = {
  compress: {
    // Safe compressions only
    dead_code: true,
    drop_debugger: true,
    conditionals: true,
    evaluate: true,
    booleans: true,
    loops: true,
    unused: true,
    if_return: true,
    join_vars: true,
    collapse_vars: false,      // DISABLED — can break template literal ordering
    reduce_vars: false,        // DISABLED — can break closures with side effects
    sequences: true,
    properties: true,
    comparisons: true,
    hoist_funs: false,         // DISABLED — can change execution order
    hoist_vars: false,         // DISABLED — can change execution order
    pure_getters: false,       // DISABLED — can't guarantee no side effects
    toplevel: false,           // DISABLED — preserves exports
    passes: 1,                 // Single pass — safest
  },
  mangle: false,               // OFF by default — flag to enable
  format: {
    comments: false,           // Remove comments
    ascii_only: false,         // Preserve UTF-8 (emoji, special chars)
    beautify: false,
    ecma: 2020,
  },
  ecma: 2020,
  module: true,                // Support ES modules (import/export)
  sourceMap: false,
};

// clean-css options — LEVEL 1 only (no restructuring)
const CLEANCSS_OPTIONS = {
  level: {
    1: {
      all: true,
      normalizeUrls: false,          // Don't touch URLs
      optimizeBackground: false,     // Don't merge background shorthand
      optimizeBorderRadius: false,   // Don't merge border-radius shorthand
      optimizeFilter: false,         // Don't touch filters
      optimizeFont: false,           // Don't merge font shorthand
      optimizeFontWeight: false,     // Don't touch font-weight
      optimizeOutline: false,        // Don't merge outline shorthand
      specialComments: 0,            // Remove all comments
      removeEmpty: true,
      removeWhitespace: true,
      replaceMultipleZeros: true,
      replaceZeroUnits: true,
      tidyAtRules: true,
      tidyBlockScopes: true,
      tidySelectors: true,
    },
    2: false,                        // NO level 2 — no restructuring, no merging
  },
  compatibility: '*',                // All browsers
  inline: false,                     // Don't inline @import
  rebase: false,                     // Don't rewrite URLs
};

// ============================================
// CLI PARSING
// ============================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MANGLE = args.includes('--mangle');
const NO_BACKUP = args.includes('--no-backup');
const TARGET_DIST = args.includes('--target=dist');

if (MANGLE) {
  TERSER_BASE_OPTIONS.mangle = {
    reserved: [
      // Preserve globals that are referenced by name
      'firebase', 'auth', 'db', 'Capacitor', 'QRCode',
      'Chart', 'Sortable', 'gymbRoomService', 'GymbRoomUI',
      'friendshipService', 'syncManager', 'prTracker',
    ],
    keep_classnames: true,
    keep_fnames: true,
  };
}

const BASE_DIR = TARGET_DIST ? path.join(ROOT, 'dist') : ROOT;

// ============================================
// FILE DISCOVERY
// ============================================

function discoverFiles(baseDirs, extensions) {
  const files = [];

  for (const dir of baseDirs) {
    const fullDir = path.join(BASE_DIR, dir);
    if (!fs.existsSync(fullDir)) {
      console.warn(`  ⚠ Directory not found: ${fullDir}`);
      continue;
    }
    walkDir(fullDir, extensions, files);
  }

  // Filter out already-minified and excluded files
  return files.filter(f => {
    const rel = path.relative(BASE_DIR, f);
    return !CONFIG.skipPatterns.some(p => p.test(rel));
  });
}

function walkDir(dir, extensions, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, extensions, result);
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      result.push(fullPath);
    }
  }
}

// ============================================
// BACKUP
// ============================================

function backupFile(filePath) {
  if (NO_BACKUP || DRY_RUN) return;

  const rel = path.relative(BASE_DIR, filePath);
  const backupPath = path.join(CONFIG.backupDir, rel);
  const backupDir = path.dirname(backupPath);

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(filePath, backupPath);
}

// ============================================
// JS MINIFICATION + VALIDATION
// ============================================

async function minifyJS(filePath) {
  const rel = path.relative(BASE_DIR, filePath);
  const original = fs.readFileSync(filePath, CONFIG.encoding);
  const originalSize = Buffer.byteLength(original, CONFIG.encoding);

  if (originalSize === 0) {
    return { file: rel, status: 'skipped', reason: 'empty file' };
  }

  try {
    // Detect if file uses ES modules
    const isModule = /\b(import|export)\b/.test(original);
    const options = {
      ...TERSER_BASE_OPTIONS,
      module: isModule,
    };

    // MINIFY
    const result = await terserMinify(original, options);

    if (result.error) {
      return { file: rel, status: 'ERROR', reason: `Terser error: ${result.error.message}` };
    }

    const minified = result.code;
    const minifiedSize = Buffer.byteLength(minified, CONFIG.encoding);

    // VALIDATION: re-parse the minified output to ensure no syntax corruption
    try {
      const validateResult = await terserMinify(minified, {
        compress: false,
        mangle: false,
        format: { beautify: false },
        module: isModule,
      });
      if (validateResult.error) {
        return {
          file: rel,
          status: 'VALIDATION_FAILED',
          reason: `Minified output has syntax errors: ${validateResult.error.message}`,
        };
      }
    } catch (valErr) {
      return {
        file: rel,
        status: 'VALIDATION_FAILED',
        reason: `Validation parse failed: ${valErr.message}`,
      };
    }

    // SANITY CHECKS
    // 1. Minified should not be larger than original (with small tolerance for edge cases)
    if (minifiedSize > originalSize * 1.05) {
      return {
        file: rel,
        status: 'SUSPICIOUS',
        reason: `Minified is larger than original (${minifiedSize} > ${originalSize})`,
        originalSize,
        minifiedSize,
      };
    }

    // 2. Check that key patterns survived minification
    const checks = [];

    // Export/import statements must survive in modules
    if (isModule) {
      const origExports = (original.match(/\bexport\b/g) || []).length;
      const minExports = (minified.match(/\bexport\b/g) || []).length;
      if (origExports > 0 && minExports === 0) {
        checks.push(`All export statements were lost (${origExports} → 0)`);
      }
    }

    // String literal integrity: ensure string count is preserved
    // (counts both single and double quoted strings)
    const origStrings = (original.match(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g) || []).length;
    const minStrings = (minified.match(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g) || []).length;
    // Terser may merge or split strings; large drops indicate corruption
    if (origStrings > 0 && minStrings < origStrings * 0.5) {
      checks.push(`String literal count dropped significantly: ${origStrings} → ${minStrings}`);
    }

    // WRITE
    if (!DRY_RUN) {
      backupFile(filePath);
      fs.writeFileSync(filePath, minified, CONFIG.encoding);
    }

    const ratio = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

    return {
      file: rel,
      status: checks.length > 0 ? 'OK_WITH_WARNINGS' : 'OK',
      originalSize,
      minifiedSize,
      ratio: `${ratio}%`,
      warnings: checks.length > 0 ? checks : undefined,
    };
  } catch (err) {
    return { file: rel, status: 'ERROR', reason: err.message };
  }
}

// ============================================
// CSS MINIFICATION + VALIDATION
// ============================================

function minifyCSS(filePath) {
  const rel = path.relative(BASE_DIR, filePath);
  const original = fs.readFileSync(filePath, CONFIG.encoding);
  const originalSize = Buffer.byteLength(original, CONFIG.encoding);

  if (originalSize === 0) {
    return { file: rel, status: 'skipped', reason: 'empty file' };
  }

  try {
    const cleanCSS = new CleanCSS(CLEANCSS_OPTIONS);
    const result = cleanCSS.minify(original);

    if (result.errors && result.errors.length > 0) {
      return { file: rel, status: 'ERROR', reason: result.errors.join('; ') };
    }

    const minified = result.styles;
    const minifiedSize = Buffer.byteLength(minified, CONFIG.encoding);

    // VALIDATION: re-parse with clean-css to catch syntax corruption
    const validateResult = new CleanCSS({ level: 0 }).minify(minified);
    if (validateResult.errors && validateResult.errors.length > 0) {
      return {
        file: rel,
        status: 'VALIDATION_FAILED',
        reason: `Minified CSS has errors: ${validateResult.errors.join('; ')}`,
      };
    }

    // SANITY CHECKS
    const checks = [];

    // 1. content: properties must survive
    const origContent = (original.match(/content\s*:\s*['"][^'"]*['"]/g) || []).length;
    const minContent = (minified.match(/content\s*:\s*['"][^'"]*['"]/g) || []).length;
    if (origContent !== minContent) {
      checks.push(`CSS content: property count mismatch: ${origContent} → ${minContent}`);
    }

    // 2. Custom properties must survive
    const origVars = (original.match(/--[a-zA-Z][a-zA-Z0-9-]*/g) || []);
    const minVars = (minified.match(/--[a-zA-Z][a-zA-Z0-9-]*/g) || []);
    const origVarSet = new Set(origVars);
    const minVarSet = new Set(minVars);
    const lostVars = [...origVarSet].filter(v => !minVarSet.has(v));
    if (lostVars.length > 0) {
      checks.push(`Lost CSS custom properties: ${lostVars.join(', ')}`);
    }

    // 3. calc() expressions must survive
    const origCalc = (original.match(/calc\s*\(/g) || []).length;
    const minCalc = (minified.match(/calc\(/g) || []).length;
    if (origCalc !== minCalc) {
      checks.push(`calc() count mismatch: ${origCalc} → ${minCalc}`);
    }

    // 4. @keyframes must survive
    const origKeyframes = (original.match(/@keyframes\s+[\w-]+/g) || []);
    const minKeyframes = (minified.match(/@keyframes\s*[\w-]+/g) || []);
    if (origKeyframes.length !== minKeyframes.length) {
      checks.push(`@keyframes count mismatch: ${origKeyframes.length} → ${minKeyframes.length}`);
    }

    // 5. @media queries must survive
    const origMedia = (original.match(/@media/g) || []).length;
    const minMedia = (minified.match(/@media/g) || []).length;
    if (origMedia !== minMedia) {
      checks.push(`@media count mismatch: ${origMedia} → ${minMedia}`);
    }

    // 6. var() must survive
    const origVarFn = (original.match(/var\s*\(/g) || []).length;
    const minVarFn = (minified.match(/var\(/g) || []).length;
    if (origVarFn !== minVarFn) {
      checks.push(`var() count mismatch: ${origVarFn} → ${minVarFn}`);
    }

    // 7. clamp() must survive
    const origClamp = (original.match(/clamp\s*\(/g) || []).length;
    const minClamp = (minified.match(/clamp\(/g) || []).length;
    if (origClamp !== minClamp) {
      checks.push(`clamp() count mismatch: ${origClamp} → ${minClamp}`);
    }

    // WRITE
    if (!DRY_RUN) {
      backupFile(filePath);
      fs.writeFileSync(filePath, minified, CONFIG.encoding);
    }

    const ratio = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

    return {
      file: rel,
      status: checks.length > 0 ? 'OK_WITH_WARNINGS' : 'OK',
      originalSize,
      minifiedSize,
      ratio: `${ratio}%`,
      warnings: checks.length > 0 ? checks : undefined,
      cleanCSSWarnings: result.warnings && result.warnings.length > 0 ? result.warnings : undefined,
    };
  } catch (err) {
    return { file: rel, status: 'ERROR', reason: err.message };
  }
}

// ============================================
// REPORTING
// ============================================

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function printReport(results, type) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${type} MINIFICATION REPORT`);
  console.log(`${'='.repeat(70)}`);

  let totalOrig = 0;
  let totalMin = 0;
  let okCount = 0;
  let warnCount = 0;
  let errCount = 0;
  let skipCount = 0;

  for (const r of results) {
    const icon =
      r.status === 'OK' ? '✅' :
      r.status === 'OK_WITH_WARNINGS' ? '⚠️' :
      r.status === 'skipped' ? '⏭️' :
      '❌';

    if (r.status === 'OK' || r.status === 'OK_WITH_WARNINGS') {
      totalOrig += r.originalSize;
      totalMin += r.minifiedSize;
      console.log(`  ${icon} ${r.file}`);
      console.log(`     ${formatSize(r.originalSize)} → ${formatSize(r.minifiedSize)} (${r.ratio} saved)`);
      if (r.status === 'OK') okCount++;
      else warnCount++;
    } else if (r.status === 'skipped') {
      console.log(`  ${icon} ${r.file} — ${r.reason}`);
      skipCount++;
    } else {
      console.log(`  ${icon} ${r.file} — ${r.status}: ${r.reason}`);
      errCount++;
    }

    if (r.warnings) {
      for (const w of r.warnings) {
        console.log(`     ⚠ ${w}`);
      }
    }
  }

  console.log(`\n  SUMMARY:`);
  console.log(`  ✅ OK: ${okCount}  ⚠️ Warnings: ${warnCount}  ❌ Errors: ${errCount}  ⏭️ Skipped: ${skipCount}`);

  if (totalOrig > 0) {
    const totalRatio = ((1 - totalMin / totalOrig) * 100).toFixed(1);
    console.log(`  📦 Total: ${formatSize(totalOrig)} → ${formatSize(totalMin)} (${totalRatio}% saved)`);
  }

  return errCount;
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              GymBro Safe Minification Script v1.0                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Mode:      ${DRY_RUN ? '🔍 DRY RUN (no files modified)' : '🔨 LIVE (files will be overwritten)'}`);
  console.log(`  Mangle:    ${MANGLE ? '✅ ON (variable names shortened)' : '❌ OFF (variable names preserved)'}`);
  console.log(`  Backup:    ${NO_BACKUP ? '❌ OFF' : '✅ ON → .backup/'}`);
  console.log(`  Target:    ${TARGET_DIST ? 'dist/' : 'source (js/, css/)'}`);
  console.log('');

  // Discover files
  const jsFiles = discoverFiles(CONFIG.jsDirs, ['.js']);
  const cssFiles = discoverFiles(CONFIG.cssDirs, ['.css']);

  console.log(`  Found: ${jsFiles.length} JS files, ${cssFiles.length} CSS files`);

  if (jsFiles.length === 0 && cssFiles.length === 0) {
    console.log('  No files to process. Exiting.');
    return;
  }

  // Create backup dir
  if (!DRY_RUN && !NO_BACKUP) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    CONFIG.backupDir = path.join(ROOT, '.backup', timestamp);
    fs.mkdirSync(CONFIG.backupDir, { recursive: true });
    console.log(`  Backup dir: ${path.relative(ROOT, CONFIG.backupDir)}`);
  }

  // Process JS
  console.log('\n  Processing JavaScript files...');
  const jsResults = [];
  for (const file of jsFiles) {
    const result = await minifyJS(file);
    jsResults.push(result);
  }

  // Process CSS
  console.log('  Processing CSS files...');
  const cssResults = [];
  for (const file of cssFiles) {
    const result = minifyCSS(file);
    cssResults.push(result);
  }

  // Print reports
  const jsErrors = printReport(jsResults, 'JAVASCRIPT');
  const cssErrors = printReport(cssResults, 'CSS');

  // Final verdict
  console.log(`\n${'='.repeat(70)}`);
  const totalErrors = jsErrors + cssErrors;
  if (totalErrors > 0) {
    console.log(`  ❌ FAILED — ${totalErrors} file(s) had errors. No corrupted files were written.`);
    process.exit(1);
  } else if (DRY_RUN) {
    console.log('  🔍 DRY RUN COMPLETE — no files were modified.');
    console.log('  Run without --dry-run to apply minification.');
  } else {
    console.log('  ✅ ALL FILES MINIFIED SUCCESSFULLY');
    console.log(`  Backups saved to: ${path.relative(ROOT, CONFIG.backupDir)}`);
  }
  console.log(`${'='.repeat(70)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
