const fs = require('fs');

const content = fs.readFileSync('./data/aves.json', 'utf8');

// Split by pattern where one object closes and another opens
let parts = content.split(/\}\s*\n\s*\{/);
console.log(`Found ${parts.length} separate JSON objects to consolidate`);

let allFamilias = [];
let objectNum = 0;

for (let i = 0; i < parts.length; i++) {
  let jsonStr = parts[i];
  
  // Add back the braces we removed
  if (i > 0) jsonStr = '{' + jsonStr;
  if (i < parts.length - 1) jsonStr = jsonStr + '}';
  
  jsonStr = jsonStr.trim();
  
  if (jsonStr && jsonStr.length > 10) {
    try {
      const obj = JSON.parse(jsonStr);
      if (obj.familias && Array.isArray(obj.familias)) {
        objectNum++;
        console.log(`Object ${objectNum}: Extracted ${obj.familias.length} families`);
        allFamilias = allFamilias.concat(obj.familias);
      }
    } catch (e) {
      console.log(`Object ${i}: Skipped due to parse error`);
    }
  }
}

console.log(`\n✓ Total families consolidated: ${allFamilias.length}`);

// Create final consolidated object
const finalData = {
  "version": "1.0",
  "region": "Colombia",
  "familias": allFamilias
};

// Write back
fs.writeFileSync('./data/aves.json', JSON.stringify(finalData, null, 2));

// Verify it's valid
try {
  const verified = JSON.parse(fs.readFileSync('./data/aves.json', 'utf8'));
  console.log(`✓ SUCCESS! File fixed. Total families: ${verified.familias.length}`);
} catch (e) {
  console.log(`✗ Error after save: ${e.message}`);
  process.exit(1);
}
