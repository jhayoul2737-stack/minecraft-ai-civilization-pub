#!/usr/bin/env node
'use strict';

const fs = require('fs');

const file = process.argv[2] || 'citizen.cjs';
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const patterns = [
  ['openai/client init', /new\s+OpenAI|openai\s*=|openaiClient\s*=|llmClient\s*=|aiClient\s*=|client\s*=/i],
  ['createCitizen export/definition', /module\.exports\.createCitizen|exports\.createCitizen|createCitizen\s*=/],
  ['liveLoop', /function\s+liveLoop|liveLoop\s*=\s*async|liveLoop\s*=\s*function|liveLoop\s*\(/],
  ['thinkAndAct/reactToChat', /thinkAndAct|reactToChat/],
  ['action executors', /performBuiltinAction|executeDecision|executeAction|executeActions|runBuiltinAction|runAction/],
  ['memory funcs', /addMemory|retrieveMemories|retrieveMemory|searchMemories|remember|storeMemory/],
  ['piano v36 markers', /__ADAM_PIANO_V36|__adamPianoGetDepsV36|liveLoop-hook-v36|citizen-export-v36/],
];

const printed = new Set();

function printWindow(label, idx, radius) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(lines.length - 1, idx + radius);
  const key = start + ':' + end;
  if (printed.has(key)) return;
  printed.add(key);

  console.log('\n===== ' + label + ' around line ' + (idx + 1) + ' =====');
  for (let i = start; i <= end; i++) {
    console.log(String(i + 1).padStart(5, ' ') + ' | ' + lines[i]);
  }
}

for (const [label, re] of patterns) {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      printWindow(label, i, 25);
      count++;
      if (count >= 8) break;
    }
  }
  if (count === 0) {
    console.log('\n===== ' + label + ' =====');
    console.log('(no matches)');
  }
}
