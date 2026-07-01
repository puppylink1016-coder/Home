import { useEffect, useRef } from 'react';

const THINKING_MARKER_RE = /^<!--DRIFT_THINKING\n([\s\S]*?)\n-->\n?/;
const THINKING_LEGACY_RE = /^\[THINKING\]([\s\S]*?)\[\/THINKING\]\n?/;
const CJK_CHAR_RE = /[\u3400-\u9fff\u3040-\u30ff]/g;
const LATIN_CHAR_RE = /[A-Za-z]/g;

function extractThinking(text) {
  if (!text) return { thinking: '', content: text };
  const match = text.match(THINKING_MARKER_RE) || text.match(THINKING_LEGACY_RE);
  if (!match) return { thinking: '', content: text };
  return {
    thinking: match[1].trim(),
    content: text.replace(match[0], '').trim(),
  };
}

function isLikelyEnglishThinking(text = '') {
  const value = String(text || '');
  const latin = (value.match(LATIN_CHAR_RE) || []).length;
  const cjk = (value.match(CJK_CHAR_RE) || []).length;
  return (latin >= 12 && cjk === 0) || (latin >= 40 && latin > cjk * 3);
}

function cleanThinkingForDisplay(thinking = '') {
  const clean = String(thinking || '').trim();
  if (!clean || isLikelyEnglishThinking(clean)) return '';
  return clean;
}

function extractImage(text) {
  if (!text) return { imageUrl: null, rest: text };
  const match = text.match(/^!\[image\]\((.*?)\)/);
  if (!match) return { imageUrl: null, rest: text };
  return {
    imageUrl: match[1],
    rest: text.replace(/^!\[image\]\(.*?\)\n?/, '').trim(),
  };
}

function formatContent(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '<br/>')
    .replace(/\n/g, ' ');
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export default function MessageBubble({ message }) {
  const ref = useRef(null);
  const isUser = message.role === 'user';
  const extracted = extractThinking(message.content);
  const thinking = cleanThinkingForDisplay(message.thinking || extracted.thinking);
  const { imageUrl, rest } = extractImage(extracted.content);

  useEffect(() => {
    if (ref.current) {
      ref.current.classList.add('message-visible');
    }
  }, []);

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-ai'}`} ref={ref}>
      <div className="message-stack">
        {!isUser && thinking && (
          <details className="thinking-panel" open>
            <summary className="thinking-title">
              <span className="thinking-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <span>思考过程</span>
            </summary>
            <div
              className="thinking-text"
              dangerouslySetInnerHTML={{ __html: formatContent(thinking) }}
            />
          </details>
        )}
        <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-ai'} ${imageUrl ? 'bubble-has-image' : ''}`}>
          {imageUrl && (
            <img className="message-image" src={imageUrl} alt="" loading="lazy" />
          )}
          {rest && (
            <div
              className="message-text"
              dangerouslySetInnerHTML={{ __html: formatContent(rest) }}
            />
          )}
          {message.streaming && <span className="typing-cursor" />}
          {!message.streaming && <span className="message-time">{formatTime(message.created_at)}</span>}
        </div>
      </div>
    </div>
  );
}
