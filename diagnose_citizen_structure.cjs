const fs = require('fs');

let acorn;
try {
  acorn = require('acorn');
} catch (e) {
  console.error('acorn 없음. 실행: npm i -D acorn');
  process.exit(1);
}

const file = process.argv[2] || 'citizen.cjs';

if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');

let ast;
try {
  ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowHashBang: true,
    locations: true
  });
} catch (e) {
  console.error('PARSE FAILED:', e.message);
  process.exit(1);
}

function walk(node, cb, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent);

  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const child of v) {
        if (child && typeof child.type === 'string') walk(child, cb, node);
      }
    } else if (v && typeof v.type === 'string') {
      walk(v, cb, node);
    }
  }
}

function code(node, max = 220) {
  return src.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, max);
}

function loc(node) {
  return `${node.loc.start.line}:${node.loc.start.column}`;
}

function print(title, rows) {
  console.log('\n=== ' + title + ' ===');
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  for (const r of rows) console.log(r);
}

const named = [];
const exportsRows = [];
const createBotRows = [];
const registryRows = [];
const routeRows = [];
const assignmentRows = [];

const names = new Set(['createCitizen', 'thinkAndAct', 'reactToChat', 'liveLoop']);

walk(ast, (node, parent) => {
  if (node.type === 'FunctionDeclaration' && node.id && names.has(node.id.name)) {
    named.push(`${node.id.name} :: FunctionDeclaration @ ${loc(node)} :: ${code(node)}`);
  }

  if (node.type === 'VariableDeclarator' && node.id && names.has(node.id.name)) {
    named.push(`${node.id.name} :: VariableDeclarator @ ${loc(node)} :: ${code(node)}`);
  }

  if (node.type === 'AssignmentExpression') {
    const left = src.slice(node.left.start, node.left.end);
    const right = src.slice(node.right.start, Math.min(node.right.end, node.right.start + 180)).replace(/\s+/g, ' ');

    if (
      left === 'module.exports' ||
      left.startsWith('module.exports.') ||
      left.startsWith('exports.')
    ) {
      exportsRows.push(`${left} @ ${loc(node)} = ${right}`);
    }

    for (const n of names) {
      if (left === n || left.endsWith('.' + n) || left.includes(n)) {
        assignmentRows.push(`${left} @ ${loc(node)} = ${right}`);
      }
    }

    if (left.includes('__ADAM_CITIZENS__')) {
      registryRows.push(`${left} @ ${loc(node)} = ${right}`);
    }
  }

  if (node.type === 'CallExpression') {
    const callee = src.slice(node.callee.start, node.callee.end);

    if (callee.includes('createBot')) {
      createBotRows.push(`${callee} @ ${loc(node)} :: ${code(node, 260)}`);
    }

    const full = code(node, 260);
    if (
      full.includes('reactToChat') ||
      full.includes('thinkAndAct') ||
      full.includes('AdamPiano') ||
      full.includes('__pianoRuntime')
    ) {
      routeRows.push(`Call @ ${loc(node)} :: ${full}`);
    }
  }
});

console.log('FILE:', file);
console.log('SIZE:', src.length, 'chars');

print('NAMED DECLARATIONS / VARIABLES', named);
print('ASSIGNMENTS TOUCHING TARGET NAMES', assignmentRows);
print('MODULE EXPORTS', exportsRows);
print('MINEFLAYER CREATE BOT CALLS', createBotRows);
print('ADAM CITIZEN REGISTRY', registryRows);
print('LOOP / THINK / PIANO ROUTE CALLS', routeRows);

console.log('\n=== RAW GREP HINT ===');
const lines = src.split(/\r?\n/);
const re = /createCitizen|thinkAndAct|reactToChat|liveLoop|module\.exports|exports\.|mineflayer\.createBot|__ADAM_CITIZENS__|__pianoRuntime|AdamPiano/g;
for (let i = 0; i < lines.length; i++) {
  if (re.test(lines[i])) {
    console.log(String(i + 1).padStart(5, ' ') + ': ' + lines[i].slice(0, 220));
  }
  re.lastIndex = 0;
}
