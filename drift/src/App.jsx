import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ChatView from './components/ChatView.jsx';
import Settings from './components/Settings.jsx';
import Memories from './components/Memories.jsx';
import * as api from './api.js';

function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
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

  const [uploading, setUploading] = useState(false);

  const handleSend = useCallback(async (text, imageFile) => {
    let imageUrl = null;

    if (imageFile) {
      setUploading(true);
      try {
        const result = await api.uploadImage(imageFile);
        imageUrl = result.url;
      } catch (err) {
        setUploading(false);
        throw err;
      }
      setUploading(false);
    }

    let displayContent = text || '';
    if (imageUrl) {
      displayContent = `![image](${imageUrl})` + (text ? `\n${text}` : '');
    }

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: displayContent,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const streamPrefix = 'stream-' + Date.now() + '-';
    let started = false;
    let fullContent = '';
    let thinkingContent = '';

    const renderStreamingMessages = () => {
      const parts = fullContent.split('---SPLIT---').map(p => p.trim()).filter(Boolean);
      const display = parts.length > 0 ? parts : [''];
      setMessages((prev) => {
        const without = prev.filter((m) => !String(m.id).startsWith(streamPrefix));
        return [...without, ...display.map((p, i) => ({
          id: streamPrefix + i,
          role: 'assistant',
          content: p,
          thinking: i === 0 ? thinkingContent : '',
          streaming: i === display.length - 1,
        }))];
      });
    };

    api.sendMessageStream(text, currentSessionId, {
      imageUrl,
      onToken(token) {
        if (!started) {
          started = true;
          setLoading(false);
        }
        fullContent += token;
        renderStreamingMessages();
      },
      onThinking(token) {
        if (!started) {
          started = true;
          setLoading(false);
        }
        thinkingContent += token;
        renderStreamingMessages();
      },
      onSession(id) {
        setCurrentSessionId(id);
      },
      onDone(data) {
        setLoading(false);
        const final = (data.messages || []).map((m) => ({
          id: m.id,
          role: 'assistant',
          content: m.content,
          created_at: m.created_at || new Date().toISOString(),
        }));
        setMessages((prev) => {
          const without = prev.filter((m) => !String(m.id).startsWith(streamPrefix));
          return [...without, ...final];
        });
        if (data.sessionId && !currentSessionId) {
          setCurrentSessionId(data.sessionId);
        }
        api.getSessions().then((d) => {
          setSessions(Array.isArray(d) ? d : d.sessions || []);
        }).catch(() => {});
      },
      onError(err) {
        setLoading(false);
        if (!started) {
          setMessages((prev) => [...prev, {
            id: Date.now() + 1,
            role: 'assistant',
            content: '连接出错了，再试一次。',
            created_at: new Date().toISOString(),
          }]);
        }
      },
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
        onOpenMemories={() => setShowMemories(true)}
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
          <div className="topbar-profile">
            <div className="topbar-avatar">
              <img src="/avatar-ai.jpg" alt="聿" />
            </div>
            <div className="topbar-info">
              <span className="topbar-name">主人♡</span>
              <span className="topbar-status">Online</span>
            </div>
          </div>
        </div>
        <ChatView messages={messages} loading={loading} onSend={handleSend} uploading={uploading} />
      </div>
      {showSettings && (
        <Settings
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showMemories && (
        <Memories onClose={() => setShowMemories(false)} />
      )}
    </div>
  );
}

export default App;
