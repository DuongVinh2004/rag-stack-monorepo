import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export function NotFoundView() {
  const navigate = useNavigate();

  return (
    <div className="login-container">
      <div className="login-glass-card animate-in" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', fontWeight: 700, opacity: 0.2, marginBottom: '0.5rem' }}>
          404
        </div>
        <h2>Page Not Found</h2>
        <p style={{ color: 'hsl(var(--text-muted))', marginTop: '0.5rem', marginBottom: '2rem' }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button className="submit-btn" onClick={() => navigate('/chat')}>
            <Home size={18} />
            <span>Go to Chat</span>
          </button>
          <button className="new-chat-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    </div>
  );
}
