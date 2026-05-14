import { Settings, Moon, Key } from 'lucide-react';
import { useToast } from '../components/Toast';

export function SettingsView() {
  const { toast } = useToast();

  const handleToggle = () => {
    toast('info', 'Settings are read-only in this demo version.');
  };

  return (
    <div className="view-container">
      <div className="glass-panel" style={{ padding: '2rem', minHeight: '600px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Settings size={24} />
            System Settings
          </h2>
          <p style={{ color: 'hsl(var(--text-muted))', marginTop: '0.5rem' }}>
            Configure application preferences and integrations.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ padding: '1.5rem', background: 'hsl(var(--bg-surface))', borderRadius: 'var(--radius-md)', border: '1px solid hsl(var(--border-glass))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
              <Moon size={20} style={{ color: 'hsl(var(--brand-primary-light))' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Appearance</h3>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500 }}>Dark Theme</div>
                <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>Use dark color palette</div>
              </div>
              <button className="submit-btn" style={{ margin: 0, padding: '6px 12px', opacity: 0.5 }} onClick={handleToggle}>
                Enabled
              </button>
            </div>
          </div>

          <div style={{ padding: '1.5rem', background: 'hsl(var(--bg-surface))', borderRadius: 'var(--radius-md)', border: '1px solid hsl(var(--border-glass))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
              <Key size={20} style={{ color: 'hsl(var(--brand-primary-light))' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>API Keys</h3>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500 }}>OpenAI API Key</div>
                <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>Used for embeddings and chat generation</div>
              </div>
              <button className="icon-btn" onClick={handleToggle}>Manage</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
