import { useState } from 'react';
import { Database, Loader2, ArrowRight, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';

export function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsSubmitting(true);
    setError('');

    try {
      const data = await apiFetch<{ access_token: string; refresh_token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      
      login(data.access_token, data.refresh_token, data.user);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillDemoCredentials = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('DemoPass1234');
    setError('');
  };

  return (
    <div className="login-container">
      <div className="login-glass-card animate-in">
        <div className="brand-header">
          <div className="logo-container-large">
            <div className="logo-glow-large" />
            <Database size={32} className="logo-icon active" />
          </div>
          <h1>RAG Intelligence</h1>
          <p>Login to your knowledge workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-banner">{error}</div>}
          
          <div className="input-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={isSubmitting}
            />
          </div>

          <button 
            type="submit" 
            className="submit-btn" 
            disabled={isSubmitting || !email || !password}
          >
            {isSubmitting ? (
              <Loader2 className="spinner" size={20} />
            ) : (
              <>
                <span>Secure Login</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {/* Demo Quick Access */}
        <div className="demo-credentials">
          <div className="demo-credentials-header">
            <Info size={14} />
            <span>Demo Accounts</span>
          </div>
          <div className="demo-credentials-list">
            <button type="button" className="demo-credential-btn" onClick={() => fillDemoCredentials('demo-admin@example.com')}>
              <span className="demo-role">Admin</span>
              <span className="demo-email">demo-admin@example.com</span>
            </button>
            <button type="button" className="demo-credential-btn" onClick={() => fillDemoCredentials('demo-editor@example.com')}>
              <span className="demo-role">Editor</span>
              <span className="demo-email">demo-editor@example.com</span>
            </button>
            <button type="button" className="demo-credential-btn" onClick={() => fillDemoCredentials('demo-viewer@example.com')}>
              <span className="demo-role">Viewer</span>
              <span className="demo-email">demo-viewer@example.com</span>
            </button>
          </div>
        </div>

        <div className="login-footer">
          <p>Protected by Enterprise RBAC</p>
        </div>
      </div>
    </div>
  );
}
