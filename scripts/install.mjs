#!/usr/bin/env node
// claude-env: instala o ambiente Claude Code descrito em environment.json.
//
//   node scripts/install.mjs [install]                instala tudo (padrão)
//   node scripts/install.mjs doctor                   compara o manifesto com a máquina
//   node scripts/install.mjs project <perfil> [dir]   liga um perfil num projeto (ex.: ruflo)
//
// Opções:
//   --dry-run          mostra o que seria feito, sem executar nada
//   --only <etapas>    marketplaces,plugins,skills,mcp,settings (separadas por vírgula)
//   --with-cowork      inclui os plugins que normalmente chegam pela conta claude.ai
//
// Respeita CLAUDE_CONFIG_DIR (útil para testar sem tocar no seu ~/.claude).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'environment.json'), 'utf8'));
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CLAUDE_JSON = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
  : path.join(os.homedir(), '.claude.json');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const IS_WIN = process.platform === 'win32';
const STEPS = ['marketplaces', 'plugins', 'skills', 'mcp', 'settings'];
const COPY_IGNORE = new Set(['.git', '__pycache__', '.DS_Store']);
const SELF = `node ${path.join(ROOT, 'scripts', 'install.mjs')}`;

// ---------------------------------------------------------------- saída

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const SYM = IS_WIN ? { ok: '+', fail: 'x', skip: '-' } : { ok: '✔', fail: '✘', skip: '•' };
const problems = [];

const title = (s) => console.log(`\n${paint('1;36', '==>')} ${paint(1, s)}`);
const ok = (s) => console.log(`  ${paint(32, SYM.ok)} ${s}`);
const skip = (s) => console.log(`  ${paint(90, SYM.skip)} ${s}`);
const bad = (s) => {
  problems.push(s);
  console.log(`  ${paint(31, SYM.fail)} ${s}`);
};
const die = (s) => {
  console.error(`${paint(31, 'erro:')} ${s}`);
  process.exit(2);
};

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const opts = { command: 'install', rest: [], dryRun: false, withCowork: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--with-cowork') opts.withCowork = true;
    else if (a === '--only') opts.only = (argv[++i] || '').split(',').filter(Boolean);
    else if (a.startsWith('--only=')) opts.only = a.slice(7).split(',').filter(Boolean);
    else if (a === '-h' || a === '--help') opts.rest.unshift('help');
    else if (a.startsWith('-')) die(`opção desconhecida: ${a} (veja --help)`);
    else opts.rest.push(a);
  }
  if (opts.rest.length) opts.command = opts.rest.shift();
  for (const step of opts.only || []) {
    if (!STEPS.includes(step)) die(`etapa desconhecida em --only: ${step}. Use: ${STEPS.join(', ')}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const want = (step) => !opts.only || opts.only.includes(step);

// ---------------------------------------------------------------- execução de comandos

const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

function exec(cmd, args, { cwd, dry = opts.dryRun } = {}) {
  const line = [cmd, ...args].map(quote).join(' ');
  if (dry) {
    console.log(`    $ ${line}`);
    return { code: 0, out: '', dry: true };
  }
  // No Windows o claude/npx podem ser .cmd, que só resolvem pelo shell.
  const r = IS_WIN
    ? spawnSync(line, { cwd, shell: true, encoding: 'utf8', timeout: 600_000 })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}\n${r.error ? r.error.message : ''}`.trim();
  return { code: r.status ?? 1, out, stdout: r.stdout || '' };
}

const probe = (cmd, args = ['--version']) => exec(cmd, args, { dry: false });
const claude = (args, o) => exec('claude', args, o);

// `--json` de install/add imprime uma linha só; o de list imprime JSON formatado.
function lastJsonLine(out) {
  const line = out.split('\n').reverse().find((l) => l.startsWith('{'));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

function claudeList(args) {
  try {
    return JSON.parse(probe('claude', [...args, '--json']).stdout);
  } catch {
    return [];
  }
}

function report(r, label) {
  if (r.dry) return;
  const json = lastJsonLine(r.out);
  const message = json?.message || r.out.split('\n').filter(Boolean).pop() || '';
  if (r.code === 0) {
    if (/already/i.test(message) || r.already) skip(`${label} (já estava)`);
    else ok(label);
  } else {
    bad(`${label}: ${message || `saiu com código ${r.code}`}`);
  }
}

// ---------------------------------------------------------------- etapas

function preflight() {
  title('Pré-requisitos');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) die(`Node ${process.versions.node} é antigo demais; use 18 ou mais novo.`);
  ok(`node ${process.versions.node}`);
  for (const [cmd, hint] of [
    ['git', 'instale o Git (o bootstrap install.sh / install.ps1 faz isso por você)'],
    ['claude', 'instale o Claude Code: https://claude.com/claude-code'],
  ]) {
    const r = probe(cmd);
    if (r.code !== 0) die(`${cmd} não encontrado: ${hint}`);
    ok(`${cmd} ${r.out.split('\n')[0]}`);
  }
  const py = ['python3', 'python'].map((c) => [c, probe(c)]).find(([, r]) => r.code === 0);
  if (py) ok(`${py[0]} ${py[1].out.split('\n')[0].replace(/^Python /, '')}`);
  else skip('python não encontrado: as skills hunter-* usam scripts Python');
  if (opts.dryRun) skip('modo --dry-run: nada será alterado');
}

function addMarketplaces(list) {
  for (const m of list) {
    report(claude(['plugin', 'marketplace', 'add', m.source, '--json']), `marketplace ${m.name}`);
  }
}

function installPlugins(list, { scope = 'user', cwd } = {}) {
  for (const id of list) {
    report(claude(['plugin', 'install', id, '--scope', scope, '--json'], { cwd }), `plugin ${id}`);
  }
}

function skillNames(pack, src) {
  if (pack.as) return [pack.as];
  if (pack.include) return pack.include;
  return fs.readdirSync(src).filter((d) => fs.existsSync(path.join(src, d, 'SKILL.md')));
}

function installSkills(packs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-env-'));
  try {
    for (const pack of packs) {
      let base = ROOT;
      if (pack.repo) {
        base = path.join(tmp, pack.name);
        const ref = pack.ref ? ['--branch', pack.ref] : [];
        const r = exec('git', ['clone', '--depth', '1', '--quiet', ...ref, pack.repo, base]);
        if (!r.dry && r.code !== 0) {
          bad(`skills ${pack.name}: falha ao clonar ${pack.repo}: ${r.out}`);
          continue;
        }
      }
      const src = path.join(base, pack.path || '.');
      if (opts.dryRun) {
        const names = pack.as || pack.include ? skillNames(pack) : ['(todas)'];
        console.log(`    copiar ${pack.name}: ${names.join(', ')} -> ${SKILLS_DIR}`);
        continue;
      }
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      for (const name of skillNames(pack, src)) {
        const from = pack.as ? src : path.join(src, name);
        if (!fs.existsSync(path.join(from, 'SKILL.md'))) {
          bad(`skill ${name}: SKILL.md não encontrado em ${pack.repo || pack.path}`);
          continue;
        }
        fs.cpSync(from, path.join(SKILLS_DIR, name), {
          recursive: true,
          force: true,
          filter: (p) => !COPY_IGNORE.has(path.basename(p)),
        });
        ok(`skill ${name} ${paint(90, `(${pack.name})`)}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
}

function addMcpServers(list, { scope = 'user', cwd } = {}) {
  for (const s of list) {
    const args = s.url
      ? ['mcp', 'add', '--scope', scope, '--transport', s.transport || 'http', s.name, s.url]
      : ['mcp', 'add', '--scope', scope, s.name, '--', s.command, ...(s.args || [])];
    const r = claude(args, { cwd });
    if (r.code !== 0 && /already exists/i.test(r.out)) Object.assign(r, { code: 0, already: true });
    report(r, `mcp ${s.name} (${scope})`);
  }
}

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    target[k] = isObject(v) && isObject(target[k]) ? deepMerge(target[k], v) : structuredClone(v);
  }
  return target;
}

function applySettings() {
  const file = path.join(CLAUDE_DIR, 'settings.json');
  const current = readJson(file) || {};
  const merged = deepMerge(structuredClone(current), MANIFEST.settings || {});
  if (JSON.stringify(merged) === JSON.stringify(current)) return skip('settings.json (já estava)');
  const changed = Object.keys(MANIFEST.settings).filter(
    (k) => JSON.stringify(merged[k]) !== JSON.stringify(current[k]),
  );
  if (opts.dryRun) return console.log(`    atualizar settings.json: ${changed.join(', ')}`);
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${stamp()}`);
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  ok(`settings.json: ${changed.join(', ')} ${paint(90, '(backup .bak criado)')}`);
}

const normalize = (s) => s.replace(/\r\n/g, '\n').trim();

function claudeMdBlock() {
  return MANIFEST.claudeMd ? normalize(fs.readFileSync(path.join(ROOT, MANIFEST.claudeMd), 'utf8')) : '';
}

function applyClaudeMd() {
  const block = claudeMdBlock();
  if (!block) return;
  const file = path.join(CLAUDE_DIR, 'CLAUDE.md');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (normalize(current).includes(block)) return skip('CLAUDE.md global (já estava)');
  if (opts.dryRun) return console.log(`    acrescentar ${MANIFEST.claudeMd} ao fim de ${file}`);
  const glue = current.trim() ? `${current.replace(/\s*$/, '')}\n\n` : '';
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(file, `${glue}${block}\n`);
  ok('CLAUDE.md global');
}

// ---------------------------------------------------------------- comandos

function install() {
  preflight();
  const extras = opts.withCowork ? MANIFEST.extras.cowork : { marketplaces: [], plugins: [] };
  if (want('marketplaces')) {
    title('Marketplaces');
    addMarketplaces([...MANIFEST.marketplaces, ...extras.marketplaces]);
  }
  if (want('plugins')) {
    title('Plugins (escopo de usuário)');
    installPlugins([...MANIFEST.plugins, ...extras.plugins]);
  }
  if (want('skills')) {
    title(`Skills em ${SKILLS_DIR}`);
    installSkills(MANIFEST.skills);
  }
  if (want('mcp') && MANIFEST.mcpServers.length) {
    title('MCP servers (escopo de usuário)');
    addMcpServers(MANIFEST.mcpServers);
  }
  if (want('settings')) {
    title('Configurações');
    applySettings();
    applyClaudeMd();
  }
  finish(() => {
    console.log(`
Próximos passos:
  1. Abra o Claude (${paint(1, 'claude')}) e faça /login com a sua conta claude.ai.
     Isso também traz os plugins, skills e conectores que ficam na conta.
  2. GitHub MCP: exporte GITHUB_PERSONAL_ACCESS_TOKEN (README > Pós-instalação).
  3. Figma: dentro do Claude, /mcp > figma > Authenticate.
  4. Ruflo num projeto: cd <projeto> && ${SELF} project ruflo
  5. Conferir tudo: ${SELF} doctor`);
  });
}

function project() {
  const [name, dir = process.cwd()] = opts.rest;
  const profiles = MANIFEST.projectProfiles || {};
  if (!name || !profiles[name]) {
    die(`informe um perfil: ${Object.keys(profiles).join(', ')} (ex.: project ruflo ./meu-projeto)`);
  }
  const cwd = path.resolve(dir);
  if (!fs.existsSync(cwd)) die(`diretório não existe: ${cwd}`);
  title(`Perfil "${name}" em ${cwd}`);
  installPlugins(profiles[name].plugins || [], { scope: 'project', cwd });
  addMcpServers(profiles[name].mcpServers || [], { scope: 'local', cwd });
  finish();
}

function doctor() {
  const check = (cond, label, hint = '') => (cond ? ok(label) : bad(hint ? `${label}: ${hint}` : label));
  const extras = opts.withCowork ? MANIFEST.extras.cowork : { marketplaces: [], plugins: [] };

  title('Pré-requisitos');
  ok(`node ${process.versions.node}`);
  for (const cmd of ['git', 'claude']) {
    const r = probe(cmd);
    check(r.code === 0, `${cmd} ${r.code === 0 ? r.out.split('\n')[0] : ''}`.trim(), 'não encontrado');
  }
  const py = ['python3', 'python'].find((c) => probe(c).code === 0);
  py ? ok(py) : skip('python não encontrado (usado pelas skills hunter-*)');

  title('Marketplaces');
  const markets = new Set(claudeList(['plugin', 'marketplace', 'list']).map((m) => m.name));
  for (const m of [...MANIFEST.marketplaces, ...extras.marketplaces]) check(markets.has(m.name), m.name, 'faltando');

  title('Plugins (escopo de usuário)');
  const userPlugins = new Map(claudeList(['plugin', 'list']).filter((p) => p.scope === 'user').map((p) => [p.id, p]));
  for (const id of [...MANIFEST.plugins, ...extras.plugins]) {
    const p = userPlugins.get(id);
    check(p?.enabled, id, p ? 'instalado mas desativado' : 'faltando');
  }

  title('Skills');
  const expectedSkills = MANIFEST.skills.flatMap((pack) => (pack.as ? [pack.as] : pack.include || []));
  for (const name of expectedSkills) check(fs.existsSync(path.join(SKILLS_DIR, name, 'SKILL.md')), name, 'faltando');

  if (MANIFEST.mcpServers.length) {
    title('MCP servers (escopo de usuário)');
    const servers = readJson(CLAUDE_JSON)?.mcpServers || {};
    for (const s of MANIFEST.mcpServers) check(servers[s.name], s.name, 'faltando');
  }

  title('Configurações');
  const settings = readJson(path.join(CLAUDE_DIR, 'settings.json')) || {};
  for (const [k, v] of Object.entries(MANIFEST.settings || {})) {
    const merged = isObject(v) && isObject(settings[k]) ? deepMerge(structuredClone(settings[k]), v) : v;
    check(JSON.stringify(settings[k]) === JSON.stringify(merged), `settings.${k}`, 'diferente do manifesto');
  }
  const md = path.join(CLAUDE_DIR, 'CLAUDE.md');
  check(fs.existsSync(md) && normalize(fs.readFileSync(md, 'utf8')).includes(claudeMdBlock()), 'CLAUDE.md global', 'bloco ausente');

  title('Tokens e autenticação');
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) ok('GITHUB_PERSONAL_ACCESS_TOKEN definido');
  else skip('GITHUB_PERSONAL_ACCESS_TOKEN não definido: o MCP do plugin github não conecta sem ele');

  title('Instalado aqui, mas fora do manifesto');
  const knownPlugins = new Set([...MANIFEST.plugins, ...MANIFEST.extras.cowork.plugins]);
  const knownMarkets = new Set([...MANIFEST.marketplaces, ...MANIFEST.extras.cowork.marketplaces].map((m) => m.name));
  const knownSkills = new Set(expectedSkills);
  const stray = [
    ...[...markets].filter((n) => !knownMarkets.has(n)).map((n) => `marketplace ${n}`),
    ...[...userPlugins.keys()].filter((id) => !knownPlugins.has(id)).map((id) => `plugin ${id}`),
    ...(fs.existsSync(SKILLS_DIR) ? fs.readdirSync(SKILLS_DIR) : [])
      .filter((d) => !knownSkills.has(d) && fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')))
      .map((d) => `skill ${d}`),
  ];
  if (stray.length) stray.forEach((s) => skip(`${s} (adicione ao environment.json para levar junto)`));
  else ok('nada: o manifesto cobre tudo o que está instalado');

  finish();
}

function finish(nextSteps) {
  console.log();
  if (problems.length) {
    console.log(paint(31, `${problems.length} problema(s):`));
    problems.forEach((p) => console.log(`  - ${p}`));
    process.exitCode = 1;
  } else {
    console.log(paint(32, opts.dryRun ? 'Simulação concluída.' : 'Tudo certo.'));
  }
  nextSteps?.();
}

function help() {
  const header = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(header.slice(1, header.findIndex((l) => l.startsWith('import'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim());
}

const commands = { install, doctor, project, help };
if (!commands[opts.command]) die(`comando desconhecido: ${opts.command} (use install, doctor, project ou --help)`);
commands[opts.command]();
