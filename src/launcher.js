'use strict';
// Startet den Server als Kindprozess und startet ihn neu, wenn er das verlangt
// (Exit-Code 75, z. B. nach «Update» oder «Neustart» in der Verwaltung).
// So überlebt der Neustart auch ohne Dienst-Verwaltung (start.cmd / start.sh).
const { fork } = require('node:child_process');
const path = require('node:path');

const RESTART_CODE = 75;
let child = null;
let stopping = false;

function start() {
  child = fork(path.join(__dirname, 'server.js'), process.argv.slice(2), {
    env: { ...process.env, KKB_LAUNCHER: '1' },
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (!stopping && code === RESTART_CODE) {
      console.log('Neustart …');
      setTimeout(start, 500);
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function stop() {
  stopping = true;
  if (child && child.exitCode === null) child.kill('SIGTERM');
  else process.exit(0);
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

start();
