import { useState, useEffect } from 'react';
import * as api from '../api.js';

export default function Memories({ onClose }) {
  const [memories, setMemories] = useState([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMemories().then((data) => {
      setMemories(Array.isArray(data) ? data : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    api.addMemory(text).then((data) => {
      setMemories((prev) => [...prev, data]);
      setNewText('');
    }).catch(() => {});
  };

  const handleDelete = (id) => {
    if (!window.confirm('删除这条记忆？')) return;
    api.deleteMemory(id).then(() => {
      setMemories((prev) => prev.filter((m) => m.id !== id));
    }).catch(() => {});
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="memories-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>记忆库</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6L18 18" />
            </svg>
          </button>
        </div>
        <div className="memories-body">
          {loading && <div className="memories-empty">加载中...</div>}
          {!loading && memories.length === 0 && (
            <div className="memories-empty">还没有记忆</div>
          )}
          {memories.map((m) => (
            <div key={m.id} className="memory-card">
              <div className="memory-text">{m.summary}</div>
              <div className="memory-footer">
                <span className="memory-date">
                  {new Date(m.created_at).toLocaleDateString('zh-CN')}
                </span>
                <button className="memory-delete" onClick={() => handleDelete(m.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="memories-input-area">
          <textarea
            className="memories-textarea"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="写入新的记忆..."
            rows={3}
          />
          <button className="save-btn" onClick={handleAdd} disabled={!newText.trim()}>
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
