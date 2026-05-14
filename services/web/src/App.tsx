import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ChatView } from './views/ChatView';
import { KnowledgeBaseView } from './views/KnowledgeBaseView';
import { ConversationsView } from './views/ConversationsView';
import { NotFoundView } from './views/NotFoundView';
import { LoginView } from './views/LoginView';
import { SettingsView } from './views/SettingsView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { KBProvider } from './contexts/KBContext';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'hsl(215 20.2% 65.1%)',
        gap: '12px',
      }}>
        <div className="spinner" style={{ width: 24, height: 24, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
        <span>Initializing...</span>
      </div>
    );
  }
  
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRouter() {
  const { isAuthenticated } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/chat" replace /> : <LoginView />} />
      
      <Route path="/" element={
        <RequireAuth>
          <KBProvider>
            <Layout />
          </KBProvider>
        </RequireAuth>
      }>
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="chat" element={<ChatView />} />
        <Route path="conversations" element={<ConversationsView />} />
        <Route path="kb" element={<KnowledgeBaseView />} />
        <Route path="settings" element={<SettingsView />} />
      </Route>

      {/* Catch-all 404 */}
      <Route path="*" element={<NotFoundView />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
