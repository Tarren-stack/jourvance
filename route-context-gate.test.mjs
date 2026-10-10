// Route context gate. server.mjs builds a context object per route module (const emailCtx = {...};
// setupEmailRoutes(app, emailCtx)) and each module in server/routes/*.mjs destructures what it
// needs. A function that lives in server.mjs but was never put on the context, or was put on it
// and never destructured, is not an error until the request that calls it: a ReferenceError inside
// an async handler, which Express 4 does not answer, so the request HANGS. That shipped three
// times (noteAttrMap, loadBehaviorBag, predictionAccount). This gate finds the whole class
// statically, with a real parser (acorn, a devDependency of this spoke) and its own scope tracker.
//
// Per route module that reads a context it asserts:
//   (a) no free identifier: every name used is declared in the module, imported, a JS or Node
//       global, or destructured from the context;
//   (b) every name taken from the context (destructure, `ctx.x`, `getCtx().x`, a destructured
//       setup parameter) is a key of the matching context literal in server.mjs;
//   (c) every shorthand key of that literal is declared at module scope in server.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

// Allowlist of free names that are legitimately not declared. Expected to stay empty.
const ALLOWED_FREE = new Set([]);

// Names a route module takes from ctx that server.mjs deliberately does not pass, each with the
// fallback the module uses when it is absent. Only tests pass these. Any OTHER name a module takes
// from ctx and server.mjs does not pass fails the gate, and an entry here that the gate no longer
// meets fails too (the last test), so this list cannot hide a new miss or outlive its reason.
const CTX_DEFAULTED = new Map([
  ['server/routes/journeyRoutes.mjs:now', 'destructured as `now = () => Date.now()`; tests hand in a fixed clock'],
  ['server/routes/analyticsRoutes.mjs:eventsKept', 'read as `Number(eventsKept) > 0 ? Number(eventsKept) : 20000` where the stats route uses it; tests hand in a small number']
]);
const defaultedSeen = new Set();

const GLOBALS = new Set(`console process Buffer URL URLSearchParams fetch setTimeout clearTimeout setInterval
clearInterval setImmediate clearImmediate JSON Math Date Promise Object Array Number String Map Set Error
TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError RegExp encodeURIComponent
decodeURIComponent encodeURI decodeURI parseInt parseFloat isFinite isNaN Intl structuredClone queueMicrotask
AbortController AbortSignal TextEncoder TextDecoder globalThis undefined NaN Infinity arguments Symbol Reflect
Proxy WeakMap WeakSet WeakRef BigInt Boolean Function Atomics SharedArrayBuffer ArrayBuffer Uint8Array
Uint8ClampedArray Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array BigInt64Array
BigUint64Array DataView escape unescape require module exports __dirname __filename Headers Request Response
FormData Blob performance global eval`.split(/\s+/));

function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
}

// ---- scope tracker ----
class Scope {
  constructor(parent) { this.parent = parent; this.names = new Set(); }
  has(n) { return !!this.owner(n); }
  owner(n) { for (let s = this; s; s = s.parent) if (s.names.has(n)) return s; return null; }
}
function patternNames(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': for (const q of p.properties) patternNames(q.type === 'RestElement' ? q.argument : q.value, out); break;
    case 'ArrayPattern': for (const q of p.elements) patternNames(q, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
  }
  return out;
}
// var declarations and function declarations hoist to the enclosing function scope.
function hoistVars(node, scope, top = true) {
  if (!node || typeof node.type !== 'string') return;
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind === 'var') for (const d of node.declarations) patternNames(d.id).forEach((n) => scope.names.add(n));
      break;
    case 'FunctionDeclaration':
      return;
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassDeclaration': case 'ClassExpression':
      return;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && hoistVars(c, scope, false));
    else if (v && typeof v.type === 'string') hoistVars(v, scope, false);
  }
}
// let, const, class and function declarations directly inside a statement list.
function declareBlock(stmts, scope) {
  for (const s of stmts) {
    let d = s;
    if ((s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') && s.declaration) d = s.declaration;
    if (d.type === 'VariableDeclaration' && d.kind !== 'var') for (const x of d.declarations) patternNames(x.id).forEach((n) => scope.names.add(n));
    else if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) scope.names.add(d.id.name);
    else if (d.type === 'ImportDeclaration') for (const sp of d.specifiers) scope.names.add(sp.local.name);
  }
}
function programScope(ast) {
  const scope = new Scope(null);
  hoistVars(ast, scope);
  declareBlock(ast.body, scope);
  return scope;
}

// Walks `ast`; calls onRef(name, loc, node) for each identifier reference with its scope.
function walkRefs(ast, onRef, onNode) {
  const top = programScope(ast);
  function pattern(p, scope) { // visit defaults and computed keys of a binding pattern, not the bindings
    if (!p) return;
    switch (p.type) {
      case 'ObjectPattern': for (const q of p.properties) {
        if (q.type === 'RestElement') { pattern(q.argument, scope); continue; }
        if (q.computed) visit(q.key, scope);
        pattern(q.value, scope);
      } break;
      case 'ArrayPattern': p.elements.forEach((e) => pattern(e, scope)); break;
      case 'RestElement': pattern(p.argument, scope); break;
      case 'AssignmentPattern': pattern(p.left, scope); visit(p.right, scope); break;
      case 'MemberExpression': visit(p, scope); break; // assignment targets like a.b
    }
  }
  function fn(node, scope) {
    const s = new Scope(scope);
    if (node.type === 'FunctionExpression' && node.id) s.names.add(node.id.name);
    s.names.add('arguments');
    if (node.ctxParam) s.ctxParam = node.ctxParam;
    node.params.forEach((p) => patternNames(p).forEach((n) => s.names.add(n)));
    if (node.body.type === 'BlockStatement') {
      hoistVars(node.body, s);
      declareBlock(node.body.body, s);
    }
    node.params.forEach((p) => pattern(p, s));
    if (node.body.type === 'BlockStatement') node.body.body.forEach((c) => visit(c, s));
    else visit(node.body, s);
  }
  function visit(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    if (onNode) onNode(node, scope);
    switch (node.type) {
      case 'Identifier': onRef(node.name, node.loc.start.line, node, scope); return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': fn(node, scope); return;
      case 'BlockStatement': case 'StaticBlock': {
        const s = new Scope(scope); declareBlock(node.body, s); node.body.forEach((c) => visit(c, s)); return;
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const s = new Scope(scope);
        const head = node.type === 'ForStatement' ? node.init : node.left;
        if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') head.declarations.forEach((d) => patternNames(d.id).forEach((n) => s.names.add(n)));
        for (const k of ['init', 'test', 'update', 'left', 'right', 'body']) {
          const c = node[k];
          if (!c) continue;
          if (c.type === 'VariableDeclaration') visit(c, s);
          else if (k === 'left' && !(c.type === 'MemberExpression')) pattern(c, s);
          else visit(c, s);
        }
        return;
      }
      case 'SwitchStatement': {
        visit(node.discriminant, scope);
        const s = new Scope(scope);
        node.cases.forEach((c) => declareBlock(c.consequent, s));
        node.cases.forEach((c) => { visit(c.test, s); c.consequent.forEach((x) => visit(x, s)); });
        return;
      }
      case 'CatchClause': {
        const s = new Scope(scope);
        if (node.param) patternNames(node.param).forEach((n) => s.names.add(n));
        if (node.param) pattern(node.param, s);
        visit(node.body, s);
        return;
      }
      case 'ClassDeclaration': case 'ClassExpression': {
        const s = new Scope(scope);
        if (node.id) s.names.add(node.id.name);
        visit(node.superClass, s);
        node.body.body.forEach((m) => visit(m, s));
        return;
      }
      case 'MethodDefinition': case 'PropertyDefinition':
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope);
        return;
      case 'VariableDeclaration':
        // Each declarator is shown to onNode too: `const { a } = ctx` is a VariableDeclarator, and
        // without this the destructure check below never saw one (open list, 2026-10-09).
        for (const d of node.declarations) { if (onNode) onNode(d, scope); pattern(d.id, scope); visit(d.init, scope); }
        return;
      case 'MemberExpression':
        visit(node.object, scope);
        if (node.computed) visit(node.property, scope);
        return;
      case 'Property':
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope);
        return;
      case 'LabeledStatement': visit(node.body, scope); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'ImportDeclaration': case 'ExportAllDeclaration': return;
      case 'ExportSpecifier': visit(node.local, scope); return;
      case 'ExportNamedDeclaration':
        if (node.declaration) visit(node.declaration, scope);
        else node.specifiers.forEach((sp) => visit(sp, scope));
        return;
      case 'MetaProperty': return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && visit(c, scope));
      else if (v && typeof v.type === 'string') visit(v, scope);
    }
  }
  top && ast.body.forEach((n) => visit(n, top));
  return top;
}

// ---- server.mjs: context literals ----
function objectKeys(obj) {
  const keys = []; // { key, shorthand }
  for (const p of obj.properties) {
    if (p.type !== 'Property') continue;
    const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
    keys.push({ key, shorthand: p.shorthand, line: p.loc.start.line });
  }
  return keys;
}
function serverContexts(serverAst) {
  const lits = new Map(); // const name -> ObjectExpression
  for (const s of serverAst.body) {
    if (s.type !== 'VariableDeclaration') continue;
    for (const d of s.declarations) if (d.id.type === 'Identifier' && d.init && d.init.type === 'ObjectExpression') lits.set(d.id.name, d.init);
  }
  const bySetup = new Map(); // setupFn -> { label, keys }
  for (const s of serverAst.body) {
    const call = s.type === 'ExpressionStatement' ? s.expression
      : s.type === 'VariableDeclaration' ? s.declarations[0]?.init : null;
    if (!call || call.type !== 'CallExpression' || call.callee.type !== 'Identifier') continue;
    if (!/^setup\w+Routes$/.test(call.callee.name)) continue;
    const arg = call.arguments[1];
    let lit = null, label = call.callee.name;
    if (arg && arg.type === 'ObjectExpression') lit = arg;
    else if (arg && arg.type === 'Identifier' && lits.has(arg.name)) { lit = lits.get(arg.name); label = `${call.callee.name}(${arg.name})`; }
    if (lit) bySetup.set(call.callee.name, { label, keys: objectKeys(lit) });
  }
  return bySetup;
}

// ---- route modules ----
// Returns { free: [{name,line}], ctxNames: [{name,line}], setups: [fnName] } for a route module.
function analyseModule(file) {
  const ast = parse(file);
  const free = [];
  const ctxNames = [];
  const setups = [];
  // The context parameter of each setupXRoutes, and getCtx-style accessors.
  const ctxParams = new Set();
  for (const s of ast.body) {
    const d = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
    if (d && d.type === 'FunctionDeclaration' && /^setup\w+Routes$/.test(d.id.name)) {
      setups.push(d.id.name);
      const p = d.params[1];
      if (p && p.type === 'Identifier') { ctxParams.add(p.name); d.ctxParam = p.name; }
      if (p && p.type === 'ObjectPattern') for (const q of p.properties) if (q.type === 'Property') ctxNames.push({ name: q.key.name, line: q.loc.start.line });
    }
  }
  const ctxAccessors = new Set(['getCtx', 'getPublicContext']);
  walkRefs(ast, (name, line, node, scope) => {
    if (!scope.has(name) && !GLOBALS.has(name) && !ALLOWED_FREE.has(name)) free.push({ name, line });
  }, (node, scope) => {
    // const { a, b = 1 } = ctx
    const isCtx = (id) => id.type === 'Identifier' && ctxParams.has(id.name) && scope.owner(id.name)?.ctxParam === id.name;
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init
      && ((isCtx(node.init))
        || (node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier' && ctxAccessors.has(node.init.callee.name)))) {
      for (const q of node.id.properties) if (q.type === 'Property' && !q.computed) ctxNames.push({ name: q.key.name, line: q.loc.start.line });
    }
    // ctx.x, getCtx().x
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      const o = node.object;
      if ((isCtx(o))
        || (o.type === 'CallExpression' && o.callee.type === 'Identifier' && ctxAccessors.has(o.callee.name))) {
        ctxNames.push({ name: node.property.name, line: node.loc.start.line });
      }
    }
  });
  return { free, ctxNames, setups, uses: ctxParams.size > 0 || ctxNames.length > 0 };
}

function problems() {
  const out = [];
  const serverAst = parse('server.mjs');
  const serverScope = programScope(serverAst);
  const contexts = serverContexts(serverAst);
  const dir = 'server/routes';
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
    const file = path.join(dir, f);
    if (!/= ctx\b/.test(fs.readFileSync(file, 'utf8')) && !/\bctx\./.test(fs.readFileSync(file, 'utf8'))
      && !/getCtx\(\)/.test(fs.readFileSync(file, 'utf8')) && !/setup\w+Routes\(app, \{/.test(fs.readFileSync(file, 'utf8'))) continue;
    const info = analyseModule(file);
    const ctxLit = info.setups.map((s) => contexts.get(s)).find(Boolean);
    const passed = new Set(ctxLit ? ctxLit.keys.map((k) => k.key) : []);
    const taken = new Set(info.ctxNames.map((n) => n.name));
    for (const { name, line } of info.free) {
      if (passed.has(name)) out.push(`${file}:${line}: ${name} is in ctx but never destructured`);
      else if (serverScope.has(name)) out.push(`${file}:${line}: ${name} is called but not passed through ctx (it lives in server.mjs)`);
      else out.push(`${file}:${line}: ${name} is used but declared nowhere`);
    }
    if (info.setups.length && !ctxLit && info.uses) out.push(`${file}: no setup call with a context literal found in server.mjs for ${info.setups.join(', ')}`);
    for (const { name, line } of info.ctxNames) {
      if (ctxLit && !passed.has(name) && CTX_DEFAULTED.has(`${file}:${name}`)) { defaultedSeen.add(`${file}:${name}`); continue; }
      if (ctxLit && !passed.has(name)) out.push(`${file}:${line}: ${name} is destructured from ctx but server.mjs does not pass it (${contexts.get(info.setups[0])?.label})`);
    }
    void taken;
  }
  for (const [setup, { label, keys }] of contexts) {
    for (const k of keys) {
      if (k.shorthand && !serverScope.has(k.key)) out.push(`server.mjs:${k.line}: ${k.key} is passed in ${label} but declared nowhere at module scope`);
    }
  }
  return [...new Set(out)];
}

test('acorn is available for the gate', () => {
  assert.equal(typeof acorn.parse, 'function');
  assert.match(acorn.version, /^8\./);
});

test('every route module context is complete: nothing called but not passed, nothing passed but not declared', () => {
  const found = problems();
  assert.deepEqual(found, [], `\n${found.join('\n')}\n`);
});

test('the scope tracker itself: a planted free name is found, locals are not', () => {
  const src = `import fs from 'node:fs'; const top = 1;
export function setupXRoutes(app, ctx) {
  const { a, b = 2 } = ctx;
  function local(p, { q }) { var v = p; let w = q; return v + w + top + fs + a + b; }
  app.get('/x', async (req, res) => { try { local(1, {}); missingOne(); } catch (err) { res.send(String(err) + Math.max(1)); } });
  for (const [k, v] of Object.entries({})) { void k; void v; }
  return { shorthand: ctx.c, missingTwo };
}`;
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const free = [];
  walkRefs(ast, (n, line, node, scope) => { if (!scope.has(n) && !GLOBALS.has(n)) free.push(n); });
  assert.deepEqual(free.sort(), ['missingOne', 'missingTwo']);
});

test('a name destructured from ctx (`const { ... } = ctx`) is collected, so one server.mjs never passes is found', () => {
  // The walker never showed a VariableDeclarator to onNode, so this destructure was never read and a
  // name missing from a ctx literal stayed green (planted with starterFlowOnFor out of shopifyCtx).
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'ctx-gate-'));
  const file = path.join(dir, 'probe.mjs');
  fs.writeFileSync(file, `export function setupProbeRoutes(app, ctx) {
  const { requireUser, notPassed, withDefault = () => 1 } = ctx;
  app.get('/p', requireUser, (req, res) => res.json({ a: notPassed(), b: withDefault() }));
}
`);
  try {
    const names = analyseModule(file).ctxNames.map((n) => n.name).sort();
    assert.deepEqual(names, ['notPassed', 'requireUser', 'withDefault']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every name allowed to fall back to its own default is still one a module takes from ctx and server.mjs does not pass', () => {
  defaultedSeen.clear();
  assert.deepEqual(problems(), []);
  const stale = [...CTX_DEFAULTED.keys()].filter((key) => !defaultedSeen.has(key));
  assert.deepEqual(stale, [], `allowlisted but no longer met, so take them out of CTX_DEFAULTED: ${stale.join(', ')}`);
});
