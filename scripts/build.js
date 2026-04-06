// Post-build script to copy manifest and icons to dist
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

// Ensure dist exists
if (!existsSync(dist)) {
  mkdirSync(dist, { recursive: true });
}

// Copy manifest.json
copyFileSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
console.log('Copied manifest.json');

// Copy icons
const iconsDir = join(root, 'icons');
const distIcons = join(dist, 'icons');
mkdirSync(distIcons, { recursive: true });

if (existsSync(iconsDir)) {
  readdirSync(iconsDir).forEach(file => {
    if (file.endsWith('.png')) {
      copyFileSync(join(iconsDir, file), join(distIcons, file));
      console.log(`Copied icons/${file}`);
    }
  });
}

// Copy content script CSS
const contentCss = join(root, 'src', 'content', 'styles.css');
const distContentDir = join(dist, 'src', 'content');
mkdirSync(distContentDir, { recursive: true });
if (existsSync(contentCss)) {
  copyFileSync(contentCss, join(distContentDir, 'styles.css'));
  console.log('Copied content styles.css');
}

// Copy voice.html and voice.js for voice input popup
const voiceHtml = join(root, 'public', 'voice.html');
const voiceJs = join(root, 'public', 'voice.js');
if (existsSync(voiceHtml)) {
  copyFileSync(voiceHtml, join(dist, 'voice.html'));
  console.log('Copied voice.html');
}
if (existsSync(voiceJs)) {
  copyFileSync(voiceJs, join(dist, 'voice.js'));
  console.log('Copied voice.js');
}

console.log('\\nBuild complete! Load the dist folder as an unpacked extension.');
