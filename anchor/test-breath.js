const OMBRE_URL = 'https://ezra-puppy-memory.zeabur.app';
let sessionId = null;
let callId = 0;

function parseSSE(text) {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.substring(6)); } catch (e) {}
    }
  }
  try { return JSON.parse(text); } catch (e) { return null; }
}

async function init() {
  const res = await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }, id: ++callId })
  });
  sessionId = res.headers.get('mcp-session-id');
  await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });
}

async function callTool(name, args) {
  const res = await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: ++callId })
  });
  const text = await res.text();
  const parsed = parseSSE(text);
  if (parsed?.result?.content) {
    return parsed.result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  }
  return JSON.stringify(parsed);
}

async function run() {
  await init();

  console.log('=== Test 1: importance_min=1, max_results=50 ===');
  const r1 = await callTool('breath', { importance_min: 1, max_results: 50 });
  console.log('Length:', r1.length, 'Buckets:', (r1.match(/记忆桶:/g) || []).length);

  console.log('\n=== Test 2: empty query, max_results=50 ===');
  const r2 = await callTool('breath', { query: '', max_results: 50 });
  console.log('Length:', r2.length, 'Buckets:', (r2.match(/记忆桶:/g) || []).length);

  console.log('\n=== Test 3: empty object ===');
  const r3 = await callTool('breath', {});
  console.log('Length:', r3.length, 'Buckets:', (r3.match(/记忆桶:/g) || []).length);

  console.log('\n=== Test 4: importance_min=1, max_results=50, max_tokens=50000 ===');
  const r4 = await callTool('breath', { importance_min: 1, max_results: 50, max_tokens: 50000 });
  console.log('Length:', r4.length, 'Buckets:', (r4.match(/记忆桶:/g) || []).length);
  console.log(r4.substring(0, 2000));

  console.log('\n=== Test 5: dream ===');
  const r5 = await callTool('dream', {});
  console.log('Length:', r5.length, 'Buckets:', (r5.match(/记忆桶:/g) || []).length);
  console.log(r5.substring(0, 1000));
}

run().catch(console.error);
