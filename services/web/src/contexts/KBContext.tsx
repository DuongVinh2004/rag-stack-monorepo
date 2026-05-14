import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from './AuthContext';

export interface KnowledgeBase {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibility: string;
}

interface KBContextType {
  knowledgeBases: KnowledgeBase[];
  selectedKB: KnowledgeBase | null;
  setSelectedKB: (kb: KnowledgeBase) => void;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const KBContext = createContext<KBContextType | undefined>(undefined);

export function KBProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKBs = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<KnowledgeBase[]>('/knowledge-bases');
      const items = Array.isArray(data) ? data : [];
      setKnowledgeBases(items);
      
      // Auto-select first KB if none selected
      if (!selectedKB && items.length > 0) {
        setSelectedKB(items[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load knowledge bases');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchKBs();
  }, [fetchKBs]);

  return (
    <KBContext.Provider value={{
      knowledgeBases,
      selectedKB,
      setSelectedKB,
      isLoading,
      error,
      refresh: fetchKBs,
    }}>
      {children}
    </KBContext.Provider>
  );
}

export function useKB() {
  const context = useContext(KBContext);
  if (context === undefined) {
    throw new Error('useKB must be used within a KBProvider');
  }
  return context;
}
