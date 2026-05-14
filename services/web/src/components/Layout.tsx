import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, Database, Settings, Search, LogOut, History, BookOpen, Menu, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useKB } from '../contexts/KBContext';
import { useToast } from './Toast';
import { useRef, useEffect, useState } from 'react';

export function Layout() {
  const { user, logout } = useAuth();
  const { selectedKB } = useKB();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus search input on "/" unless user is already typing somewhere
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = e.currentTarget.value.trim();
      if (value) {
        toast('info', `Search for "${value}" is not fully implemented in this demo.`);
        e.currentTarget.value = '';
        e.currentTarget.blur();
      }
    }
  };

  const initials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : 'U';

  const displayName = user?.email
    ? user.email.split('@')[0].replace(/[.-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'User';

  return (
    <div className="app-layout">
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div 
          className="mobile-backdrop" 
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 15 }}
        />
      )}

      {/* Sidebar - Premium Dark Glass */}
      <aside className={`sidebar glass-panel ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-container">
            <div className="logo-glow" />
            <Database className="logo-icon" />
          </div>
          <h2>RAG Portal</h2>
        </div>
        
        <nav className="sidebar-nav">
          {selectedKB && (
            <div className="kb-context-badge" title="Current Knowledge Base">
              <BookOpen size={14} />
              <span>{selectedKB.name}</span>
            </div>
          )}

          <NavLink to="/chat" onClick={() => setMobileOpen(false)} className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <MessageSquare size={20} />
            <span>Trò chuyện</span>
          </NavLink>
          
          <NavLink to="/conversations" onClick={() => setMobileOpen(false)} className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <History size={20} />
            <span>Lịch sử hội thoại</span>
          </NavLink>
          
          <NavLink to="/kb" onClick={() => setMobileOpen(false)} className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Database size={20} />
            <span>Cơ sở kiến thức</span>
          </NavLink>
          
          <div className="nav-divider" />
          
          <NavLink to="/settings" onClick={() => setMobileOpen(false)} className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Settings size={20} />
            <span>Cài đặt</span>
          </NavLink>
        </nav>
        
        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">{initials}</div>
            <div className="user-info">
              <span className="name">{displayName}</span>
              <span className="role">{user?.email || 'Not signed in'}</span>
            </div>
            <button className="icon-btn logout" onClick={handleLogout} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Top Header - Glassmorphism */}
        <header className="glass-header topbar">
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle Menu">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Tìm kiếm kiến thức hoặc hội thoại (Phím /)" 
              onKeyDown={handleSearch}
            />
          </div>
        </header>

        {/* Dynamic Route Content */}
        <div className="content-scrollarea animate-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

