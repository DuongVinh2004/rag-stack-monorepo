import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, FileText, Loader2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { KBSelector } from '../components/KBSelector';
import { useKB } from '../contexts/KBContext';

/** Lightweight inline markdown: **bold**, `code`, [link](url) */
function renderMarkdown(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`[^`]+`|\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>;
    }
    return part;
  });
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ id: string; snippet: string; score: number }>;
}

export function ChatView() {
  const { selectedKB } = useKB();
  const location = useLocation();
  const resumedConversationId = (location.state as any)?.conversationId;

  const [messages, setMessages] = useState<Message[]>([{
    id: '1',
    role: 'assistant',
    content: 'Chào! Tôi đã kết nối với cơ sở kiến thức RAG của bạn. Hãy chọn một cơ sở kiến thức ở trên và hỏi tôi bất cứ điều gì.'
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(resumedConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load messages when resuming a conversation
  useEffect(() => {
    if (resumedConversationId) {
      loadConversationHistory(resumedConversationId);
    }
  }, [resumedConversationId]);

  const loadConversationHistory = async (convId: string) => {
    try {
      setIsLoading(true);
      const data = await apiFetch<any[]>(`/conversations/${convId}/messages`);
      const loadedMessages: Message[] = (Array.isArray(data) ? data : []).map((msg: any) => ({
        id: msg.id,
        role: msg.role === 'USER' ? 'user' : 'assistant',
        content: msg.content,
        citations: msg.citations?.map((c: any) => ({
          id: c.id,
          snippet: c.snippet,
          score: c.score,
        })),
      }));
      if (loadedMessages.length > 0) {
        setMessages(loadedMessages);
      }
    } catch (err) {
      console.error('Failed to load conversation history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!selectedKB && !conversationId) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '**Vui lòng chọn một Cơ sở kiến thức** từ danh sách phía trên trước khi bắt đầu trò chuyện.'
      }]);
      return;
    }

    const userMsg = input.trim();
    setInput('');
    
    // Add user message to UI immediately
    const userMsgObj: Message = { id: Date.now().toString(), role: 'user', content: userMsg };
    setMessages(prev => [...prev, userMsgObj]);
    setIsLoading(true);

    try {
      const payload: Record<string, string> = { question: userMsg };
      if (conversationId) {
        payload.conversationId = conversationId;
      } else if (selectedKB) {
        payload.kbId = selectedKB.id;
      }

      const data = await apiFetch<any>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
      }

      const assistantMsg: Message = {
        id: data.messageId || (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer,
        citations: data.citations?.map((c: any) => ({
          id: c.chunkId || Math.random().toString(),
          snippet: c.snippet,
          score: c.relevanceScore ?? c.score ?? 0
        }))
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `**Error:** ${err.message || 'Failed to communicate with RAG engine'}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="view-container chat-view">
      <div className="chat-kb-bar">
        <KBSelector />
        {conversationId && (
          <button
            className="new-chat-btn"
            onClick={() => {
              setConversationId(undefined);
              setMessages([{
                id: '1',
                role: 'assistant',
                content: 'New conversation started. How can I help you?'
              }]);
            }}
          >
            Trò chuyện mới
          </button>
        )}
      </div>

      <div className="chat-history glass-panel" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble-wrapper ${msg.role}`}>
            <div className={`avatar-icon ${msg.role}`}>
              {msg.role === 'assistant' ? <Bot size={20} /> : <User size={20} />}
            </div>
            
            <div className="chat-bubble">
              <div className="message-content">{renderMarkdown(msg.content)}</div>
              
              {/* Citations / Grounding rendering */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="citations-tray">
                  <span className="citations-title">Nguồn trích dẫn:</span>
                  <div className="citations-list">
                    {msg.citations.map((c, i) => (
                      <div key={c.id} className="citation-pill" title={c.snippet}>
                        <FileText size={12} />
                        <span>Nguồn {i + 1}</span>
                        <span className="citation-score">{(c.score * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat-bubble-wrapper assistant">
            <div className="avatar-icon assistant">
              <Bot size={20} />
            </div>
            <div className="chat-bubble loading">
              <Loader2 className="spinner" size={20} />
              <span>Đang phân tích cơ sở kiến thức...</span>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-area glass-panel">
        <form onSubmit={handleSubmit} className="chat-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedKB ? `Hỏi về ${selectedKB.name}...` : 'Chọn một KB trước...'}
            disabled={isLoading}
            autoFocus
          />
          <button type="submit" disabled={isLoading || !input.trim()} className="send-btn">
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
