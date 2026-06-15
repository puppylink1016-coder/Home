import { API_URL, AUTH_TOKEN } from './config';

function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
    ...options.headers,
  };

  return fetch(url, { ...options, headers }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
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
