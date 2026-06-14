import { useCallback } from 'react';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day}`;
}

export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onOpenSettings,
  onOpenMemories,
  collapsed,
  onToggle,
}) {
  const handleContextMenu = useCallback((e, session) => {
    e.preventDefault();
    const action = window.prompt(
      `Session: ${session.name}\n\nType "rename" to rename or "delete" to delete:`
    );
    if (!action) return;
    const lower = action.toLowerCase().trim();
    if (lower === 'delete') {
      if (window.confirm(`Delete "${session.name}"?`)) {
        onDeleteSession(session.id);
      }
    } else if (lower === 'rename') {
      const newName = window.prompt('New name:', session.name);
      if (newName && newName.trim()) {
        onRenameSession(session.id, newName.trim());
      }
    }
  }, [onDeleteSession, onRenameSession]);

  return (
    <>
      <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-header">
          <span className="sidebar-title">Drift</span>
          <button className="sidebar-toggle" onClick={onToggle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18L9 12L15 6" />
            </svg>
          </button>
        </div>
        <button className="new-chat-btn" onClick={onCreateSession}>
          <span>+</span> New Chat
        </button>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === currentSessionId ? 'session-active' : ''}`}
              onClick={() => onSelectSession(s.id)}
              onContextMenu={(e) => handleContextMenu(e, s)}
            >
              <div className="session-info">
                <div className="session-name">{s.name || 'Untitled'}</div>
                <div className="session-date">{formatDate(s.created_at || s.updatedAt)}</div>
              </div>
              <button
                className="session-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`删除「${s.name || 'Untitled'}」？`)) {
                    onDeleteSession(s.id);
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="settings-btn" onClick={onOpenMemories}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Z" />
              <path d="M12 17v.5" /><path d="M12 6V2" />
            </svg>
            记忆库
          </button>
          <button className="settings-btn" onClick={onOpenSettings}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      </div>
      {!collapsed && <div className="sidebar-overlay" onClick={onToggle} />}
    </>
  );
}
