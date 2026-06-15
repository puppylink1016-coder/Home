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

  // Call dream and count all blocks
  const result = await callTool('dream', {});
  const blocks = result.split('\n---\n');
  const memBlocks = blocks.filter(b => b.includes('ID:'));
  console.log(`Dream returned ${memBlocks.length} memory blocks`);
  console.log(`Total text length: ${result.length}`);

  // Show all IDs
  for (const b of memBlocks) {
    const idMatch = b.match(/ID:\s*(\S+)/);
    const contentLines = b.split('\n').filter(l =>
      l.trim() && !l.startsWith('[') && !l.startsWith('ID:')
    );
    const preview = contentLines.join(' ').substring(0, 80);
    console.log(`  ${idMatch ? idMatch[1] : '?'}: ${preview}`);
  }

  // Now try calling dream a second time to see if we get different results
  console.log('\n=== Dream call #2 ===');
  const result2 = await callTool('dream', {});
  const blocks2 = result2.split('\n---\n').filter(b => b.includes('ID:'));
  console.log(`Second dream returned ${blocks2.length} blocks`);

  // Collect all unique IDs
  const allIds = new Set();
  for (const b of [...memBlocks, ...blocks2]) {
    const m = b.match(/ID:\s*(\S+)/);
    if (m) allIds.add(m[1]);
  }
  console.log(`Unique IDs across both calls: ${allIds.size}`);
}

run().catch(console.error);
