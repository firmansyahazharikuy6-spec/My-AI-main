const fs = require('fs');
const path = 'c:/Users/xiao/Pictures/My-AI-main/js/providers.js';
let text = fs.readFileSync(path, 'utf8');
text = text.replace(/if \(key\) headers\.Authorization = `[\s\S]*?;\n\s*return fetch\(/g, 'if (key) headers.Authorization = `Bearer ${key}`;\n    return fetch(');
console.log('contains', text.includes('Bearer ${key}'));
const idx = text.indexOf('Authorization');
console.log(JSON.stringify(text.slice(idx-20, idx+120)));
