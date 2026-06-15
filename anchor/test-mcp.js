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

async function run() {
  // Initialize
  const initRes = await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      id: ++callId
    })
  });
  sessionId = initRes.headers.get('mcp-session-id');

  await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });

  // List tools
  const toolsRes = await fetch(`${OMBRE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: ++callId })
  });
  const toolsText = await toolsRes.text();
  const toolsData = parseSSE(toolsText);
  console.log(JSON.stringify(toolsData, null, 2));
}

run().catch(console.error);
