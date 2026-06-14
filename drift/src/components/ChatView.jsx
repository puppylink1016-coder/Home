import { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function ChatView({ messages, loading, onSend }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      const maxH = 4 * 24;
      textareaRef.current.style.height = Math.min(scrollH, maxH) + 'px';
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, onSend]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-view">
      <div className="messages-container">
        {messages.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <div className="empty-text">开始对话</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={msg.id || i} message={msg} />
        ))}
        {loading && (
          <div className="message-row message-row-ai">
            <div className="avatar avatar-ai">聿</div>
            <div className="message-bubble bubble-ai">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-bar">
        <textarea
          ref={textareaRef}
          className="input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="说点什么..."
          rows={1}
        />
        <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
