const path = require('path');

const name = 'app';

module.exports = [
  {
    name,
    cwd: __dirname,
    script: path.resolve(__dirname, 'dist/main.js'),
    instances: "max",
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '512M',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 5000,
    wait_ready: false,
    combine_logs: true,
    merge_logs: true,
    out_file: '/logs/out.log',
    error_file: '/logs/error.log',
    env: {
      NODE_ENV: 'production',
    },
  },
];
