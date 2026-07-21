#!/usr/bin/env node
const { initConfig } = require('./config.cjs');

const name = String(process.argv[2] || 'Adam').replace(/[^\w.-]/g, '_');
const overwrite = process.argv.includes('--overwrite');
const file = 'piano_config_' + name + '.json';

const result = initConfig(file, { overwrite });
console.log(result.created ? 'created ' + file : 'exists ' + file + ' (use --overwrite to replace)');
