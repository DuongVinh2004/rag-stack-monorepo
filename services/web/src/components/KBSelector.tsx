import { Database, ChevronDown } from 'lucide-react';
import { useKB } from '../contexts/KBContext';
import { useState, useRef, useEffect } from 'react';

export function KBSelector() {
  const { knowledgeBases, selectedKB, setSelectedKB, isLoading } = useKB();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isLoading) {
    return (
      <div className="kb-selector loading">
        <Database size={16} />
        <span>Loading KBs...</span>
      </div>
    );
  }

  return (
    <div className="kb-selector-wrapper" ref={ref}>
      <button
        className="kb-selector"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Database size={16} />
        <span className="kb-selector-label">{selectedKB?.name || 'Select Knowledge Base'}</span>
        <ChevronDown size={14} className={`kb-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="kb-dropdown glass-panel">
          {knowledgeBases.length === 0 ? (
            <div className="kb-dropdown-empty">No knowledge bases available</div>
          ) : (
            knowledgeBases.map(kb => (
              <button
                key={kb.id}
                className={`kb-dropdown-item ${selectedKB?.id === kb.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedKB(kb);
                  setOpen(false);
                }}
              >
                <div className="kb-dropdown-name">{kb.name}</div>
                {kb.description && (
                  <div className="kb-dropdown-desc">{kb.description}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
