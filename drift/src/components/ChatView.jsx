import { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function ChatView({ messages, loading, onSend, uploading }) {
  const [input, setInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [sendError, setSendError] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);

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

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendError('');
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  };

  const clearImage = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && !imageFile) return;
    setSendError('');
    try {
      await onSend(trimmed, imageFile);
      setInput('');
      clearImage();
    } catch (err) {
      setSendError(err?.message || '图片发送失败，请再试一次。');
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, imageFile, onSend]);

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
      {imagePreview && (
        <div className="image-preview-bar">
          <div className="image-preview-thumb">
            <img src={imagePreview} alt="preview" />
            <button className="image-preview-remove" onClick={clearImage}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {sendError && (
        <div className="send-error" role="status">
          {sendError}
        </div>
      )}
      <div className="input-bar">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleImageSelect}
        />
        <button className="image-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          className="input-field"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (sendError) setSendError('');
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={(!input.trim() && !imageFile) || uploading}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
