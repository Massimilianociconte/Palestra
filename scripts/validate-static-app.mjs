import { promises as fs } from "node:fs";
import path from "node:path";
import { minify } from "terser";

const rootDir = process.cwd();
const topLevelHtml = [
    "analysis.html",
    "auth-callback.html",
    "body.html",
    "creator.html",
    "diary.html",
    "friends.html",
    "index.html",
    "migrate-emails.html",
    "privacy.html",
    "records.html",
    "rooms.html",
    "terms.html",
    "test-export.html",
    "test-oauth-config.html",
    "test-toon-implementation.html",
    "test-word-export.html",
    "user.html"
];

const jsEntryFiles = [
    "build.js",
    "functions/index.js"
];

const pathProblems = [];
const parseProblems = [];

function isExternalRef(ref) {
    return /^(https?:|data:|mailto:|tel:|javascript:|\/\/)/i.test(ref);
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.name.startsWith(".")) {
            continue;
        }

        const absolutePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walk(absolutePath));
        } else {
            files.push(absolutePath);
        }
    }

    return files;
}

function resolveRef(baseFile, ref) {
    if (ref.startsWith("/")) {
        return path.join(rootDir, ref.slice(1));
    }

    return path.resolve(path.dirname(baseFile), ref);
}

async function validateHtmlRefs(relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    const source = await fs.readFile(absolutePath, "utf8");
    const pattern = /(?:src|href)=["']([^"'#?]+)["']/g;

    for (const match of source.matchAll(pattern)) {
        const ref = match[1];
        if (ref.includes("${")) {
            continue;
        }

        if (isExternalRef(ref)) {
            continue;
        }

        if (!(await fileExists(resolveRef(absolutePath, ref)))) {
            pathProblems.push(`${relativePath}: missing ${ref}`);
        }
    }
}

async function validateJsImports(relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    const source = await fs.readFile(absolutePath, "utf8");
    const pattern = /import\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;
    const allowBareSpecifiers = !relativePath.startsWith("js/");

    for (const match of source.matchAll(pattern)) {
        const ref = match[1] || match[2];
        if (!ref || isExternalRef(ref)) {
            continue;
        }

        if (!ref.startsWith(".") && !ref.startsWith("/")) {
            if (!allowBareSpecifiers) {
                pathProblems.push(`${relativePath}: unresolved bare specifier ${ref}`);
            }
            continue;
        }

        if (!(await fileExists(resolveRef(absolutePath, ref)))) {
            pathProblems.push(`${relativePath}: missing import ${ref}`);
        }
    }
}

async function validateJsSyntax(relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    const source = await fs.readFile(absolutePath, "utf8");
    const isModule = /^\s*(import|export)\b/m.test(source);

    try {
        await minify(source, {
            module: isModule,
            compress: false,
            mangle: false
        });
    } catch (error) {
        parseProblems.push(`${relativePath}: ${error.message}`);
    }
}

const jsFiles = (await walk(path.join(rootDir, "js")))
    .filter((filePath) => filePath.endsWith(".js"))
    .map((filePath) => path.relative(rootDir, filePath));

for (const htmlFile of topLevelHtml) {
    if (await fileExists(path.join(rootDir, htmlFile))) {
        await validateHtmlRefs(htmlFile);
    }
}

for (const jsFile of [...jsFiles, ...jsEntryFiles]) {
    if (await fileExists(path.join(rootDir, jsFile))) {
        await validateJsImports(jsFile);
        await validateJsSyntax(jsFile);
    }
}

if (pathProblems.length > 0 || parseProblems.length > 0) {
    if (pathProblems.length > 0) {
        console.error("Static reference issues:");
        pathProblems.forEach((problem) => console.error(`- ${problem}`));
    }

    if (parseProblems.length > 0) {
        console.error("Syntax issues:");
        parseProblems.forEach((problem) => console.error(`- ${problem}`));
    }

    process.exit(1);
}

console.log("Static app validation passed.");
