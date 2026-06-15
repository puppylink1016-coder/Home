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

async function callToolRaw(name, args) {
  const res = await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: ++callId })
  });
  return await res.text();
}

async function run() {
  await init();

  // Test 1: empty query - should auto-surface
  console.log('=== Test 1: no query (auto surface) ===');
  const r1 = await callToolRaw('breath', {});
  console.log(r1.substring(0, 500));

  // Test 2: query with a keyword
  console.log('\n=== Test 2: query="勇敢" ===');
  const r2 = await callToolRaw('breath', { query: '勇敢' });
  console.log(r2.substring(0, 500));

  // Test 3: simple query
  console.log('\n=== Test 3: query="昭昭" ===');
  const r3 = await callToolRaw('breath', { query: '昭昭' });
  console.log(r3.substring(0, 500));

  // Test 4: query with max_tokens bumped
  console.log('\n=== Test 4: query="勇敢", max_tokens=50000 ===');
  const r4 = await callToolRaw('breath', { query: '勇敢', max_tokens: 50000 });
  console.log(r4.substring(0, 500));
}

run().catch(console.error);
