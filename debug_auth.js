const fs = require('fs');
const text = fs.readFileSync('c:/Users/xiao/Pictures/My-AI-main/js/providers.js', 'utf8');
const checks = [
  'if (key) headers.Authorization = `******;',
  'headers: { Authorization: `****** },',
  'Authorization: `******\n      "Content-Type": "application/json",',
];
for (const c of checks) {
  console.log(JSON.stringify(c), text.includes(c));
}
console.log('slice', JSON.stringify(text.slice(text.indexOf('Authorization')-40, text.indexOf('Authorization')+120)));
