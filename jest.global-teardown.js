const fs = require('fs');
const path = require('path');
const { stopServer } = require('./scripts/start-css-server');

const STATE_FILE = path.join(__dirname, '.jest-solid-server-state.json');

module.exports = async () => {
  if (!fs.existsSync(STATE_FILE)) {
    return;
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (!state.managed || !state.pid) {
    fs.unlinkSync(STATE_FILE);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`🛑 Stopping Community Solid Server (pid ${state.pid}) after tests.`);

  await stopServer(state.pid);

  fs.unlinkSync(STATE_FILE);
};

