module.exports = {
  apps: [{
    name: 'taki-bot',
    script: 'bot.js',
    cwd: '/Users/nasser/Desktop/TAKI/server',
    env_file: '/Users/nasser/Desktop/TAKI/server/.env',
    watch: false,
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 20,
    min_uptime: '10s',
    log_file: '/Users/nasser/Desktop/TAKI/server/bot.log',
    error_file: '/Users/nasser/Desktop/TAKI/server/bot-error.log',
    time: true
  }]
};
