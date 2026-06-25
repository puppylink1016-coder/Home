#!/usr/bin/env node
import { createServer } from 'http';
import { spawn } from 'child_process';

const PORT = parseInt(process.env.PROXY_PORT || '8792');
const AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || '';
const CLAUDE_CWD = process.env.CLAUDE_CWD || './';

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

function spawnClaude(systemPrompt, userPrompt, model) {
  const m = normalizeModel(model);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', 'none'];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (m && m !== 'claude-sonnet-4-6') args.push('--model', m);
  console.log(`[proxy] spawn claude | model: ${m || '(default)'} | prompt: ${userPrompt.length} chars | system: ${systemPrompt?.length || 0} chars`);
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
    const text = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      : '';
    if (msg.role === 'system') { system += (system ? '\n' : '') + text; }
    else if (msg.role === 'user') { prompt += `Human: ${text}\n\n`; }
    else if (msg.role === 'assistant') { prompt += `Assistant: ${text}\n\n`; }
    else if (msg.role === 'tool') { prompt += `Human: [Tool result: ${text}]\n\n`; }
  }
  return { system, prompt };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version' };

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

    const child = spawnClaude(system, prompt, model);

    if (isStream) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

      const keepAlive = setInterval(() => { res.write(': keepalive\n\n'); }, 5000);
      function sse(obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
      let buf = '';
      let inThinking = false;
      let sentRole = false;
      let sentResponseText = false;

      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
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
            if (ev.result && !sentResponseText) {
              sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: sentRole ? { content: ev.result } : { role: 'assistant', content: ev.result }, finish_reason: null }] });
              sentRole = true;
            }
            sse({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: ev.usage?.input_tokens || 0, completion_tokens: ev.usage?.output_tokens || 0 } });
            res.write('data: [DONE]\n\n');
          }
        }
      });
      child.stderr.on('data', () => {}); // handled in spawnClaude
      child.on('close', () => { clearInterval(keepAlive); res.end(); });
      child.on('error', () => { clearInterval(keepAlive); res.end(); });
      req.on('close', () => { clearInterval(keepAlive); try { child.kill(); } catch {} });

    } else {
      let output = '';
      child.stdout.on('data', c => { output += c.toString(); });
      child.on('close', () => {
        try {
          const evts = output.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const result = evts.find(e => e.type === 'result');
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
    const child = spawnClaude(sysText, prompt, model);

    if (isStream) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      let msgId = `msg_proxy_${Date.now()}`;
      let blockIdx = 0;
      let buf = '';
      let sentTextDelta = false;
      res.write(`event: message_start\ndata: ${JSON.stringify({type:"message_start",message:{id:msgId,type:"message",role:"assistant",content:[],model:model||"claude-sonnet-4-6",stop_reason:null,usage:{input_tokens:0,output_tokens:0}}})}\n\n`);
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
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
              if (ev.result && !sentTextDelta) {
                res.write(`event: content_block_start\ndata: ${JSON.stringify({type:"content_block_start",index:blockIdx,content_block:{type:"text",text:""}})}\n\n`);
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",index:blockIdx,delta:{type:"text_delta",text:ev.result}})}\n\n`);
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({type:"content_block_stop",index:blockIdx})}\n\n`);
                blockIdx++;
              }
              res.write(`event: message_delta\ndata: ${JSON.stringify({type:"message_delta",delta:{stop_reason:ev.stop_reason||"end_turn"},usage:{output_tokens:ev.usage?.output_tokens||0}})}\n\n`);
              res.write(`event: message_stop\ndata: ${JSON.stringify({type:"message_stop"})}\n\n`);
            }
          } catch {}
        }
      });
      child.stderr.on('data', () => {}); // handled in spawnClaude
      child.on('close', () => { res.end(); });
      child.on('error', () => { res.end(); });
      req.on('close', () => { try { child.kill(); } catch {} });
    } else {
      let output = '';
      child.stdout.on('data', c => { output += c.toString(); });
      child.on('close', () => {
        try {
          const result = output.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).find(e => e.type === 'result');
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'claude-proxy' }));
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
