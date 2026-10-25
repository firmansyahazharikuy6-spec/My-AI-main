const fs = require('fs');

function fixProviders() {
  const file = 'c:/Users/xiao/Pictures/My-AI-main/js/providers.js';
  let text = fs.readFileSync(file, 'utf8');

  text = text.replace(/if \(key\) headers\.Authorization = `[\s\S]*?;\n\s*return fetch\(/g, () => 'if (key) headers.Authorization = `Bearer ${key}`;\n    return fetch(');
  text = text.replace(/headers:\s*\{\s*Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*"HTTP-Referer"|\n\s*"X-Title"|\n\s*\})/g, () => 'headers: { Authorization: `Bearer ${key}`');
  text = text.replace(/Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*"HTTP-Referer"|\n\s*"X-Title")/g, () => 'Authorization: `Bearer ${key}`');
  text = text.replace(/Authorization:\s*`[\s\S]*?(?=\n\s*\})/g, () => 'Authorization: `Bearer ${key}`');
  text = text.replace(/headers:\s*\{\s*Authorization:\s*`Bearer \$\{key\}`\s*\},/g, () => 'headers: { Authorization: `Bearer ${key}` },');

  fs.writeFileSync(file, text);
}

function fixFunctions() {
  const file = 'c:/Users/xiao/Pictures/My-AI-main/functions/index.js';
  let text = fs.readFileSync(file, 'utf8');

  text = text.replace(/headers:\s*\{\s*Authorization:\s*`[\s\S]*?\},/g, () => 'headers: { Authorization: `Bearer ${key}` },');
  text = text.replace(/Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*"HTTP-Referer")/g, () => 'Authorization: `Bearer ${key}`,');
  text = text.replace(/const headers = \{ Authorization: `[^\n]*"Content-Type": "application\/json" \};/g, () => 'const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };');

  fs.writeFileSync(file, text);
}

function fixWorker() {
  const file = 'c:/Users/xiao/Pictures/My-AI-main/worker/src/index.js';
  let text = fs.readFileSync(file, 'utf8');

  text = text.replace(/headers:\s*\{\s*Authorization:\s*`[\s\S]*?\},/g, () => 'headers: { Authorization: `Bearer ${keys.groq}` },');
  text = text.replace(/Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*\}\)|\n\s*\(body \? \{)/g, () => 'Authorization: `Bearer ${key}`,');
  text = text.replace(/Authorization:\s*`[\s\S]*?(?=\n\s*\.\.\.\(body \? \{)/g, () => 'Authorization: `Bearer ${key}`,');
  text = text.replace(/Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type")/g, () => 'Authorization: `Bearer ${key}`,');
  text = text.replace(/Authorization:\s*`Bearer \$\{key\}`,\s*\.\.\.\(body \? \{ "Content-Type": "application\/json" \} : \{\}\),/g, () => 'Authorization: `Bearer ${key}`,\n      ...(body ? { "Content-Type": "application/json" } : {}),');

  fs.writeFileSync(file, text);
}

function fixApp() {
  const file = 'c:/Users/xiao/Pictures/My-AI-main/js/app.js';
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/Authorization:\s*`[\s\S]*?getAuthToken\(\)\}/g, () => 'Authorization: `Bearer ${await getAuthToken()}`');
  fs.writeFileSync(file, text);
}

fixProviders();
fixFunctions();
fixWorker();
fixApp();
console.log('Auth header repairs applied.');
