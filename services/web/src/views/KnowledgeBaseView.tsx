import { useState, useRef, useEffect } from 'react';
import { UploadCloud, File, CheckCircle2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { KBSelector } from '../components/KBSelector';
import { useKB } from '../contexts/KBContext';
import { Skeleton } from '../components/Skeleton';

export function KnowledgeBaseView() {
  const { selectedKB } = useKB();
  const [isDragOver, setIsDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = async () => {
    if (!selectedKB) return;
    setIsLoadingDocs(true);
    try {
      const data = await apiFetch<any[]>(`/documents?kbId=${selectedKB.id}`);
      setDocuments(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch documents:', e);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [selectedKB?.id]);

  // Auto-poll when documents are processing
  useEffect(() => {
    const hasPending = documents.some(d => ['PROCESSING', 'QUEUED', 'UPLOADED'].includes(d.status));
    if (!hasPending || !selectedKB) return;
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, selectedKB?.id]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
      setStatus('idle');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus('idle');
    }
  };

  const handleUpload = async () => {
    if (!file || isUploading || !selectedKB) return;
    
    setIsUploading(true);
    setStatus('idle');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name);
      formData.append('kbId', selectedKB.id);

      await apiFetch<any>('/documents/upload', {
        method: 'POST',
        body: formData,
      });

      setStatus('success');
      setMessage('Document uploaded & ingestion queued successfully!');
      setTimeout(() => {
        setFile(null);
        setStatus('idle');
        fetchDocuments();
      }, 2000);
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'Error uploading document.');
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusBadge = (docStatus: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      INDEXED: { bg: 'rgba(74, 222, 128, 0.2)', color: '#4ade80' },
      PROCESSING: { bg: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa' },
      QUEUED: { bg: 'rgba(250, 204, 21, 0.2)', color: '#facc15' },
      UPLOADED: { bg: 'rgba(250, 204, 21, 0.2)', color: '#facc15' },
      FAILED: { bg: 'rgba(248, 113, 113, 0.2)', color: '#f87171' },
    };
    const s = styles[docStatus] || styles.QUEUED;
    return (
      <span style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '0.75rem',
        fontWeight: 500,
        background: s.bg,
        color: s.color,
      }}>
        {docStatus}
      </span>
    );
  };

  return (
    <div className="view-container">
      <div className="glass-panel" style={{ padding: '2rem', minHeight: '600px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h2>Quản trị Cơ sở kiến thức</h2>
          <p style={{ color: 'hsl(var(--text-muted))', marginTop: '0.5rem' }}>
            Tải lên, nhúng và quản lý các tài liệu nguồn để mở rộng bộ não RAG.
          </p>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <KBSelector />
        </div>

        {!selectedKB ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--text-muted))' }}>
            <p>Vui lòng chọn một Cơ sở kiến thức để quản lý tài liệu.</p>
          </div>
        ) : (
          <>
            <div className="upload-section">
              <h3>Thêm tài liệu vào "{selectedKB.name}"</h3>
              
              <div 
                className={`dropzone ${isDragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !file && fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleFileSelect}
                  accept=".txt,.pdf,.docx,.md"
                />
                
                {!file ? (
                  <div className="dropzone-content">
                    <div className="upload-icon-wrapper">
                      <UploadCloud size={32} />
                    </div>
                    <h4>Kéo & Thả để tải lên</h4>
                    <p>Hỗ trợ PDF, DOCX, TXT, MD (Tối đa 10MB)</p>
                    <button className="browse-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                      Duyệt tệp tin
                    </button>
                  </div>
                ) : (
                  <div className="file-preview">
                    <File size={32} className="file-icon" />
                    <div className="file-info">
                      <span className="filename">{file.name}</span>
                      <span className="filesize">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <button className="icon-btn remove-btn" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                      Xóa
                    </button>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <button 
                  className="submit-btn" 
                  style={{ margin: 0, width: '200px' }}
                  onClick={handleUpload}
                  disabled={!file || isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={18} className="spinner" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    'Tải lên & Xử lý'
                  )}
                </button>
                
                {status === 'success' && (
                  <div style={{ color: 'hsl(var(--brand-primary-light))', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={18} />
                    <span style={{ fontSize: '0.9rem' }}>{message}</span>
                  </div>
                )}
                
                {status === 'error' && (
                  <div style={{ color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={18} />
                    <span style={{ fontSize: '0.9rem' }}>{message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Existing Documents List */}
            <div style={{ marginTop: '3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3>Danh mục Cơ sở kiến thức</h3>
                <button className="icon-btn" onClick={fetchDocuments} title="Refresh documents">
                  <RefreshCw size={16} className={isLoadingDocs ? 'spinner' : ''} />
                </button>
              </div>
              <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Documents in <strong>{selectedKB.name}</strong> — available to the RAG Chatbot.
              </p>
              <div className="table-responsive">
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', marginTop: '1rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid hsl(var(--border-strong))', color: 'hsl(var(--text-muted))' }}>
                      <th style={{ padding: '0.75rem 0' }}>Tên tệp tin</th>
                      <th>Loại</th>
                      <th>Trạng thái</th>
                      <th>Đã lập chỉ mục lúc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingDocs ? (
                      <>
                        {[1, 2, 3].map(i => (
                          <tr key={i} style={{ borderBottom: '1px solid hsl(var(--border-glass))', opacity: 1 - i * 0.2 }}>
                            <td style={{ padding: '1rem 0' }}><Skeleton style={{ height: '20px', width: '200px' }} /></td>
                            <td><Skeleton style={{ height: '20px', width: '80px' }} /></td>
                            <td><Skeleton style={{ height: '20px', width: '100px', borderRadius: '12px' }} /></td>
                            <td><Skeleton style={{ height: '20px', width: '120px' }} /></td>
                          </tr>
                        ))}
                      </>
                    ) : documents.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: '1rem 0', color: 'hsl(var(--text-muted))', fontStyle: 'italic' }}>
                          No documents ingested yet. Upload one above to get started.
                        </td>
                      </tr>
                    ) : (
                      documents.map((doc: any) => (
                        <tr key={doc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '0.75rem 0', fontWeight: 500 }}>{doc.name}</td>
                          <td style={{ color: 'hsl(var(--text-muted))', fontSize: '0.85rem' }}>{doc.type || '—'}</td>
                          <td>{getStatusBadge(doc.status)}</td>
                          <td style={{ color: 'hsl(var(--text-muted))', fontSize: '0.85rem' }}>
                            {doc.indexedAt ? new Date(doc.indexedAt).toLocaleString() : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
