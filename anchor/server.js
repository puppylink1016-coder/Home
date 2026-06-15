require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

    // Load memories
    const { data: memories } = await supabase
      .from('memories')
      .select('summary')
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
          content: 'Summarize the following conversation into a concise memory paragraph. Preserve key facts, decisions, emotions, and context. Write in the same language as the conversation.'
        },
        {
          role: 'user',
          content: transcript
        }
      ],
      temperature: 0.3,
      max_tokens: 1024
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
            content: 'Summarize the following conversation into a concise memory paragraph. Preserve key facts, decisions, emotions, and context. Write in the same language as the conversation.'
          },
          {
            role: 'user',
            content: transcript
          }
        ],
        temperature: 0.3,
        max_tokens: 1024
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
    const result = await callOmbreTool('breath', { importance_min: 1, max_results: 50 });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ombre/memories', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const result = await callOmbreTool('hold', { content });
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
