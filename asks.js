// Lo que una sesion te pide (permiso para una herramienta, una pregunta o aprobar un plan), contado para el notch,
// y la respuesta que espera Claude Code en el hook PermissionRequest.
const { createHash } = require('crypto');

// Huella de una llamada a herramienta, sin las respuestas que se le anaden despues (AskUserQuestion).
const fingerprint = (tool, input) => {
  const { answers, ...rest } = input || {};
  return createHash('md5').update(`${tool}|${JSON.stringify(rest)}`).digest('hex');
};

const short = (s, n = 600) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function summarize(tool, input = {}, suggestions = []) {
  const t = String(tool || '').replace(/^mcp__.+?__/, '');
  if (tool === 'AskUserQuestion') {
    const questions = (input.questions || []).slice(0, 4).map(q => ({
      question: short(q.question, 300), header: short(q.header, 40), multiSelect: !!q.multiSelect,
      options: (q.options || []).slice(0, 6).map(o => ({ label: short(o.label, 80), description: short(o.description, 200) })),
    }));
    return { kind: 'question', titleKey: questions.length > 1 ? 'asks_questions' : 'asks_question', questions };
  }
  if (tool === 'ExitPlanMode') return { kind: 'plan', titleKey: 'wants_plan_approval', detail: short(input.plan, 3000) };
  const what = /^(Bash|PowerShell)$/.test(t) ? ['run_command', input.command]
    : /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(t) ? ['edit_file', input.file_path || input.notebook_path]
    : /^(Read)$/.test(t) ? ['read_file', input.file_path]
    : /^(WebFetch)$/.test(t) ? ['open_website', input.url]
    : /^(WebSearch)$/.test(t) ? ['search_web', input.query]
    : ['use_tool', input.description || JSON.stringify(input)];
  return { kind: 'permission', titleKey: what[0], titleParams: { tool: t }, detail: short(what[1] || ''), tool: t, canAlways: Array.isArray(suggestions) && suggestions.length > 0 };
}

// choice: { behavior: 'allow' | 'deny', always?, answers? } -> objeto "decision" del hook, o null si no vale
function decide(p, choice = {}) {
  if (choice.behavior === 'deny') {
    return { behavior: 'deny', message: p.tool === 'ExitPlanMode' ? 'The user wants you to keep planning.' : 'The user denied this from Notch Pet.' };
  }
  if (choice.behavior !== 'allow') return null;
  if (p.tool === 'AskUserQuestion') {
    const qs = (p.input.questions || []).map(q => q.question);
    const answers = {};
    for (const [q, a] of Object.entries(choice.answers || {})) {
      if (!qs.includes(q) || typeof a !== 'string' || !a.trim() || a.length > 2000) continue;
      answers[q] = a.trim();
    }
    if (!qs.every(q => answers[q])) return null; // hay que contestar todas
    return { behavior: 'allow', updatedInput: { ...p.input, answers } };
  }
  const d = { behavior: 'allow', updatedInput: p.input };
  if (choice.always && p.suggestions?.length) d.updatedPermissions = p.suggestions;
  return d;
}

module.exports = { summarize, decide, fingerprint };

if (require.main === module) {
  const assert = require('assert');
  const ask = { tool: 'AskUserQuestion', input: { questions: [{ question: '¿Qué base de datos?', header: 'BD', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] } };
  assert.strictEqual(summarize(ask.tool, ask.input).questions[0].options[1].label, 'SQLite');
  assert.strictEqual(decide(ask, { behavior: 'allow', answers: {} }), null, 'sin contestar no vale');
  assert.deepStrictEqual(decide(ask, { behavior: 'allow', answers: { '¿Qué base de datos?': 'Postgres', 'inventada': 'x' } }).updatedInput.answers, { '¿Qué base de datos?': 'Postgres' });
  const bash = { tool: 'Bash', input: { command: 'npm test' }, suggestions: [{ type: 'addRules' }] };
  assert.deepStrictEqual(summarize(bash.tool, bash.input, bash.suggestions), { kind: 'permission', titleKey: 'run_command', titleParams: { tool: 'Bash' }, detail: 'npm test', tool: 'Bash', canAlways: true });
  assert.deepStrictEqual(decide(bash, { behavior: 'allow' }), { behavior: 'allow', updatedInput: { command: 'npm test' } });
  assert.strictEqual(decide(bash, { behavior: 'allow', always: true }).updatedPermissions.length, 1);
  assert.strictEqual(decide(bash, { behavior: 'deny' }).behavior, 'deny');
  assert.strictEqual(decide(bash, { behavior: 'loquesea' }), null);
  assert.strictEqual(fingerprint('AskUserQuestion', { questions: [1] }), fingerprint('AskUserQuestion', { questions: [1], answers: { a: 1 } }));
  assert.strictEqual(summarize('mcp__srv__do_thing', { description: 'hola' }).titleParams.tool, 'do_thing');
  console.log('asks.js ok');
}
