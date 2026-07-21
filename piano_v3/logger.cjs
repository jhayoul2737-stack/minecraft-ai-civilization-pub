const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class PianoLogger {
  constructor(name, config) {
    this.name = String(name || 'Adam').replace(/[^\w.-]/g, '_');
    this.config = config || {};
    this.level = this.config.level || 'info';
    this.console = this.config.console !== false;
    this.dir = this.config.dir || 'logs';
    this.file = path.join(this.dir, 'piano_' + this.name + '.jsonl');
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch {}
  }

  enabled(level) {
    return (LEVELS[level] || 20) >= (LEVELS[this.level] || 20);
  }

  log(level, event, data) {
    if (!this.enabled(level)) return;
    const row = {
      at: new Date().toISOString(),
      level,
      bot: this.name,
      event,
      data: data || {}
    };

    try {
      fs.appendFileSync(this.file, JSON.stringify(row) + '\n');
    } catch (e) {
      console.warn('piano logger append failed:', e.message);
    }

    if (this.console) {
      const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'debug' ? '🔎' : '🎼';
      const msg = prefix + ' [PIANO V3] ' + event;
      if (level === 'error') console.error(msg, data || '');
      else if (level === 'warn') console.warn(msg, data || '');
      else console.log(msg, data || '');
    }
  }

  debug(event, data) { this.log('debug', event, data); }
  info(event, data) { this.log('info', event, data); }
  warn(event, data) { this.log('warn', event, data); }
  error(event, data) { this.log('error', event, data); }
}

module.exports = { PianoLogger };
