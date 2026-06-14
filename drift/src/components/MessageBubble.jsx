import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (ref.current) {
      ref.current.classList.add('message-visible');
    }
  }, []);

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-ai'}`} ref={ref}>
      {!isUser && (
        <div className="avatar avatar-ai">
          <img src="/avatar-ai.jpg" alt="聿" />
        </div>
      )}
      <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-ai'}`}>
        <div
          className="message-text"
          dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
        />
        <div className="message-time">{formatTime(message.created_at)}</div>
      </div>
      {isUser && (
        <div className="avatar avatar-user">
          <img src="/avatar-user.jpg" alt="昭" />
        </div>
      )}
    </div>
  );
}
