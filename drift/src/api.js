import { API_URL, AUTH_TOKEN } from './config';

function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
    ...options.headers,
  };

  return fetch(url, { ...options, headers }).then(async (res) => {
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const detail = typeof data === 'object' && data
        ? [data.error, data.hint].filter(Boolean).join(' ')
        : text;
      throw new Error(detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    return data;
  });
}

export function getSessions() {
  return fetchWithAuth(`${API_URL}/api/sessions`);
}

export function createSession(name) {
  return fetchWithAuth(`${API_URL}/api/sessions`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteSession(id) {
  return fetchWithAuth(`${API_URL}/api/sessions/${id}`, {
    method: 'DELETE',
  });
}

export function renameSession(id, name) {
  return fetchWithAuth(`${API_URL}/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function getMessages(sessionId) {
  return fetchWithAuth(`${API_URL}/api/messages/${sessionId}`);
}

export function sendMessage(message, sessionId) {
  return fetchWithAuth(`${API_URL}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, sessionId }),
  });
}

export function uploadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      fetchWithAuth(`${API_URL}/api/upload`, {
        method: 'POST',
        body: JSON.stringify({ data: base64, type: file.type }),
      }).then(resolve).catch(reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function sendMessageStream(message, sessionId, { onToken, onThinking, onSession, onDone, onError, imageUrl }) {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

  const body = { message, sessionId };
  if (imageUrl) body.imageUrl = imageUrl;

  fetch(`${API_URL}/api/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(trimmed.slice(6)); } catch { continue; }

        if (data.type === 'token') onToken?.(data.content);
        else if (data.type === 'thinking') onThinking?.(data.content);
        else if (data.type === 'session') onSession?.(data.sessionId);
        else if (data.type === 'done') onDone?.(data);
        else if (data.type === 'error') onError?.(new Error(data.error));
      }
    }
  }).catch((err) => onError?.(err));
}

export function getSettings() {
  return fetchWithAuth(`${API_URL}/api/settings`);
}

export function updateSettings(settings) {
  return fetchWithAuth(`${API_URL}/api/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function getMemories() {
  return fetchWithAuth(`${API_URL}/api/memories`);
}

export function addMemory(summary) {
  return fetchWithAuth(`${API_URL}/api/memories`, {
    method: 'POST',
    body: JSON.stringify({ summary }),
  });
}

export function deleteMemory(id) {
  return fetchWithAuth(`${API_URL}/api/memories/${id}`, {
    method: 'DELETE',
  });
}

export function getOmbreMemories() {
  return fetchWithAuth(`${API_URL}/api/ombre/memories`);
}

export function getAllOmbreMemories() {
  return fetchWithAuth(`${API_URL}/api/ombre/memories/all`);
}

export function addOmbreMemory(content) {
  return fetchWithAuth(`${API_URL}/api/ombre/memories`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function searchOmbreMemories(query) {
  return fetchWithAuth(`${API_URL}/api/ombre/search`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export function getPushPublicKey() {
  return fetchWithAuth(`${API_URL}/api/push/vapid-public-key`);
}

export function subscribePush(subscription) {
  return fetchWithAuth(`${API_URL}/api/push/subscribe`, {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  });
}

export function testPush(endpoint) {
  return fetchWithAuth(`${API_URL}/api/push/test`, {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export function unsubscribePush(endpoint) {
  return fetchWithAuth(`${API_URL}/api/push/unsubscribe`, {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export function getMurmurs(limit = 5) {
  return fetchWithAuth(`${API_URL}/api/murmurs?limit=${limit}`);
}

export function runMurmur(options = {}) {
  return fetchWithAuth(`${API_URL}/api/murmurs/run`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}
