// Simple script to create placeholder icon files
// Run: node scripts/generate-icons.js

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'icons');

// Create a simple 1x1 purple PNG for each size
// In production, replace with actual icon files
const sizes = [16, 32, 48, 128];

// Minimal valid PNG (1x1 purple pixel)
const createMinimalPNG = () => {
  // This is a base64 encoded 1x1 purple PNG
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return Buffer.from(base64, 'base64');
};

try {
  mkdirSync(iconsDir, { recursive: true });
  
  sizes.forEach(size => {
    const filename = `icon${size}.png`;
    const filepath = join(iconsDir, filename);
    writeFileSync(filepath, createMinimalPNG());
    console.log(`Created ${filename}`);
  });
  
  console.log('\\nIcon placeholders created. Replace with actual icons before publishing.');
} catch (error) {
  console.error('Error creating icons:', error);
}
