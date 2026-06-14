import { useState, useEffect } from 'react';

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    system_prompt: '',
    model: '',
    temperature: 0.7,
    context_turns: 20,
    max_tokens: 4096,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        system_prompt: settings.system_prompt || '',
        model: settings.model || '',
        temperature: settings.temperature ?? 0.7,
        context_turns: settings.context_turns ?? 20,
        max_tokens: settings.max_tokens ?? 4096,
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
              value={form.system_prompt}
              onChange={(e) => handleChange('system_prompt', e.target.value)}
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
                value={form.context_turns}
                onChange={(e) => handleChange('context_turns', parseInt(e.target.value) || 0)}
                min="1"
                max="100"
              />
            </div>
            <div className="field-group">
              <label>Max Tokens</label>
              <input
                type="number"
                className="settings-input"
                value={form.max_tokens}
                onChange={(e) => handleChange('max_tokens', parseInt(e.target.value) || 0)}
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
