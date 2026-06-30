#!/usr/bin/env node
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const PORT = parseInt(process.env.PROXY_PORT || '8792');
const AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || '';
const CLAUDE_CWD = process.env.CLAUDE_CWD || './';
const RESUME_SESSIONS = process.env.CLAUDE_RESUME_SESSIONS !== '0';
const SESSION_STORE_PATH = resolve(
  process.env.CLAUDE_SESSION_STORE || './.claude-proxy-sessions.json'
);

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => res(Buffer.concat(chunks).toString())); req.on('error', rej);
  });
}

function checkAuth(req, cors, res) {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
  if (auth === AUTH_TOKEN) return true;
  res.writeHead(401, cors); res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

function normalizeModel(raw) {
  if (!raw) return '';
  let m = raw.replace(/^anthropic\//, '').replace(/^openai\//, '');
  const ALIASES = {
    'claude-opus-4-6': 'claude-opus-4-6',
    'claude-opus-4-20250514': 'claude-opus-4-6',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
    'claude-haiku-4-5': 'claude-haiku-4-5',
  };
  return ALIASES[m] || m;
}

function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function loadSessionStore() {
  try {
    if (!existsSync(SESSION_STORE_PATH)) return {};
    return JSON.parse(readFileSync(SESSION_STORE_PATH, 'utf8')) || {};
  } catch (err) {
    console.error(`[proxy] failed to load session store: ${err.message}`);
    return {};
  }
}

function saveSessionStore() {
  try {
    mkdirSync(dirname(SESSION_STORE_PATH), { recursive: true });
    writeFileSync(SESSION_STORE_PATH, JSON.stringify(sessionStore, null, 2));
  } catch (err) {
    console.error(`[proxy] failed to save session store: ${err.message}`);
  }
}

const sessionStore = loadSessionStore();

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }
  return '';
}

function fingerprintMessages(messages = []) {
  const firstUser = messages.find(msg => msg.role === 'user');
  const text = textFromContent(firstUser?.content).slice(0, 500);
  return text ? `fp:${hashText(text).slice(0, 24)}` : '';
}

function getConversationKey(body, req) {
  return String(
    body.metadata?.sessionId ||
    body.metadata?.session_id ||
    body.metadata?.conversation_id ||
    body.user ||
    req.headers['x-claude-session-key'] ||
    req.headers['x-drift-session-id'] ||
    fingerprintMessages(body.messages) ||
    ''
  );
}

function getLatestUserPrompt(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const text = textFromContent(msg.content);
    return text ? `Human: ${text}\n\n` : '';
  }
  return '';
}

function getClaudeSessionId(ev) {
  return ev?.session_id || ev?.sessionId || ev?.session?.id || ev?.metadata?.session_id || '';
}

function rememberClaudeSession(key, ev, systemPrompt, model) {
  if (!key) return;
  const sessionId = getClaudeSessionId(ev);
  if (!sessionId) {
    console.log(`[proxy] session NOT captured for key: ${key} — CLI output missing session_id`);
    return;
  }
  const isNew = !sessionStore[key] || sessionStore[key].sessionId !== sessionId;
  sessionStore[key] = {
    sessionId,
    model: normalizeModel(model) || 'claude-sonnet-4-6',
    systemHash: hashText(systemPrompt),
    updatedAt: new Date().toISOString(),
  };
  saveSessionStore();
  const u = ev?.usage || {};
  console.log(`[proxy] session ${isNew ? 'STORED' : 'updated'} | key: ${key} | sid: ${sessionId.slice(0, 12)}... | input: ${u.input_tokens || '?'} | output: ${u.output_tokens || '?'} | cache_read: ${u.cache_read_input_tokens ?? u.cache_read ?? '?'} | cache_create: ${u.cache_creation_input_tokens ?? u.cache_create ?? '?'}`);
}

function clearClaudeSession(key) {
  if (!key || !sessionStore[key]) return;
  delete sessionStore[key];
  saveSessionStore();
}

function prepareClaudeTurn({ systemPrompt, fullPrompt, latestPrompt, model, conversationKey, resetSession = false }) {
  if (resetSession) clearClaudeSession(conversationKey);

  const stored = conversationKey ? sessionStore[conversationKey] : null;
  let resumeSessionId = RESUME_SESSIONS ? stored?.sessionId : '';

  let systemChanged = false;
  if (resumeSessionId && stored?.systemHash && systemPrompt) {
    const currentHash = hashText(systemPrompt);
    if (currentHash !== stored.systemHash) {
      console.log(`[proxy] system prompt changed for key: ${conversationKey} — injecting update (keeping session for context)`);
      systemChanged = true;
      stored.systemHash = currentHash;
      saveSessionStore();
    }
  }

  const resuming = !!resumeSessionId;

  let userPrompt;
  if (resumeSessionId) {
    const base = latestPrompt || fullPrompt;
    userPrompt = systemChanged
      ? `[系统指令已更新，从现在起遵循以下指令]\n${systemPrompt}\n[更新结束]\n\n${base}`
      : base;
  } else {
    userPrompt = fullPrompt;
  }

  console.log(`[proxy] prepare | key: ${conversationKey || '(none)'} | resume: ${resuming ? 'YES ' + resumeSessionId.slice(0, 12) + '...' : 'NO (new session)'} | full: ${fullPrompt.length} chars | latest: ${latestPrompt?.length || 0} chars | system: ${systemPrompt?.length || 0} chars${resuming ? ' (skipped)' : ''}${systemChanged ? ' | SYSTEM UPDATE INJECTED' : ''}`);

  return {
    systemPrompt: resumeSessionId ? '' : systemPrompt,
    userPrompt,
    resumeSessionId,
  };
}

function spawnClaude(systemPrompt, userPrompt, model, resumeSessionId = '') {
  const m = normalizeModel(model);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', 'none'];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  else if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (m && m !== 'claude-sonnet-4-6') args.push('--model', m);
  console.log(`[proxy] spawn claude | model: ${m || '(default)'} | prompt: ${userPrompt.length} chars | system: ${systemPrompt?.length || 0} chars | resume: ${resumeSessionId ? 'yes' : 'no'}`);
  const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: CLAUDE_CWD });
  child.stdin.write(userPrompt);
  child.stdin.end();
  child.stderr.on('data', d => console.error(`[claude stderr] ${d.toString().trim()}`));
  return child;
}

function openaiMessagesToPrompt(messages) {
  let system = '';
  let prompt = '';
  for (const msg of messages || []) {
    const text = textFromContent(msg.content);
    if (msg.role === 'system') { system += (system ? '\n' : '') + text; }
    else if (msg.role === 'user') { prompt += `Human: ${text}\n\n`; }
    else if (msg.role === 'assistant') { prompt += `Assistant: ${text}\n\n`; }
    else if (msg.role === 'tool') { prompt += `Human: [Tool result: ${text}]\n\n`; }
  }
  return { system, prompt };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, x-claude-session-key, x-drift-session-id, x-claude-reset-session'
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  // --- OpenAI-compatible: /v1/chat/completions ---
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    if (!checkAuth(req, CORS, res)) return;
    const body = JSON.parse(await readBody(req));
    console.log(`[proxy] /v1/chat/completions | model: ${body.model} | stream: ${body.stream} | msgs: ${body.messages?.length}`);
    const { system, prompt } = openaiMessagesToPrompt(body.messages);
    const isStream = body.stream === true;
    const model = body.model || '';
    const chatId = `chatcmpl-${Date.now()}`;
    const conversationKey = getConversationKey(body, req);
    const resetSession = body.metadata?.reset_claude_session === true || req.headers['x-claude-reset-session'] === '1';
    const turn = prepareClaudeTurn({
      systemPrompt: system,
      fullPrompt: prompt,
      latestPrompt: getLatestUserPrompt(body.messages),
      model,
      conversationKey,
      resetSession,
    });

    const child = spawnClaude(turn.systemPrompt, turn.userPrompt, model, turn.resumeSessionId);

    if (isStream) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

      const keepAlive = setInterval(() => { res.write(': keepalive\n\n'); }, 5000);
      function sse(obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
      let buf = '';
      let inThinking = false;
      let sentRole = false;
      let sentResponseText = false;
      let responseClosed = false;

      function finishStream() {
        if (responseClosed) return;
        responseClosed = true;
        clearInterval(keepAlive);
        res.end();
        try { child.kill(); } catch {}
      }

      function abortStream() {
        clearInterval(keepAlive);
        try { child.kill(); } catch {}
      }

      child.stdout.on('data', (chunk) => {
        if (responseClosed) return;
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (responseClosed) break;
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }

          const se = ev.type === 'stream_event' ? (ev.event || {}) : ev;
          if (se.type === 'content_block_start') {
            const cb = se.content_block || {};
            inThinking = cb.type === 'thinking';
            if (inThinking) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: sentRole ? { content: '[THINKING]' } : { role: 'assistant', content: '[THINKING]' }, finish_reason: null }] });
              sentRole = true;
            } else if (!sentRole) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
              sentRole = true;
            }
          } else if (se.type === 'content_block_delta') {
            const d = se.delta || {};
            if (d.thinking) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: d.thinking }, finish_reason: null }] });
            }
            if (d.text) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: d.text }, finish_reason: null }] });
              sentResponseText = true;
            }
          } else if (se.type === 'content_block_stop') {
            if (inThinking) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '[/THINKING]' }, finish_reason: null }] });
              inThinking = false;
            }
          } else if (ev.type === 'result') {
            rememberClaudeSession(conversationKey, ev, system, model);
            if (ev.result && !sentResponseText) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: sentRole ? { content: ev.result } : { role: 'assistant', content: ev.result }, finish_reason: null }] });
              sentRole = true;
            }
            sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: ev.usage?.input_tokens || 0, completion_tokens: ev.usage?.output_tokens || 0 } });
            res.write('data: [DONE]\n\n');
            finishStream();
          }
        }
      });
      child.stderr.on('data', () => {}); // handled in spawnClaude
      child.on('close', finishStream);
      child.on('error', finishStream);
      res.on('close', () => { if (!responseClosed) abortStream(); });

    } else {
      let output = '';
      child.stdout.on('data', c => { output += c.toString(); });
      child.on('close', () => {
        try {
          const evts = output.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const result = evts.find(e => e.type === 'result');
          rememberClaudeSession(conversationKey, result, system, model);
          res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: chatId, object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: result?.result || '' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: result?.usage?.input_tokens || 0, completion_tokens: result?.usage?.output_tokens || 0 }
          }));
        } catch (e) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ error: { message: e.message } }));
        }
      });
    }
    return;
  }

  // --- Anthropic: /v1/messages ---
  if (req.url === '/v1/messages' && req.method === 'POST') {
    if (!checkAuth(req, CORS, res)) return;
    const body = JSON.parse(await readBody(req));
    const sysText = body.system ? (typeof body.system === 'string' ? body.system : body.system.map(b => b.text || '').join('\n')) : '';
    let prompt = '';
    for (const msg of body.messages || []) {
      const text = typeof msg.content === 'string' ? msg.content
        : Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
      if (msg.role === 'user') prompt += `Human: ${text}\n\n`;
      else if (msg.role === 'assistant') prompt += `Assistant: ${text}\n\n`;
    }
    const model = body.model || '';
    const isStream = body.stream !== false;
    const conversationKey = getConversationKey(body, req);
    const resetSession = body.metadata?.reset_claude_session === true || req.headers['x-claude-reset-session'] === '1';
    const turn = prepareClaudeTurn({
      systemPrompt: sysText,
      fullPrompt: prompt,
      latestPrompt: getLatestUserPrompt(body.messages),
      model,
      conversationKey,
      resetSession,
    });
    const child = spawnClaude(turn.systemPrompt, turn.userPrompt, model, turn.resumeSessionId);

    if (isStream) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      let msgId = `msg_proxy_${Date.now()}`;
      let blockIdx = 0;
      let buf = '';
      let sentTextDelta = false;
      let responseClosed = false;
      function finishStream() {
        if (responseClosed) return;
        responseClosed = true;
        res.end();
        try { child.kill(); } catch {}
      }
      function abortStream() {
        try { child.kill(); } catch {}
      }
      res.write(`event: message_start\ndata: ${JSON.stringify({type:"message_start",message:{id:msgId,type:"message",role:"assistant",content:[],model:model||"claude-sonnet-4-6",stop_reason:null,usage:{input_tokens:0,output_tokens:0}}})}\n\n`);
      child.stdout.on('data', (chunk) => {
        if (responseClosed) return;
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (responseClosed) break;
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            const se = ev.type === 'stream_event' ? (ev.event || {}) : ev;
            if (se.type === 'content_block_start') {
              const cb = se.content_block || {};
              res.write(`event: content_block_start\ndata: ${JSON.stringify({type:"content_block_start",index:blockIdx,content_block:{type:cb.type,text:cb.type==='text'?'':undefined,thinking:cb.type==='thinking'?'':undefined}})}\n\n`);
            } else if (se.type === 'content_block_delta') {
              const d = se.delta || {};
              if (d.text) sentTextDelta = true;
              res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",index:blockIdx,delta:d})}\n\n`);
            } else if (se.type === 'content_block_stop') {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({type:"content_block_stop",index:blockIdx})}\n\n`);
              blockIdx++;
            } else if (ev.type === 'result') {
              rememberClaudeSession(conversationKey, ev, sysText, model);
              if (ev.result && !sentTextDelta) {
                res.write(`event: content_block_start\ndata: ${JSON.stringify({type:"content_block_start",index:blockIdx,content_block:{type:"text",text:""}})}\n\n`);
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",index:blockIdx,delta:{type:"text_delta",text:ev.result}})}\n\n`);
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({type:"content_block_stop",index:blockIdx})}\n\n`);
                blockIdx++;
              }
              res.write(`event: message_delta\ndata: ${JSON.stringify({type:"message_delta",delta:{stop_reason:ev.stop_reason||"end_turn"},usage:{output_tokens:ev.usage?.output_tokens||0}})}\n\n`);
              res.write(`event: message_stop\ndata: ${JSON.stringify({type:"message_stop"})}\n\n`);
              finishStream();
            }
          } catch {}
        }
      });
      child.stderr.on('data', () => {}); // handled in spawnClaude
      child.on('close', finishStream);
      child.on('error', finishStream);
      res.on('close', () => { if (!responseClosed) abortStream(); });
    } else {
      let output = '';
      child.stdout.on('data', c => { output += c.toString(); });
      child.on('close', () => {
        try {
          const result = output.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).find(e => e.type === 'result');
          rememberClaudeSession(conversationKey, result, sysText, model);
          res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `msg_proxy_${Date.now()}`, type: 'message', role: 'assistant',
            content: [{ type: 'text', text: result?.result || '' }],
            model: model || 'claude-sonnet-4-6', stop_reason: 'end_turn',
            usage: { input_tokens: result?.usage?.input_tokens || 0, output_tokens: result?.usage?.output_tokens || 0 }
          }));
        } catch (e) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    }
    return;
  }

  if (req.url === '/health') {
    const sessions = Object.entries(sessionStore).map(([k, v]) => ({
      key: k,
      sessionId: v.sessionId?.slice(0, 12) + '...',
      model: v.model,
      systemHash: v.systemHash?.slice(0, 8) + '...',
      updatedAt: v.updatedAt,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'claude-proxy',
      resume_sessions: RESUME_SESSIONS,
      stored_sessions: Object.keys(sessionStore).length,
      sessions,
    }));
    return;
  }

  if (req.url === '/clear-sessions' && req.method === 'POST') {
    if (!checkAuth(req, CORS, res)) return;
    const count = Object.keys(sessionStore).length;
    for (const k of Object.keys(sessionStore)) delete sessionStore[k];
    saveSessionStore();
    console.log(`[proxy] cleared all ${count} sessions`);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cleared: count }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Proxy → http://0.0.0.0:${PORT}`);
  console.log(`  /v1/messages          (Anthropic)`);
  console.log(`  /v1/chat/completions  (OpenAI)`);
  console.log(`cwd: ${CLAUDE_CWD} | auth: ${AUTH_TOKEN ? 'enabled' : 'disabled'}`);
});
