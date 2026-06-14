import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ChatView from './components/ChatView.jsx';
import Settings from './components/Settings.jsx';
import * as api from './api.js';

function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(window.innerWidth < 768);

  useEffect(() => {
    api.getSessions().then((data) => {
      const list = Array.isArray(data) ? data : data.sessions || [];
      setSessions(list);
      if (list.length > 0) {
        setCurrentSessionId(list[0].id);
      }
    }).catch((e) => console.error('getSessions failed:', e));

    api.getSettings().then((data) => {
      setSettings(data);
    }).catch((e) => console.error('getSettings failed:', e));
  }, []);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      return;
    }
    api.getMessages(currentSessionId).then((data) => {
      const msgs = Array.isArray(data) ? data : data.messages || [];
      setMessages(msgs);
    }).catch(() => {
      setMessages([]);
    });
  }, [currentSessionId]);

  const handleSend = useCallback((text) => {
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    api.sendMessage(text, currentSessionId).then((data) => {
      const aiMessages = data.messages || (data.message ? [data.message] : []);
      if (aiMessages.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...aiMessages.map((m) => ({
            id: m.id || Date.now() + Math.random(),
            role: 'assistant',
            content: m.content,
            created_at: m.created_at || new Date().toISOString(),
          })),
        ]);
      }
      if (data.sessionId && !currentSessionId) {
        setCurrentSessionId(data.sessionId);
        api.getSessions().then((d) => {
          setSessions(Array.isArray(d) ? d : d.sessions || []);
        }).catch(() => {});
      }
    }).catch(() => {
      setMessages((prev) => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'Connection error. Please try again.',
        created_at: new Date().toISOString(),
      }]);
    }).finally(() => {
      setLoading(false);
    });
  }, [currentSessionId]);

  const handleCreateSession = useCallback(() => {
    const name = `Chat ${sessions.length + 1}`;
    api.createSession(name).then((data) => {
      const newSession = data.session || data;
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setMessages([]);
      if (window.innerWidth < 768) setSidebarCollapsed(true);
    }).catch(() => {});
  }, [sessions.length]);

  const handleDeleteSession = useCallback((id) => {
    api.deleteSession(id).then(() => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    }).catch(() => {});
  }, [currentSessionId]);

  const handleRenameSession = useCallback((id, name) => {
    api.renameSession(id, name).then(() => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name } : s))
      );
    }).catch(() => {});
  }, []);

  const handleSelectSession = useCallback((id) => {
    setCurrentSessionId(id);
    if (window.innerWidth < 768) setSidebarCollapsed(true);
  }, []);

  const handleSaveSettings = useCallback((form) => {
    api.updateSettings(form).then((data) => {
      setSettings(data.settings || data || form);
      setShowSettings(false);
    }).catch(() => {});
  }, []);

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onOpenSettings={() => setShowSettings(true)}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />
      <div className="main-area">
        <div className="topbar">
          <button className="menu-btn" onClick={() => setSidebarCollapsed(false)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <span className="topbar-title">
            {sessions.find((s) => s.id === currentSessionId)?.name || 'Drift'}
          </span>
        </div>
        <ChatView messages={messages} loading={loading} onSend={handleSend} />
      </div>
      {showSettings && (
        <Settings
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
