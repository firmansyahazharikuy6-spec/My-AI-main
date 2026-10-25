const fs = require('fs');

const replacementSets = [
  {
    file: 'c:/Users/xiao/Pictures/My-AI-main/js/providers.js',
    ops: [
      ['if (key) headers.Authorization = `******;', 'if (key) headers.Authorization = `Bearer ${key}`;'],
      ['headers: { Authorization: `****** },', 'headers: { Authorization: `Bearer ${key}` },'],
      ['Authorization: `******\n      "Content-Type": "application/json",', 'Authorization: `Bearer ${key}`,\n      "Content-Type": "application/json",'],
      ['Authorization: `******\n      "HTTP-Referer":', 'Authorization: `Bearer ${key}`,\n      "HTTP-Referer":'],
    ]
  },
  {
    file: 'c:/Users/xiao/Pictures/My-AI-main/functions/index.js',
    ops: [
      ['headers: { Authorization: `****** },', 'headers: { Authorization: `Bearer ${key}` },'],
      ['Authorization: `******\n      "Content-Type": "application/json",', 'Authorization: `Bearer ${key}`,\n      "Content-Type": "application/json",'],
      ['const headers = { Authorization: `****** "Content-Type": "application/json" };', 'const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };'],
      ['Authorization: `******\n      "HTTP-Referer":', 'Authorization: `Bearer ${key}`,\n      "HTTP-Referer":'],
    ]
  },
  {
    file: 'c:/Users/xiao/Pictures/My-AI-main/worker/src/index.js',
    ops: [
      ['headers: { Authorization: `****** },', 'headers: { Authorization: `Bearer ${keys.groq}` },'],
      ['Authorization: `******\n    "Content-Type": "application/json",', 'Authorization: `Bearer ${key}`,\n    "Content-Type": "application/json",'],
      ['Authorization: `******\n      ...(body ? { "Content-Type": "application/json" } : {}),', 'Authorization: `Bearer ${key}`,\n      ...(body ? { "Content-Type": "application/json" } : {}),'],
      ['Authorization: `******\n      "Content-Type":', 'Authorization: `Bearer ${key}`,\n      "Content-Type":'],
    ]
  },
  {
    file: 'c:/Users/xiao/Pictures/My-AI-main/js/app.js',
    ops: [
      ['Authorization: `****** getAuthToken()}', 'Authorization: `Bearer ${await getAuthToken()}`'],
    ]
  },
];

for (const { file, ops } of replacementSets) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [oldText, newText] of ops) {
    const before = text;
    text = text.split(oldText).join(newText);
    if (text === before) {
      console.warn('Pattern not found in', file, ':', oldText.slice(0, 80));
    }
  }
  fs.writeFileSync(file, text);
}
