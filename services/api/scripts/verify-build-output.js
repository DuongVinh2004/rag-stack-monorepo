const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const requiredFiles = [
  path.join(distDir, 'main.js'),
  path.join(distDir, 'app.module.js'),
  path.join(distDir, 'prisma', 'prisma.module.js'),
  path.join(distDir, 'documents', 'documents.service.js'),
  path.join(distDir, 'chat', 'chat.service.js'),
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required build artifact: ${path.relative(path.join(__dirname, '..'), file)}`);
  }
}

const specArtifacts = [];
const stack = [distDir];

while (stack.length > 0) {
  const current = stack.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      stack.push(fullPath);
      continue;
    }
    if (/\.spec\.(js|d\.ts|js\.map)$/.test(entry.name)) {
      specArtifacts.push(path.relative(path.join(__dirname, '..'), fullPath));
    }
  }
}

if (specArtifacts.length > 0) {
  throw new Error(`Build output contains test artifacts: ${specArtifacts.join(', ')}`);
}

console.log('Build output verified.');
