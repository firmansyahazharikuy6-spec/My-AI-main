const fs = require('fs');

const bt = String.fromCharCode(96);
const star = String.fromCharCode(42);
const slashN = '\n';

function replaceInFile(filePath, rules) {
  let text = fs.readFileSync(filePath, 'utf8');
  for (const { regex, getReplacement } of rules) {
    text = text.replace(regex, getReplacement);
  }
  fs.writeFileSync(filePath, text);
}

replaceInFile('c:/Users/xiao/Pictures/My-AI-main/js/providers.js', [
  {
    regex: /if \(key\) headers\.Authorization = `[^\n]*?;\n\s*return fetch\(/g,
    getReplacement: () => 'if (key) headers.Authorization = ' + bt + 'Bearer ' + '${key}' + bt + ';' + slashN + '    return fetch(',
  },
  {
    regex: /Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*"HTTP-Referer"|\n\s*"X-Title"|\n\s*\})/g,
    getReplacement: () => 'Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ',',
  },
  {
    regex: /headers:\s*\{\s*Authorization:\s*`[\s\S]*?\},/g,
    getReplacement: () => 'headers: { Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ' },',
  },
]);

replaceInFile('c:/Users/xiao/Pictures/My-AI-main/functions/index.js', [
  {
    regex: /headers:\s*\{\s*Authorization:\s*`[\s\S]*?\},/g,
    getReplacement: () => 'headers: { Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ' },',
  },
  {
    regex: /Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*"HTTP-Referer")/g,
    getReplacement: () => 'Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ',',
  },
  {
    regex: /const headers = \{ Authorization: `[^\n]*"Content-Type": "application\/json" \};/g,
    getReplacement: () => 'const headers = { Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ', "Content-Type": "application/json" };',
  },
]);

replaceInFile('c:/Users/xiao/Pictures/My-AI-main/worker/src/index.js', [
  {
    regex: /headers:\s*\{\s*Authorization:\s*`[\s\S]*?\},/g,
    getReplacement: () => 'headers: { Authorization: ' + bt + 'Bearer ' + '${keys.groq}' + bt + ' },',
  },
  {
    regex: /Authorization:\s*`[\s\S]*?(?=\n\s*"Content-Type"|\n\s*\.\.\.\(body \? \{ \"Content-Type\": \"application\/json\" \} : \{\}\)|\n\s*\}\))/g,
    getReplacement: () => 'Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ',',
  },
  {
    regex: /Authorization:\s*`[\s\S]*?(?=\n\s*\.\.\.\(body \? \{)/g,
    getReplacement: () => 'Authorization: ' + bt + 'Bearer ' + '${key}' + bt + ',',
  },
]);

replaceInFile('c:/Users/xiao/Pictures/My-AI-main/js/app.js', [
  {
    regex: /Authorization:\s*`[^\n]*?getAuthToken\(\)\}/g,
    getReplacement: () => 'Authorization: ' + bt + 'Bearer ' + '${await getAuthToken()}' + bt + '',
  },
]);

console.log('Patched authorization headers.');
