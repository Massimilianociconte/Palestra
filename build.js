const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');

// Files and folders to exclude
const excludes = [
    'dist',
    'android',
    'node_modules',
    '.git',
    '.vscode',
    '.gemini',
    'package.json',
    'package-lock.json',
    'capacitor.config.json',
    'build.js',
    '.gitignore',
    'myapp-native'
];

function cleanDist() {
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
        console.log('Cleaned dist directory');
    }
    fs.mkdirSync(distDir);
}

function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    const isDirectory = stats.isDirectory();

    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest);
        }

        fs.readdirSync(src).forEach(childItemName => {
            // Check manual excludes for root items
            if (src === srcDir && excludes.includes(childItemName)) {
                return;
            }
            // Skip system/hidden files
            if (childItemName.startsWith('.')) return;

            copyRecursive(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

try {
    console.log('Starting build...');
    cleanDist();
    copyRecursive(srcDir, distDir);
    console.log('Build completed successfully! `dist` folder populated.');
} catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
}
