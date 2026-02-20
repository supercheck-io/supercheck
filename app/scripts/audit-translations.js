const fs = require('fs');
const src = fs.readFileSync('src/lib/status-page-translations.ts', 'utf8');

// Extract all TranslationKeys fields
const typeBlock = src.match(/export type TranslationKeys = \{([\s\S]*?)\};/);
if (!typeBlock) { console.log("No TranslationKeys type found"); process.exit(1); }
const keys = [...typeBlock[1].matchAll(/\s+(\w+)\s*:/g)].map(m => m[1]);
console.log("Total keys in TranslationKeys:", keys.length);

// Extract language blocks more carefully
const supported = ['en','ar','cs','da','de','es','fi','fr','hi','hr','hu','it','ja','ko','nl','no','pl','pt','ro','ru','sv','tr','uk','zh'];

let allGood = true;
for (const lang of supported) {
  // Find the language block by looking for the pattern "  <lang>: {"
  const startPattern = new RegExp(`^  ${lang}: \\{`, 'm');
  const startMatch = startPattern.exec(src);
  if (!startMatch) {
    console.log(`${lang}: BLOCK NOT FOUND`);
    allGood = false;
    continue;
  }
  // Find the matching closing brace
  let depth = 0;
  let startIdx = startMatch.index + startMatch[0].length;
  let blockContent = '';
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') {
      if (depth === 0) {
        blockContent = src.substring(startIdx, i);
        break;
      }
      depth--;
    }
  }
  
  const presentKeys = [...blockContent.matchAll(/^\s{4}(\w+)\s*:/gm)].map(m => m[1]);
  const missing = keys.filter(k => !presentKeys.includes(k));
  const extra = presentKeys.filter(k => !keys.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    console.log(`${lang}: ${missing.length} missing, ${extra.length} extra`);
    if (missing.length) console.log("  Missing:", missing.join(', '));
    if (extra.length) console.log("  Extra:", extra.join(', '));
    allGood = false;
  }
}

if (allGood) {
  console.log("\nAll languages have all keys!");
}

console.log("\nDone.");
