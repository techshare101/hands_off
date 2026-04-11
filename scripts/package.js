// Chrome Web Store Packaging Script
// Usage: npm run package
// Runs build, then zips the dist/ folder for store submission

import { execSync } from 'child_process';
import { createWriteStream, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const version = pkg.version;
const zipName = `handoff-extension-v${version}.zip`;
const zipPath = join(root, zipName);

console.log(`\n📦 Packaging HandOff v${version}...\n`);

// Step 1: Run the full build
console.log('🔨 Building...');
try {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.error('❌ Build failed. Fix errors before packaging.');
  process.exit(1);
}

// Step 2: Verify dist/ has required files
const requiredFiles = ['manifest.json', 'sidepanel.html', 'src/background/index.js'];
for (const f of requiredFiles) {
  if (!existsSync(join(dist, f))) {
    console.error(`❌ Missing required file in dist/: ${f}`);
    process.exit(1);
  }
}

// Step 3: Create ZIP using Node streams (no external zip dependency needed)
console.log(`\n📁 Creating ${zipName}...`);

// Simple recursive ZIP using built-in modules
async function createZip() {
  return new Promise((resolve, reject) => {
    // Use a simple approach: list all files and write a zip
    // Since archiver might not be installed, use a manual approach
    const files = [];
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else {
          files.push(full);
        }
      }
    }
    walk(dist);

    // Use PowerShell Compress-Archive on Windows, zip on Unix
    const relPaths = files.map(f => relative(dist, f));
    console.log(`   ${relPaths.length} files found in dist/`);

    try {
      if (process.platform === 'win32') {
        // Remove existing zip if present
        execSync(`powershell -Command "if (Test-Path '${zipPath}') { Remove-Item '${zipPath}' }"`, { cwd: root });
        execSync(`powershell -Command "Compress-Archive -Path '${dist}\\*' -DestinationPath '${zipPath}' -Force"`, { cwd: root });
      } else {
        execSync(`rm -f "${zipPath}" && cd "${dist}" && zip -r "${zipPath}" .`, { cwd: root });
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

await createZip();

// Step 4: Report
if (existsSync(zipPath)) {
  const size = statSync(zipPath).size;
  const sizeKB = (size / 1024).toFixed(1);
  const sizeMB = (size / (1024 * 1024)).toFixed(2);
  console.log(`\n✅ Packaged successfully: ${zipName}`);
  console.log(`📦 Size: ${sizeKB} KB (${sizeMB} MB)`);
  console.log(`\n🚀 Upload to: https://chrome.google.com/webstore/devconsole`);
} else {
  console.error('❌ ZIP creation failed');
  process.exit(1);
}
