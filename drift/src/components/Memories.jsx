import { useState, useEffect } from 'react';
import * as api from '../api.js';

export default function Memories({ onClose }) {
  const [tab, setTab] = useState('ombre');
  const [staticMems, setStaticMems] = useState([]);
  const [ombreStats, setOmbreStats] = useState(null);
  const [ombreList, setOmbreList] = useState([]);
  const [newText, setNewText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState('');
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [showList, setShowList] = useState(false);

  function parseOmbreStats(raw) {
    if (!raw) return null;
    const fixedMatch = raw.match(/固化记忆桶:\s*(\d+)/);
    const dynamicMatch = raw.match(/动态记忆桶:\s*(\d+)/);
    const archiveMatch = raw.match(/归档记忆桶:\s*(\d+)/);
    const sizeMatch = raw.match(/总存储大小:\s*([\d.]+\s*\w+)/);
    const decayMatch = raw.match(/衰减引擎:\s*(\S+)/);
    const total = (fixedMatch ? parseInt(fixedMatch[1]) : 0)
      + (dynamicMatch ? parseInt(dynamicMatch[1]) : 0)
      + (archiveMatch ? parseInt(archiveMatch[1]) : 0);
    return {
      count: total,
      size: sizeMatch ? sizeMatch[1] : '未知',
      decay: decayMatch ? decayMatch[1] : '未知',
    };
  }


  useEffect(() => {
    if (tab === 'static') {
      setLoading(true);
      api.getMemories().then((data) => {
        setStaticMems(Array.isArray(data) ? data : []);
      }).catch(() => {}).finally(() => setLoading(false));
    } else {
      setLoading(true);
      api.getOmbreMemories().then((data) => {
        setOmbreStats(parseOmbreStats(data.raw));
      }).catch(() => setOmbreStats(null)).finally(() => setLoading(false));
    }
  }, [tab]);

  const loadAllMemories = () => {
    setListLoading(true);
    setShowList(true);
    api.getAllOmbreMemories().then((data) => {
      setOmbreList(data.items || []);
    }).catch(() => setOmbreList([])).finally(() => setListLoading(false));
  };

  const handleAddOmbre = () => {
    const text = newText.trim();
    if (!text) return;
    api.addOmbreMemory(text).then(() => {
      setNewText('');
      api.getOmbreMemories().then((data) => setOmbreStats(parseOmbreStats(data.raw)));
      if (showList) loadAllMemories();
    }).catch(() => {});
  };

  const handleAddStatic = () => {
    const text = newText.trim();
    if (!text) return;
    api.addMemory(text).then((data) => {
      setStaticMems((prev) => [...prev, data]);
      setNewText('');
    }).catch(() => {});
  };

  const handleDeleteStatic = (id) => {
    if (!window.confirm('删除这条记忆？')) return;
    api.deleteMemory(id).then(() => {
      setStaticMems((prev) => prev.filter((m) => m.id !== id));
    }).catch(() => {});
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    api.searchOmbreMemories(searchQuery).then((data) => {
      setSearchResult(data.result || '没有找到相关记忆');
    }).catch(() => setSearchResult('搜索失败'));
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

        <div className="mem-tabs">
          <button
            className={`mem-tab ${tab === 'ombre' ? 'mem-tab-active' : ''}`}
            onClick={() => setTab('ombre')}
          >
            语义记忆
          </button>
          <button
            className={`mem-tab ${tab === 'static' ? 'mem-tab-active' : ''}`}
            onClick={() => setTab('static')}
          >
            核心记忆
          </button>
        </div>

        <div className="memories-body">
          {loading && <div className="memories-empty">加载中...</div>}

          {!loading && tab === 'ombre' && (
            <>
              <div className="ombre-stats">
                {ombreStats ? (
                  <>
                    <span className="ombre-stat">{ombreStats.count} 条记忆</span>
                    <span className="ombre-stat">{ombreStats.size}</span>
                    <span className="ombre-stat-dot" />
                    <span className="ombre-stat">{ombreStats.decay}</span>
                  </>
                ) : (
                  <span className="ombre-stat">未连接</span>
                )}
              </div>

              {!showList && (
                <button className="ombre-show-all" onClick={loadAllMemories}>
                  查看全部记忆
                </button>
              )}

              {showList && listLoading && (
                <div className="memories-empty">加载记忆中...</div>
              )}

              {showList && !listLoading && ombreList.length === 0 && (
                <div className="memories-empty">暂无记忆内容</div>
              )}

              {showList && !listLoading && ombreList.map((m, i) => (
                <div key={m.id || i} className="memory-card">
                  <div className="memory-text">{m.content}</div>
                </div>
              ))}

              <div className="mem-search-row">
                <input
                  className="settings-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索记忆..."
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button className="save-btn" onClick={handleSearch}>搜索</button>
              </div>
              {searchResult && (
                <div className="memory-card">
                  <div className="memory-label">搜索结果</div>
                  <div className="memory-text">{searchResult}</div>
                </div>
              )}
            </>
          )}

          {!loading && tab === 'static' && (
            <>
              {staticMems.length === 0 && (
                <div className="memories-empty">还没有核心记忆</div>
              )}
              {staticMems.map((m) => (
                <div key={m.id} className="memory-card">
                  <div className="memory-text">{m.summary}</div>
                  <div className="memory-footer">
                    <span className="memory-date">
                      {new Date(m.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    <button className="memory-delete" onClick={() => handleDeleteStatic(m.id)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="memories-input-area">
          <textarea
            className="memories-textarea"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder={tab === 'ombre' ? '写入新的语义记忆...' : '写入核心记忆（每次对话全量加载）...'}
            rows={3}
          />
          <button
            className="save-btn"
            onClick={tab === 'ombre' ? handleAddOmbre : handleAddStatic}
            disabled={!newText.trim()}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
