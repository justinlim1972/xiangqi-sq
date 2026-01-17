// Simple deployment helper
// Install Node.js from https://nodejs.org/ first
// Then run: node simple-deploy.js

const { execSync } = require('child_process');

console.log('Installing Firebase Tools...');
execSync('npm install -g firebase-tools', { stdio: 'inherit' });

console.log('\nLogging in to Firebase...');
execSync('firebase login', { stdio: 'inherit' });

console.log('\nDeploying to Firebase Hosting...');
execSync('firebase deploy --only hosting', { stdio: 'inherit', cwd: __dirname });

console.log('\n✅ Deployment complete!');
