import { useState, useEffect } from 'react';

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    systemPrompt: '',
    model: '',
    temperature: 0.7,
    contextTurns: 20,
    maxTokens: 4096,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        systemPrompt: settings.systemPrompt || '',
        model: settings.model || '',
        temperature: settings.temperature ?? 0.7,
        contextTurns: settings.contextTurns ?? 20,
        maxTokens: settings.maxTokens ?? 4096,
      });
    }
  }, [settings]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(form);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6L18 18" />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          <div className="field-group">
            <label>System Prompt</label>
            <textarea
              className="settings-textarea"
              value={form.systemPrompt}
              onChange={(e) => handleChange('systemPrompt', e.target.value)}
              rows={6}
            />
          </div>
          <div className="field-group">
            <label>Model</label>
            <input
              type="text"
              className="settings-input"
              value={form.model}
              onChange={(e) => handleChange('model', e.target.value)}
              placeholder="claude-sonnet-4-20250514"
            />
          </div>
          <div className="field-group">
            <label>Temperature: {form.temperature}</label>
            <input
              type="range"
              className="settings-range"
              min="0"
              max="1"
              step="0.05"
              value={form.temperature}
              onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
            />
          </div>
          <div className="field-row">
            <div className="field-group">
              <label>Context Turns</label>
              <input
                type="number"
                className="settings-input"
                value={form.contextTurns}
                onChange={(e) => handleChange('contextTurns', parseInt(e.target.value) || 0)}
                min="1"
                max="100"
              />
            </div>
            <div className="field-group">
              <label>Max Tokens</label>
              <input
                type="number"
                className="settings-input"
                value={form.maxTokens}
                onChange={(e) => handleChange('maxTokens', parseInt(e.target.value) || 0)}
                min="256"
                max="32000"
              />
            </div>
          </div>
        </div>
        <div className="settings-footer">
          <button className="save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
