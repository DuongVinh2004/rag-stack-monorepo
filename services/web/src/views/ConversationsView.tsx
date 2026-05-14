import { useState, useEffect } from 'react';
import { History, MessageSquare, Clock, ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton';

interface Conversation {
  id: string;
  title: string | null;
  status: string;
  lastActivityAt: string;
  createdAt: string;
  kb?: { name: string };
  _count?: { messages: number };
}

export function ConversationsView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchConversations = async () => {
      setIsLoading(true);
      try {
        const data = await apiFetch<Conversation[]>('/conversations');
        setConversations(Array.isArray(data) ? data : []);
      } catch (err: any) {
        setError(err.message || 'Failed to load conversations');
      } finally {
        setIsLoading(false);
      }
    };
    fetchConversations();
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffHours < 1) return `${Math.floor(diffMs / (1000 * 60))} phút trước`;
    if (diffHours < 24) return `${Math.floor(diffHours)} giờ trước`;
    if (diffHours < 48) return 'Hôm qua';
    return date.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' });
  };

  const handleResumeConversation = (conversation: Conversation) => {
    navigate('/chat', { state: { conversationId: conversation.id } });
  };

  return (
    <div className="view-container">
      <div className="glass-panel" style={{ padding: '2rem', minHeight: '600px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <History size={24} />
            Lịch sử hội thoại
          </h2>
          <p style={{ color: 'hsl(var(--text-muted))', marginTop: '0.5rem' }}>
            Tiếp tục các phiên trò chuyện trước đó với cơ sở kiến thức của bạn.
          </p>
        </div>

        {isLoading && (
          <div className="conversations-list" style={{ gap: '1rem' }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="conversation-card" style={{ padding: '1rem', opacity: 1 - i * 0.15, pointerEvents: 'none', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <Skeleton style={{ height: '40px', width: '40px', borderRadius: '8px', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <Skeleton style={{ height: '20px', width: '60%', marginBottom: '0.5rem' }} />
                  <Skeleton style={{ height: '14px', width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="error-banner">{error}</div>
        )}

        {!isLoading && !error && conversations.length === 0 && (
          <div className="conversations-empty">
            <MessageSquare size={48} style={{ opacity: 0.3 }} />
            <h3>Chưa có hội thoại nào</h3>
            <p>Hãy bắt đầu một cuộc trò chuyện mới để khám phá cơ sở kiến thức của bạn.</p>
            <button className="submit-btn" onClick={() => navigate('/chat')}>
              Bắt đầu trò chuyện mới
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {!isLoading && conversations.length > 0 && (
          <div className="conversations-list">
            {conversations.map(conv => (
              <button
                key={conv.id}
                className="conversation-card"
                onClick={() => handleResumeConversation(conv)}
              >
                <div className="conversation-icon">
                  <MessageSquare size={20} />
                </div>
                <div className="conversation-info">
                  <div className="conversation-title">
                    {conv.title || 'Hội thoại không tên'}
                  </div>
                  <div className="conversation-meta">
                    {conv.kb?.name && <span className="conversation-kb">{conv.kb.name}</span>}
                    <span className="conversation-messages">
                      {conv._count?.messages ?? '—'} tin nhắn
                    </span>
                  </div>
                </div>
                <div className="conversation-time">
                  <Clock size={14} />
                  <span>{formatDate(conv.lastActivityAt)}</span>
                </div>
                <ArrowRight size={16} className="conversation-arrow" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
