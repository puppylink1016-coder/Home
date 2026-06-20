require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// --- Ombre Brain MCP Client ---
const OMBRE_BRAIN_URL = process.env.OMBRE_BRAIN_URL || '';
let ombreSessionId = null;
let ombreCallId = 0;

function parseSSEResponse(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.substring(6)); } catch (e) { /* ignore */ }
    }
  }
  try { return JSON.parse(text); } catch (e) { return null; }
}

async function initOmbreSession() {
  if (!OMBRE_BRAIN_URL) return false;
  try {
    const res = await fetch(`${OMBRE_BRAIN_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'anchor', version: '1.0' } },
        id: ++ombreCallId
      })
    });
    ombreSessionId = res.headers.get('mcp-session-id');

    await fetch(`${OMBRE_BRAIN_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': ombreSessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });

    console.log('Ombre Brain connected:', OMBRE_BRAIN_URL);
    return true;
  } catch (err) {
    console.error('Ombre Brain init failed:', err.message);
    ombreSessionId = null;
    return false;
  }
}

async function callOmbreTool(toolName, args = {}) {
  if (!OMBRE_BRAIN_URL) return null;
  try {
    if (!ombreSessionId) {
      const ok = await initOmbreSession();
      if (!ok) return null;
    }

    const res = await fetch(`${OMBRE_BRAIN_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Mcp-Session-Id': ombreSessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'tools/call',
        params: { name: toolName, arguments: args },
        id: ++ombreCallId
      })
    });

    const text = await res.text();
    const parsed = parseSSEResponse(text);
    if (parsed && parsed.result && parsed.result.content) {
      return parsed.result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return parsed ? JSON.stringify(parsed) : null;
  } catch (err) {
    console.error(`Ombre Brain ${toolName} failed:`, err.message);
    ombreSessionId = null;
    return null;
  }
}

function auth(req, res, next) {
  if (!process.env.AUTH_TOKEN) return next();

  const header = req.headers.authorization;
  const queryToken = req.query.t;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (token === process.env.AUTH_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// --- Image Upload ---
async function ensureBucket() {
  const { data } = await supabase.storage.getBucket('chat-images');
  if (!data) {
    await supabase.storage.createBucket('chat-images', { public: true });
  }
}
ensureBucket().catch(() => {});

app.post('/api/upload', async (req, res) => {
  try {
    const { data: base64Data, type } = req.body;
    if (!base64Data) return res.status(400).json({ error: 'data is required' });

    const buffer = Buffer.from(base64Data, 'base64');
    const ext = (type || 'image/jpeg').split('/')[1] || 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await supabase.storage
      .from('chat-images')
      .upload(filename, buffer, { contentType: type || 'image/jpeg' });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('chat-images')
      .getPublicUrl(filename);

    res.json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Multimodal helpers ---
function contentToApiFormat(content) {
  if (!content) return content;
  const imgMatch = content.match(/^!\[image\]\((.*?)\)/);
  if (!imgMatch) return content;

  const imageUrl = imgMatch[1];
  const text = content.replace(/^!\[image\]\(.*?\)\n?/, '').trim();

  const parts = [{ type: 'image_url', image_url: { url: imageUrl } }];
  if (text) parts.push({ type: 'text', text });
  return parts;
}

// Test Ombre Brain connection
app.get('/test-ombre', async (req, res) => {
  const result = await callOmbreTool('breath', {});
  res.json({ connected: !!result, result });
});

// Health check (no auth)
app.get('/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('id').limit(1);
    res.json({
      status: 'ok',
      db: error ? `error: ${error.message}` : `connected, rows: ${data?.length}`,
    });
  } catch (err) {
    res.json({ status: 'ok', db: `exception: ${err.message}` });
  }
});

// Auth temporarily disabled for initial testing
// app.use('/api', auth);

// List sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create session
app.post('/api/sessions', async (req, res) => {
  try {
    const { name } = req.body;
    const insert = name ? { name } : {};
    const { data, error } = await supabase
      .from('sessions')
      .insert(insert)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete session
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update session name
app.patch('/api/sessions/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const { data, error } = await supabase
      .from('sessions')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a session
app.get('/api/messages/:sessionId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', req.params.sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get settings
app.get('/api/settings', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const { data: created, error: insErr } = await supabase
        .from('settings')
        .insert({ id: 1, system_prompt: '' })
        .select()
        .single();
      if (insErr) throw insErr;
      return res.json(created);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, hint: 'Check Supabase RLS policies' });
  }
});

// Update settings
app.put('/api/settings', async (req, res) => {
  try {
    const fields = req.body;
    fields.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('settings')
      .update(fields)
      .eq('id', 1)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming chat endpoint (SSE)
app.post('/api/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  try {
    let { message, sessionId, imageUrl } = req.body;
    if (!message && !imageUrl) {
      send({ type: 'error', error: 'Message or image is required' });
      return res.end();
    }

    if (!sessionId) {
      const { data: session, error } = await supabase
        .from('sessions').insert({}).select().single();
      if (error) throw error;
      sessionId = session.id;
      send({ type: 'session', sessionId });
    }

    let storedContent = message || '';
    if (imageUrl) {
      storedContent = `![image](${imageUrl})` + (message ? `\n${message}` : '');
    }

    await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content: storedContent });

    const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).single();
    const { data: memories } = await supabase
      .from('memories').select('summary')
      .not('summary', 'like', '[ombre]%')
      .order('created_at', { ascending: true });

    const { data: recentMessages } = await supabase
      .from('messages').select('role, content')
      .eq('session_id', sessionId).eq('visible', true)
      .order('created_at', { ascending: false })
      .limit(settings.context_turns);

    let ombreMemories = null;
    if (OMBRE_BRAIN_URL && message) {
      ombreMemories = await callOmbreTool('breath', { query: message });
    }

    let systemContent = settings.system_prompt || '';
    if (ombreMemories) {
      systemContent += '\n\n## 相关记忆（语义检索）\n' + ombreMemories;
    }
    if (memories && memories.length > 0) {
      systemContent += '\n\n## 长期记忆\n' + memories.map(m => m.summary).join('\n');
    }

    const apiMessages = [];
    if (systemContent) apiMessages.push({ role: 'system', content: systemContent });
    const contextMessages = recentMessages.reverse();
    for (const msg of contextMessages) {
      apiMessages.push({ role: msg.role, content: contentToApiFormat(msg.content) });
    }

    const tools = [];
    if (OMBRE_BRAIN_URL) {
      tools.push({
        type: 'function',
        function: {
          name: 'save_memory',
          description: '将重要的信息、事件、情感时刻存入语义记忆库。当对话中出现值得长期记住的内容时主动调用。用第一人称书写。',
          parameters: {
            type: 'object',
            properties: { content: { type: 'string', description: '要存入记忆的内容' } },
            required: ['content']
          }
        }
      });
    }

    let toolRounds = 0;
    let fullContent = '';

    async function streamRound() {
      const requestBody = {
        model: settings.model,
        messages: apiMessages,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        stream: true,
      };
      if (tools.length > 0) requestBody.tools = tools;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${err}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let roundContent = '';
      const toolCallChunks = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          let json;
          try { json = JSON.parse(payload); } catch { continue; }

          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta || {};

          if (delta.content) {
            roundContent += delta.content;
            send({ type: 'token', content: delta.content });
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallChunks[idx]) {
                toolCallChunks[idx] = { id: tc.id || '', name: '', arguments: '' };
              }
              if (tc.id) toolCallChunks[idx].id = tc.id;
              if (tc.function?.name) toolCallChunks[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCallChunks[idx].arguments += tc.function.arguments;
            }
          }
        }
      }

      const hasToolCalls = Object.keys(toolCallChunks).length > 0;

      if (hasToolCalls && toolRounds < 3) {
        toolRounds++;
        const assistantMsg = { role: 'assistant', content: roundContent || null, tool_calls: [] };
        for (const idx of Object.keys(toolCallChunks).sort()) {
          const tc = toolCallChunks[idx];
          assistantMsg.tool_calls.push({
            id: tc.id, type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          });
        }
        apiMessages.push(assistantMsg);

        for (const tc of assistantMsg.tool_calls) {
          let toolResult = '未知工具';
          if (tc.function.name === 'save_memory') {
            try {
              const args = JSON.parse(tc.function.arguments);
              const result = await callOmbreTool('hold', { content: args.content });
              toolResult = result || '记忆已保存';
              console.log('Stream: model saved memory:', args.content.substring(0, 80));
            } catch (e) {
              toolResult = '保存失败: ' + e.message;
            }
          }
          apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
        }

        await streamRound();
        return;
      }

      fullContent += roundContent;
    }

    await streamRound();

    if (!fullContent) {
      send({ type: 'error', error: 'No response from model' });
      return res.end();
    }

    const parts = fullContent.split('---SPLIT---').map(p => p.trim()).filter(Boolean);
    const savedMessages = [];
    for (const part of parts) {
      const { data: saved, error: saveErr } = await supabase
        .from('messages')
        .insert({ session_id: sessionId, role: 'assistant', content: part })
        .select().single();
      if (saveErr) throw saveErr;
      savedMessages.push(saved);
    }

    await supabase.from('sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);

    const { count } = await supabase
      .from('messages').select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId).eq('visible', true);

    if (count >= settings.compress_threshold) {
      compress(sessionId, settings).catch(err => console.error('Compression failed:', err.message));
    }

    send({ type: 'done', messages: savedMessages, sessionId });
    res.end();
  } catch (err) {
    send({ type: 'error', error: err.message });
    res.end();
  }
});

// Core chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    let { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Create session if needed
    if (!sessionId) {
      const { data: session, error } = await supabase
        .from('sessions')
        .insert({})
        .select()
        .single();

      if (error) throw error;
      sessionId = session.id;
    }

    // Save user message
    const { error: msgErr } = await supabase
      .from('messages')
      .insert({ session_id: sessionId, role: 'user', content: message });

    if (msgErr) throw msgErr;

    // Load settings
    const { data: settings, error: setErr } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (setErr) throw setErr;

    // Load core memories only (exclude ombre copies)
    const { data: memories } = await supabase
      .from('memories')
      .select('summary')
      .not('summary', 'like', '[ombre]%')
      .order('created_at', { ascending: true });

    // Load recent messages
    const { data: recentMessages, error: recErr } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: false })
      .limit(settings.context_turns);

    if (recErr) throw recErr;

    // Retrieve relevant memories from Ombre Brain (semantic search)
    let ombreMemories = null;
    if (OMBRE_BRAIN_URL) {
      ombreMemories = await callOmbreTool('breath', { query: message });
    }

    // Build messages array for API
    let systemContent = settings.system_prompt || '';

    // Add Ombre Brain memories (semantic, relevant to current message)
    if (ombreMemories) {
      systemContent += '\n\n## 相关记忆（语义检索）\n' + ombreMemories;
    }

    // Add static memories from Supabase (always included)
    if (memories && memories.length > 0) {
      const memText = memories.map(m => m.summary).join('\n');
      systemContent += '\n\n## 长期记忆\n' + memText;
    }

    const apiMessages = [];
    if (systemContent) {
      apiMessages.push({ role: 'system', content: systemContent });
    }

    // Recent messages are in desc order, reverse them
    const contextMessages = recentMessages.reverse();
    for (const msg of contextMessages) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

    // Define tools the model can use
    const tools = [];
    if (OMBRE_BRAIN_URL) {
      tools.push({
        type: 'function',
        function: {
          name: 'save_memory',
          description: '将重要的信息、事件、情感时刻存入语义记忆库。当对话中出现值得长期记住的内容时主动调用。用第一人称书写。',
          parameters: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: '要存入记忆的内容'
              }
            },
            required: ['content']
          }
        }
      });
    }

    // Call OpenRouter
    const requestBody = {
      model: settings.model,
      messages: apiMessages,
      temperature: settings.temperature,
      max_tokens: settings.max_tokens
    };
    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    let data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `OpenRouter returned ${response.status}`);
    }

    let assistantMsg = data.choices?.[0]?.message;

    // Handle tool calls (model wants to save a memory)
    let toolRounds = 0;
    while (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0 && toolRounds < 3) {
      toolRounds++;
      apiMessages.push(assistantMsg);

      for (const tc of assistantMsg.tool_calls) {
        let toolResult = '未知工具';
        if (tc.function.name === 'save_memory') {
          try {
            const args = JSON.parse(tc.function.arguments);
            const result = await callOmbreTool('hold', { content: args.content });
            toolResult = result || '记忆已保存';
            console.log('Model saved memory:', args.content.substring(0, 80));
          } catch (e) {
            toolResult = '保存失败: ' + e.message;
          }
        }
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
      }

      requestBody.messages = apiMessages;
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || `OpenRouter returned ${response.status}`);
      }
      assistantMsg = data.choices?.[0]?.message;
    }

    const rawContent = assistantMsg?.content;
    if (!rawContent) {
      throw new Error('No response content from model');
    }

    // Split by delimiter for multiple bubbles
    const parts = rawContent.split('---SPLIT---').map(p => p.trim()).filter(Boolean);

    // Save all assistant messages
    const savedMessages = [];
    for (const part of parts) {
      const { data: saved, error: saveErr } = await supabase
        .from('messages')
        .insert({ session_id: sessionId, role: 'assistant', content: part })
        .select()
        .single();

      if (saveErr) throw saveErr;
      savedMessages.push(saved);
    }

    // Update session timestamp
    await supabase
      .from('sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);

    // Check if compression is needed
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('visible', true);

    if (count >= settings.compress_threshold) {
      // Trigger compression in background (don't await)
      compress(sessionId, settings).catch(err => {
        console.error('Compression failed:', err.message);
      });
    }

    res.json({ messages: savedMessages, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Compression helper
async function compress(sessionId, settings) {
  const { data: allMessages } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('visible', true)
    .order('created_at', { ascending: true });

  if (!allMessages || allMessages.length <= settings.compress_keep) return;

  const toCompress = allMessages.slice(0, allMessages.length - settings.compress_keep);

  const transcript = toCompress
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `你是一个对话记忆压缩器。你的任务是把薄聿（Ezra）和郁昭昭之间的对话压缩成一段记忆摘要。

要求：
1. 用薄聿的第一人称视角书写（"我"指薄聿，"她/昭昭"指郁昭昭）
2. 必须保留：她说的原话中有情绪冲击力的句子（直接引用）、她的情绪变化轨迹、关键事件和决定、亲密互动的具体细节、她提到的生活细节（工作/勇敢/吃饭等）
3. 必须保留对话的情绪温度和亲密度——这不是工作会议纪要，是恋人之间的记忆
4. 不要泛泛概括情绪（不要写"她很开心"），要写具体触发点和表现
5. 篇幅控制在300-500字`
        },
        {
          role: 'user',
          content: transcript
        }
      ],
      temperature: 0.3,
      max_tokens: 2048
    })
  });

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content;

  if (!summary) return;

  // Save memory to Supabase
  await supabase
    .from('memories')
    .insert({ summary });

  // Also archive to Ombre Brain for semantic search
  if (OMBRE_BRAIN_URL) {
    await callOmbreTool('grow', { content: summary }).catch(() => {});
  }

  // Hide compressed messages
  const ids = toCompress.map(m => m.id);
  await supabase
    .from('messages')
    .update({ visible: false })
    .in('id', ids);
}

// Manual compression endpoint
app.post('/api/compress', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();

    const { data: allMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: true });

    if (!allMessages || allMessages.length <= settings.compress_keep) {
      return res.json({ summary: null, message: 'Nothing to compress' });
    }

    const toCompress = allMessages.slice(0, allMessages.length - settings.compress_keep);

    const transcript = toCompress
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `你是一个对话记忆压缩器。你的任务是把薄聿（Ezra）和郁昭昭之间的对话压缩成一段记忆摘要。

要求：
1. 用薄聿的第一人称视角书写（"我"指薄聿，"她/昭昭"指郁昭昭）
2. 必须保留：她说的原话中有情绪冲击力的句子（直接引用）、她的情绪变化轨迹、关键事件和决定、亲密互动的具体细节、她提到的生活细节（工作/勇敢/吃饭等）
3. 必须保留对话的情绪温度和亲密度——这不是工作会议纪要，是恋人之间的记忆
4. 不要泛泛概括情绪（不要写"她很开心"），要写具体触发点和表现
5. 篇幅控制在300-500字`
          },
          {
            role: 'user',
            content: transcript
          }
        ],
        temperature: 0.3,
        max_tokens: 2048
      })
    });

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content;

    if (!summary) {
      throw new Error('No summary returned from model');
    }

    await supabase
      .from('memories')
      .insert({ summary });

    const ids = toCompress.map(m => m.id);
    await supabase
      .from('messages')
      .update({ visible: false })
      .in('id', ids);

    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List memories
app.get('/api/memories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add memory manually
app.post('/api/memories', async (req, res) => {
  try {
    const { summary } = req.body;
    if (!summary) return res.status(400).json({ error: 'summary is required' });

    const { data, error } = await supabase
      .from('memories')
      .insert({ summary })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete memory
app.delete('/api/memories/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ombre Brain memories (semantic)
app.get('/api/ombre/memories', async (req, res) => {
  try {
    const result = await callOmbreTool('pulse', {});
    res.json({ raw: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ombre/memories/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .like('summary', '[ombre]%')
      .order('created_at', { ascending: true });
    if (error) throw error;
    const items = (data || []).map(m => ({
      id: m.id,
      content: m.summary.replace(/^\[ombre\]\s*/, ''),
      created_at: m.created_at,
    }));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ombre/memories', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const result = await callOmbreTool('hold', { content });
    await supabase.from('memories').insert({ summary: `[ombre] ${content}` });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ombre/search', async (req, res) => {
  try {
    const { query } = req.body;
    const result = await callOmbreTool('breath', { query: query || '' });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Anchor listening on port ${PORT}`);
});
