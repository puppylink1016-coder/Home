import { useEffect, useState } from 'react';
import * as api from '../api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function formatMurmurTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    system_prompt: '',
    model: '',
    temperature: 0.7,
    context_turns: 20,
    max_tokens: 4096,
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState({
    supported: false,
    subscribed: false,
    permission: 'default',
    endpoint: '',
    message: '',
  });
  const [murmurBusy, setMurmurBusy] = useState(false);
  const [murmurStatus, setMurmurStatus] = useState('');
  const [murmurs, setMurmurs] = useState([]);

  const loadMurmurs = async ({ silent = false } = {}) => {
    try {
      const data = await api.getMurmurs(5);
      setMurmurs(Array.isArray(data) ? data : []);
      if (!silent) setMurmurStatus('');
    } catch (err) {
      if (!silent) setMurmurStatus(err?.message || '读取失败。');
    }
  };

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

  useEffect(() => {
    let active = true;
    const supported = pushSupported();

    if (!supported) {
      setPushStatus((prev) => ({
        ...prev,
        supported: false,
        message: '当前浏览器不支持通知。',
      }));
      return;
    }

    navigator.serviceWorker.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (!active) return;
      setPushStatus({
        supported: true,
        subscribed: Boolean(subscription),
        permission: Notification.permission,
        endpoint: subscription?.endpoint || '',
        message: subscription ? '通知已开启。' : '',
      });
    }).catch(() => {
      if (!active) return;
      setPushStatus({
        supported: true,
        subscribed: false,
        permission: Notification.permission,
        endpoint: '',
        message: '',
      });
    });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    loadMurmurs({ silent: true });
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(form);
  };

  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushStatus((prev) => ({ ...prev, message: '' }));

    try {
      if (!pushSupported()) {
        throw new Error('当前浏览器不支持通知。');
      }

      const keyInfo = await api.getPushPublicKey();
      if (!keyInfo.configured || !keyInfo.publicKey) {
        throw new Error(keyInfo.hint || '推送服务还没有配置。');
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('通知权限没有开启。');
      }

      await navigator.serviceWorker.register('/sw.js');
      const readyRegistration = await navigator.serviceWorker.ready;
      const existing = await readyRegistration.pushManager.getSubscription();
      const subscription = existing || await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyInfo.publicKey),
      });

      await api.subscribePush(subscription.toJSON());
      setPushStatus({
        supported: true,
        subscribed: true,
        permission,
        endpoint: subscription.endpoint,
        message: '通知已开启。',
      });
    } catch (err) {
      setPushStatus((prev) => ({
        ...prev,
        supported: pushSupported(),
        permission: pushSupported() ? Notification.permission : 'default',
        message: err?.message || '通知开启失败。',
      }));
    } finally {
      setPushBusy(false);
    }
  };

  const getCurrentSubscription = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.pushManager.getSubscription();
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    setPushStatus((prev) => ({ ...prev, message: '' }));

    try {
      const subscription = await getCurrentSubscription();
      const endpoint = subscription?.endpoint || pushStatus.endpoint;
      if (!endpoint) throw new Error('还没有通知订阅。');
      const result = await api.testPush(endpoint);
      if (!result.success) throw new Error('测试推送没有发出。');
      setPushStatus((prev) => ({ ...prev, message: '测试推送已发送。' }));
    } catch (err) {
      setPushStatus((prev) => ({ ...prev, message: err?.message || '测试推送失败。' }));
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setPushStatus((prev) => ({ ...prev, message: '' }));

    try {
      const subscription = await getCurrentSubscription();
      const endpoint = subscription?.endpoint || pushStatus.endpoint;
      if (endpoint) await api.unsubscribePush(endpoint);
      if (subscription) await subscription.unsubscribe();
      setPushStatus({
        supported: pushSupported(),
        subscribed: false,
        permission: pushSupported() ? Notification.permission : 'default',
        endpoint: '',
        message: '通知已关闭。',
      });
    } catch (err) {
      setPushStatus((prev) => ({ ...prev, message: err?.message || '关闭失败。' }));
    } finally {
      setPushBusy(false);
    }
  };

  const handleRunMurmur = async () => {
    setMurmurBusy(true);
    setMurmurStatus('');

    try {
      const result = await api.runMurmur({ force: true, push: true, source: 'manual' });
      if (result.skipped) {
        setMurmurStatus(`这次没发：${result.reason || '模型选择跳过'}`);
      } else if (result.pushed || result.push?.sent > 0) {
        setMurmurStatus('已发到手机。');
      } else {
        setMurmurStatus('已生成，但没有可用通知订阅。');
      }
      await loadMurmurs({ silent: true });
    } catch (err) {
      setMurmurStatus(err?.message || '触发失败。');
    } finally {
      setMurmurBusy(false);
    }
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
          <div className="field-group push-settings">
            <label>Push Notifications</label>
            <div className="push-row">
              <button
                className="save-btn"
                onClick={handleEnablePush}
                disabled={pushBusy || !pushStatus.supported || pushStatus.subscribed}
              >
                Enable
              </button>
              <button
                className="secondary-btn"
                onClick={handleTestPush}
                disabled={pushBusy || !pushStatus.subscribed}
              >
                Test
              </button>
              <button
                className="secondary-btn"
                onClick={handleDisablePush}
                disabled={pushBusy || !pushStatus.subscribed}
              >
                Off
              </button>
            </div>
            <div className={`push-status ${pushStatus.message && !pushStatus.subscribed ? 'push-status-warn' : ''}`}>
              {pushBusy ? 'Working...' : (pushStatus.message || (pushStatus.subscribed ? 'Ready.' : 'Off.'))}
            </div>
          </div>
          <div className="field-group murmur-settings">
            <label>主动碎碎念</label>
            <div className="push-row">
              <button
                className="save-btn"
                onClick={handleRunMurmur}
                disabled={murmurBusy}
              >
                现在试一次
              </button>
              <button
                className="secondary-btn"
                onClick={() => loadMurmurs()}
                disabled={murmurBusy}
              >
                刷新
              </button>
            </div>
            <div className={`push-status ${murmurStatus.includes('失败') || murmurStatus.includes('没有') ? 'push-status-warn' : ''}`}>
              {murmurBusy ? 'Thinking...' : (murmurStatus || 'Ready.')}
            </div>
            {murmurs.length > 0 && (
              <div className="murmur-list">
                {murmurs.map((murmur) => (
                  <div className="murmur-item" key={murmur.id}>
                    <div className="murmur-content">{murmur.content}</div>
                    <div className="murmur-meta">
                      {formatMurmurTime(murmur.created_at)}
                      {murmur.pushed ? ' · pushed' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="settings-footer">
          <button className="save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
