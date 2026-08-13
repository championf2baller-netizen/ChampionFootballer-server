const fs = require('fs');

const code = fs.readFileSync('c:/Users/tech solutionor/Desktop/latest work on champion/championfootballer-client/championfootballerserver/src/controllers/matchController.full.ts', 'utf8');
const lines = code.split('\n');

let stack = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '{') {
      stack.push({ line: i + 1, text: line.trim() });
    } else if (char === '}') {
      if (stack.length > 0) stack.pop();
    }
  }
}

console.log('Unclosed braces stack:');
stack.forEach(s => console.log(`Line ${s.line}: ${s.text}`));
