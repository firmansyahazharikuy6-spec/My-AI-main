const fs=require('fs');
const text=fs.readFileSync('c:/Users/xiao/Pictures/My-AI-main/js/providers.js','utf8');
const m = text.match(/if \(key\) headers\.Authorization = `[\s\S]*?;\n\s*return fetch\(/g);
console.log(m && m.length, m && m[0] && m[0].slice(0,80));
