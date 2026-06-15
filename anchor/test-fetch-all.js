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

  // Get all bucket IDs from pulse
  const pulse = await callTool('pulse', {});
  const bucketIds = [...pulse.matchAll(/\[(\w{12})\]/g)].map(m => m[1]);
  const uniqueIds = [...new Set(bucketIds)];
  console.log(`Found ${uniqueIds.length} unique bucket IDs`);

  // Try trace to read each bucket's content (trace just needs bucket_id)
  console.log('\n=== Reading first 3 buckets via trace ===');
  for (let i = 0; i < Math.min(3, uniqueIds.length); i++) {
    const id = uniqueIds[i];
    console.log(`\nBucket ${id}:`);
    const result = await callTool('trace', { bucket_id: id });
    console.log(result.substring(0, 300));
  }

  // Try breath with each bucket_id as query
  console.log('\n=== Trying breath with bucket content as query ===');
  const r = await callTool('breath', { importance_min: 1, max_results: 50, max_tokens: 50000 });
  console.log('importance_min result:', r.substring(0, 200));
  console.log('bucket count:', (r.match(/记忆桶:/g) || []).length);
}

run().catch(console.error);
