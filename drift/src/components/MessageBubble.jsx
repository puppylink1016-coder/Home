import { useState, useEffect, useRef } from 'react';

function extractImage(text) {
  if (!text) return { imageUrl: null, rest: text };
  const match = text.match(/^!\[image\]\((.*?)\)/);
  if (!match) return { imageUrl: null, rest: text };
  return {
    imageUrl: match[1],
    rest: text.replace(/^!\[image\]\(.*?\)\n?/, '').trim(),
  };
}

function extractThinking(text) {
  if (!text) return { thinking: null, rest: text };
  const match = text.match(/^\[THINKING\]([\s\S]*?)\[\/THINKING\]\n?/);
  if (!match) return { thinking: null, rest: text };
  return {
    thinking: match[1],
    rest: text.slice(match[0].length),
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

function ThinkingBlock({ content, active }) {
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  if (!content) return null;

  return (
    <div className={`thinking-block ${expanded ? 'thinking-expanded' : ''}`}>
      <button className="thinking-toggle" onClick={() => setExpanded(v => !v)}>
        <svg className="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>{active ? 'Thinking…' : 'Thought process'}</span>
        <svg className={`thinking-arrow ${expanded ? 'arrow-up' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="thinking-content">
          <div dangerouslySetInnerHTML={{ __html: formatContent(content) }} />
        </div>
      )}
    </div>
  );
}

export default function MessageBubble({ message }) {
  const ref = useRef(null);
  const isUser = message.role === 'user';

  const storedThinking = !isUser ? extractThinking(message.content) : { thinking: null, rest: message.content };
  const thinking = message.thinking || storedThinking.thinking;
  const contentAfterThinking = message.thinking ? message.content : storedThinking.rest;
  const { imageUrl, rest } = extractImage(contentAfterThinking);

  useEffect(() => {
    if (ref.current) {
      ref.current.classList.add('message-visible');
    }
  }, []);

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-ai'}`} ref={ref}>
      {thinking && (
        <div className="thinking-wrapper">
          <ThinkingBlock content={thinking} active={!!message.thinkingActive} />
        </div>
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
        {message.streaming && !message.thinkingActive && <span className="typing-cursor" />}
        {!message.streaming && <span className="message-time">{formatTime(message.created_at)}</span>}
      </div>
    </div>
  );
}
