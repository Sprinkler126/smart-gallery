import React, { useState, useEffect, useCallback } from 'react';
import { Photo, AIAnalysisResult } from '../types';
import { adminFetch } from '../services/adminAuth';
import { 
  Brain, Settings, Search, Tag, Image, 
  BarChart3, Sparkles, Loader2, X, ChevronRight,
  Star, AlertCircle, CheckCircle, RefreshCw,
  GripVertical, Plus, Trash2, Power, FlaskConical
} from 'lucide-react';

interface AIAnalysisPanelProps {
  photo?: Photo;
  onClose: () => void;
}

interface AIConfig {
  apiEndpoint: string;
  apiKey: string;
  model: string;
  enableAutoAnalysis: boolean;
  maxConcurrentAnalysis: number;
  aiProviders: AIProviderConfig[];
}

interface AIProviderConfig {
  id: string;
  name: string;
  apiEndpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  priority: number;
}

interface AnalysisStats {
  totalAnalyzed: number;
  averageQualityScore: number;
  averageAestheticScore: number;
  topCategories: [string, number][];
  topTags: [string, number][];
}

interface BatchJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  currentPhotoId: string | null;
  results: any[];
  error?: string;
}

const normalizeProviderOrder = (providers: AIProviderConfig[]): AIProviderConfig[] =>
  providers.map((provider, index) => ({
    ...provider,
    priority: index,
  }));

const buildProviderJson = (config: Pick<AIConfig, 'enableAutoAnalysis' | 'maxConcurrentAnalysis' | 'aiProviders'>) =>
  JSON.stringify({
    version: 1,
    enableAutoAnalysis: config.enableAutoAnalysis,
    maxConcurrentAnalysis: config.maxConcurrentAnalysis,
    providers: normalizeProviderOrder(config.aiProviders),
  }, null, 2);

const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({ photo, onClose }) => {
  const [activeTab, setActiveTab] = useState<'analysis' | 'settings' | 'stats' | 'search'>(photo ? 'analysis' : 'search');
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AIConfig>({
    apiEndpoint: '',
    apiKey: '',
    model: 'multimodal-large',
    enableAutoAnalysis: false,
    maxConcurrentAnalysis: 2,
    aiProviders: []
  });
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, {success: boolean; message: string}>>({});
  const [dragProviderId, setDragProviderId] = useState<string | null>(null);
  const [providerConfigJson, setProviderConfigJson] = useState('');
  const [providerConfigMessage, setProviderConfigMessage] = useState<{success: boolean; message: string} | null>(null);
  
  // Batch analysis state
  const [batchProgress, setBatchProgress] = useState<{current: number; total: number; photoId?: string} | null>(null);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [unanalyzedPhotos, setUnanalyzedPhotos] = useState<Photo[]>([]);
  const [loadingUnanalyzed, setLoadingUnanalyzed] = useState(false);

  // Load current config
  useEffect(() => {
    loadConfig();
  }, []);

  // Load analysis when photo changes
  useEffect(() => {
    if (photo) {
      loadAnalysis(photo.id);
    }
  }, [photo]);

  // Load unanalyzed photos when in global mode (no photo) and on analysis tab
  useEffect(() => {
    if (!photo && activeTab === 'analysis' && unanalyzedPhotos.length === 0 && !loadingUnanalyzed && !batchProgress && batchResults.length === 0) {
      loadUnanalyzedPhotosFast();
    }
  }, [photo, activeTab]);

  const loadConfig = async () => {
    try {
      const response = await fetch('/photowall/api/config');
      const data = await response.json();
      if (data.success) {
        const nextConfig = {
          apiEndpoint: data.data.aiApiEndpoint || '',
          apiKey: data.data.aiApiKey ? '••••••••' : '',
          model: data.data.aiModel || 'multimodal-large',
          enableAutoAnalysis: data.data.enableAutoAnalysis || false,
          maxConcurrentAnalysis: data.data.maxConcurrentAnalysis || 2,
          aiProviders: normalizeProviderOrder(data.data.aiProviders || [])
        };
        setConfig({
          ...nextConfig
        });
        setProviderConfigJson(buildProviderJson(nextConfig));
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  const loadAnalysis = async (photoId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/photowall/api/analysis/${photoId}`);
      const data = await response.json();
      if (data.success) {
        setAnalysis(data.data);
      } else if (response.status === 503) {
        setError('AI analysis not configured');
      } else {
        setError(data.error || 'Failed to load analysis');
      }
    } catch (err) {
      setError('Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  const triggerAnalysis = async (force = false) => {
    if (!photo) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/photowall/api/analysis/${photo.id}${force ? '?force=true' : ''}`;
      const response = await adminFetch(url, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        setAnalysis(data.data);
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch (err) {
      setError('Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const orderedProviders = normalizeProviderOrder(config.aiProviders);
      const response = await adminFetch('/photowall/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiApiEndpoint: config.apiEndpoint,
          aiApiKey: config.apiKey === '••••••••' ? undefined : config.apiKey,
          aiModel: config.model,
          enableAutoAnalysis: config.enableAutoAnalysis,
          maxConcurrentAnalysis: config.maxConcurrentAnalysis,
          aiProviders: orderedProviders
        })
      });
      const data = await response.json();
      if (data.success) {
        setConfig(prev => ({ ...prev, aiProviders: orderedProviders }));
        setProviderConfigJson(buildProviderJson({ ...config, aiProviders: orderedProviders }));
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      setError('Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const response = await fetch('/photowall/api/analysis/stats');
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load unanalyzed photos (fast batch check)
  const loadUnanalyzedPhotosFast = async () => {
    setLoadingUnanalyzed(true);
    try {
      // Use the efficient batch status API
      const res = await fetch('/photowall/api/analysis/status');
      const data = await res.json();
      
      if (data.success) {
        // Convert to Photo-like objects
        const unanalyzed = data.data.unanalyzedPhotos.map((p: any) => ({
          id: p.id,
          title: p.title,
          thumbnailPath: p.thumbnail,
          originalPath: '',
          category: '',
          date: '',
          location: ''
        }));
        setUnanalyzedPhotos(unanalyzed);
      }
    } catch (err) {
      console.error('Failed to load unanalyzed photos:', err);
    } finally {
      setLoadingUnanalyzed(false);
    }
  };

  // Batch analyze photos
  const performBatchAnalysis = async () => {
    if (unanalyzedPhotos.length === 0) return;
    
    setBatchProgress({ current: 0, total: unanalyzedPhotos.length });
    setBatchResults([]);
    setBatchJob(null);

    try {
      const startResponse = await adminFetch('/photowall/api/analysis/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds: unanalyzedPhotos.map(p => p.id) })
      });
      const startData = await startResponse.json();

      if (!startData.success) {
        throw new Error(startData.error || 'Failed to start batch analysis');
      }

      let job = startData.data as BatchJob;
      setBatchJob(job);

      while (job.status === 'queued' || job.status === 'running') {
        setBatchProgress({
          current: job.completed + job.failed,
          total: job.total,
          photoId: job.currentPhotoId || undefined
        });

        await new Promise(resolve => setTimeout(resolve, 1500));

        const jobResponse = await fetch(`/photowall/api/analysis/jobs/${job.id}`);
        const jobData = await jobResponse.json();
        if (!jobData.success) {
          throw new Error(jobData.error || 'Failed to load analysis job');
        }
        job = jobData.data as BatchJob;
        setBatchJob(job);
      }

      setBatchResults(job.results || []);
    } catch (err) {
      setBatchResults([{
        success: false,
        error: err instanceof Error ? err.message : 'Batch analysis failed'
      }]);
    } finally {
      setBatchProgress(null);
    }
    
    // Refresh stats after batch analysis
    loadStats();
  };

  const updateProviders = (updater: (providers: AIProviderConfig[]) => AIProviderConfig[]) => {
    setConfig(prev => {
      const nextProviders = normalizeProviderOrder(updater(prev.aiProviders));
      const nextConfig = { ...prev, aiProviders: nextProviders };
      setProviderConfigJson(buildProviderJson(nextConfig));
      return nextConfig;
    });
  };

  const addProvider = () => {
    updateProviders(providers => [
      ...providers,
      {
        id: `provider-${Date.now()}`,
        name: `Provider ${providers.length + 1}`,
        apiEndpoint: '',
        apiKey: '',
        model: config.model || 'multimodal-large',
        enabled: true,
        priority: providers.length,
      }
    ]);
  };

  const updateProvider = (id: string, updates: Partial<AIProviderConfig>) => {
    updateProviders(providers => providers.map(provider =>
      provider.id === id ? { ...provider, ...updates } : provider
    ));
  };

  const removeProvider = (id: string) => {
    updateProviders(providers => providers.filter(provider => provider.id !== id));
    setProviderTestResults(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const moveProvider = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    updateProviders(providers => {
      const fromIndex = providers.findIndex(provider => provider.id === fromId);
      const toIndex = providers.findIndex(provider => provider.id === toId);
      if (fromIndex === -1 || toIndex === -1) return providers;

      const next = [...providers];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const testProvider = async (provider: AIProviderConfig) => {
    if (!provider.apiEndpoint || !provider.apiKey) {
      setProviderTestResults(prev => ({
        ...prev,
        [provider.id]: { success: false, message: 'Endpoint and API key are required' }
      }));
      return;
    }

    setTestingProviderId(provider.id);
    setProviderTestResults(prev => {
      const next = { ...prev };
      delete next[provider.id];
      return next;
    });

    try {
      const isSavedMaskedProvider = provider.apiKey === '••••••••';
      const response = await adminFetch('/photowall/api/analysis/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isSavedMaskedProvider
          ? { providerId: provider.id }
          : {
              apiEndpoint: provider.apiEndpoint,
              apiKey: provider.apiKey,
              model: provider.model
            })
      });
      const data = await response.json();
      setProviderTestResults(prev => ({
        ...prev,
        [provider.id]: data.success
          ? { success: true, message: `Connected (${data.model || provider.model})` }
          : { success: false, message: data.error || 'Connection failed' }
      }));
    } catch (err) {
      setProviderTestResults(prev => ({
        ...prev,
        [provider.id]: {
          success: false,
          message: err instanceof Error ? err.message : 'Connection failed'
        }
      }));
    } finally {
      setTestingProviderId(null);
    }
  };

  const exportProviderConfig = async () => {
    setProviderConfigMessage(null);
    try {
      const response = await adminFetch('/photowall/api/analysis/config/export');
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Export failed');
      }

      const json = JSON.stringify(data.data, null, 2);
      setProviderConfigJson(json);

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'smart-gallery-ai-providers.json';
      link.click();
      URL.revokeObjectURL(url);

      setProviderConfigMessage({ success: true, message: 'Provider config exported' });
    } catch (err) {
      setProviderConfigMessage({
        success: false,
        message: err instanceof Error ? err.message : 'Export failed'
      });
    }
  };

  const importProviderConfig = async () => {
    setProviderConfigMessage(null);
    try {
      const parsed = JSON.parse(providerConfigJson);
      const response = await adminFetch('/photowall/api/analysis/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Import failed');
      }

      setProviderConfigMessage({ success: true, message: 'Provider config imported' });
      await loadConfig();
    } catch (err) {
      setProviderConfigMessage({
        success: false,
        message: err instanceof Error ? err.message : 'Import failed'
      });
    }
  };

  const importProviderConfigFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setProviderConfigJson(text);
  };

  const performSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(`/photowall/api/analysis/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.data);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const clearCache = async () => {
    try {
      await adminFetch('/photowall/api/analysis/cache', { method: 'DELETE' });
      setAnalysis(null);
      setStats(null);
    } catch (err) {
      console.error('Failed to clear cache:', err);
    }
  };

  const renderAnalysis = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="relative mb-6">
            <Loader2 size={48} className="animate-spin text-gold" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Brain size={20} className="text-gold/60" />
            </div>
          </div>
          <p className="text-white/90 text-lg mb-2">AI 正在分析中...</p>
          <p className="text-gray-500 text-sm">这可能需要 10-30 秒，请稍候</p>
          <div className="mt-6 flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 bg-gold/60 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle size={48} className="text-red-400 mb-4" />
          <p className="text-red-400 mb-4">{error}</p>
          {error.includes('not configured') ? (
            <button
              onClick={() => setActiveTab('settings')}
              className="px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors"
            >
              Configure API
            </button>
          ) : (
            <button
              onClick={() => triggerAnalysis(true)}
              className="px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors flex items-center gap-2"
            >
              <Sparkles size={16} />
              Try Again
            </button>
          )}
        </div>
      );
    }

    if (!analysis) {
      // Global mode - show batch analysis interface
      if (!photo) {
        return renderBatchAnalysis();
      }
      
      // Single photo mode
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Brain size={48} className="text-gray-600 mb-4" />
          <p className="text-gray-400 mb-2">No analysis yet</p>
          <button
            onClick={triggerAnalysis}
            className="px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors flex items-center gap-2"
          >
            <Sparkles size={16} />
            Analyze Image
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Tags */}
        {analysis.tags && analysis.tags.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
              <Tag size={14} />
              Tags
            </h4>
            <div className="flex flex-wrap gap-2">
              {analysis.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-white/10 text-white/80 text-xs rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Category */}
        {analysis.category && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Image size={14} />
              Category
            </h4>
            <span className="px-3 py-1 bg-gold/20 text-gold text-sm rounded-lg">
              {analysis.category}
            </span>
          </div>
        )}

        {/* Depict - Poetic Description */}
        {analysis.depict && (
          <div className="bg-gradient-to-r from-amber-500/10 to-purple-500/10 rounded-lg p-4 border border-amber-500/20">
            <h4 className="text-sm font-medium text-amber-400 mb-2 flex items-center gap-2">
              <Sparkles size={14} />
              意境
            </h4>
            <p className="text-white/90 text-base leading-relaxed font-light">
              {analysis.depict}
            </p>
          </div>
        )}

        {/* Description */}
        {analysis.description && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Description</h4>
            <p className="text-white/80 text-sm leading-relaxed">
              {analysis.description}
            </p>
          </div>
        )}

        {/* Quality & Aesthetic Scores */}
        <div className="grid grid-cols-2 gap-4">
          {analysis.quality?.score > 0 && (
            <div className="bg-white/5 rounded-lg p-4">
              <h4 className="text-xs font-medium text-gray-400 mb-2">Quality Score</h4>
              <div className="flex items-center gap-2">
                <Star size={16} className="text-gold" />
                <span className="text-2xl font-bold text-white">{analysis.quality.score}</span>
                <span className="text-gray-500 text-sm">/10</span>
              </div>
              {analysis.quality.issues?.length > 0 && (
                <div className="mt-2 text-xs text-red-400">
                  {analysis.quality.issues.join(', ')}
                </div>
              )}
            </div>
          )}

          {analysis.aesthetic?.score > 0 && (
            <div className="bg-white/5 rounded-lg p-4">
              <h4 className="text-xs font-medium text-gray-400 mb-2">Aesthetic Score</h4>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-gold" />
                <span className="text-2xl font-bold text-white">{analysis.aesthetic.score}</span>
                <span className="text-gray-500 text-sm">/10</span>
              </div>
              {analysis.aesthetic.strengths?.length > 0 && (
                <div className="mt-2 text-xs text-green-400">
                  {analysis.aesthetic.strengths.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Technical Analysis */}
        {analysis.technical && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-3">Technical Analysis</h4>
            <div className="space-y-2 text-sm">
              {analysis.technical.composition && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Composition:</span>
                  <span className="text-white/80">{analysis.technical.composition}</span>
                </div>
              )}
              {analysis.technical.lighting && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Lighting:</span>
                  <span className="text-white/80">{analysis.technical.lighting}</span>
                </div>
              )}
              {analysis.technical.focus && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Focus:</span>
                  <span className="text-white/80">{analysis.technical.focus}</span>
                </div>
              )}
              {analysis.technical.exposure && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Exposure:</span>
                  <span className="text-white/80">{analysis.technical.exposure}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Re-analyze button */}
        {photo && (
          <button
            onClick={() => triggerAnalysis(true)}
            className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <RefreshCw size={14} />
            Re-analyze
          </button>
        )}
      </div>
    );
  };

  const renderBatchAnalysis = () => {
    if (loadingUnanalyzed) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-gold mb-4" />
          <p className="text-gray-400">Loading unanalyzed photos...</p>
        </div>
      );
    }

    if (batchProgress) {
      const progressPercent = Math.round((batchProgress.current / batchProgress.total) * 100);
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-6">
          <Loader2 size={48} className="animate-spin text-gold" />
          <div className="text-center">
            <p className="text-white text-lg font-medium mb-2">
              Analyzing... {batchProgress.current} / {batchProgress.total}
            </p>
            <p className="text-gray-400 text-sm">{progressPercent}% complete</p>
          </div>
          <div className="w-full max-w-md bg-white/10 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-gold h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            Please don't close this window
          </p>
        </div>
      );
    }

    if (batchResults.length > 0) {
      const successCount = batchResults.filter(r => r.success).length;
      const failCount = batchResults.filter(r => !r.success).length;
      
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-6">
          <CheckCircle size={48} className="text-green-400" />
          <div className="text-center">
            <p className="text-white text-lg font-medium mb-2">
              Batch Analysis Complete!
            </p>
            <div className="flex items-center justify-center gap-4 text-sm">
              <span className="text-green-400">✓ {successCount} successful</span>
              {failCount > 0 && (
                <span className="text-red-400">✗ {failCount} failed</span>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setBatchResults([]);
              loadUnanalyzedPhotosFast();
            }}
            className="px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors"
          >
            Analyze More
          </button>
        </div>
      );
    }

    if (unanalyzedPhotos.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <CheckCircle size={48} className="text-green-400" />
          <div className="text-center">
            <p className="text-white text-lg font-medium">All photos analyzed!</p>
            <p className="text-gray-400 text-sm mt-1">
              All your photos have been analyzed by AI
            </p>
          </div>
          <button
            onClick={() => loadUnanalyzedPhotosFast()}
            className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6">
        <Brain size={48} className="text-gray-600" />
        <div className="text-center">
          <p className="text-white text-lg font-medium mb-2">
            {unanalyzedPhotos.length} photos need analysis
          </p>
          <p className="text-gray-400 text-sm">
            AI analysis enables semantic search and tagging
          </p>
        </div>
        <button
          onClick={performBatchAnalysis}
          className="px-6 py-3 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors flex items-center gap-2 font-medium"
        >
          <Sparkles size={18} />
          Start Batch Analysis
        </button>
        <p className="text-xs text-gray-500">
          Estimated time: ~{Math.ceil(unanalyzedPhotos.length * 8 / 60)} minutes
        </p>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-white">AI Provider Queue</h3>
          <p className="text-xs text-gray-500 mt-1">
            Drag providers to change fallback order. The first enabled provider is tried first.
          </p>
        </div>
        <button
          onClick={addProvider}
          className="px-3 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors flex items-center gap-2 text-sm"
        >
          <Plus size={16} />
          Add API
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
          <input
            type="checkbox"
            id="autoAnalysis"
            checked={config.enableAutoAnalysis}
            onChange={(e) => {
              const nextConfig = { ...config, enableAutoAnalysis: e.target.checked };
              setConfig(nextConfig);
              setProviderConfigJson(buildProviderJson(nextConfig));
            }}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-gold"
          />
          <span className="text-sm text-gray-300">Enable auto-analysis for new photos</span>
        </label>

        <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
          <label className="block text-xs text-gray-500 mb-2">Auto-analysis concurrency</label>
          <input
            type="number"
            min={1}
            max={5}
            value={config.maxConcurrentAnalysis}
            onChange={(e) => {
              const nextConfig = { ...config, maxConcurrentAnalysis: Math.max(1, Number(e.target.value) || 1) };
              setConfig(nextConfig);
              setProviderConfigJson(buildProviderJson(nextConfig));
            }}
            className="w-24 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gold"
          />
        </div>
      </div>

      <div className="space-y-3">
        {config.aiProviders.length === 0 ? (
          <div className="border border-dashed border-white/15 rounded-lg p-8 text-center">
            <Brain size={40} className="mx-auto text-gray-600 mb-3" />
            <p className="text-white/80">No AI providers configured</p>
            <p className="text-gray-500 text-sm mt-1">Add an OpenAI-compatible vision API to start automatic analysis.</p>
          </div>
        ) : (
          config.aiProviders.map((provider, index) => {
            const result = providerTestResults[provider.id];
            const isTestingThis = testingProviderId === provider.id;

            return (
              <div
                key={provider.id}
                draggable
                onDragStart={() => setDragProviderId(provider.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragProviderId) moveProvider(dragProviderId, provider.id);
                  setDragProviderId(null);
                }}
                onDragEnd={() => setDragProviderId(null)}
                className={`border rounded-lg p-4 bg-white/[0.04] transition-colors ${
                  dragProviderId === provider.id ? 'border-gold/70' : 'border-white/10'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    className="mt-2 text-gray-500 hover:text-white cursor-grab"
                    title="Drag to reorder"
                  >
                    <GripVertical size={18} />
                  </button>

                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-gold/20 text-gold">
                        #{index + 1}
                      </span>
                      <input
                        value={provider.name}
                        onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                        placeholder="Provider name"
                        className="flex-1 min-w-40 bg-transparent border-b border-white/10 px-1 py-1 text-white font-medium focus:outline-none focus:border-gold"
                      />
                      <button
                        onClick={() => updateProvider(provider.id, { enabled: !provider.enabled })}
                        className={`p-2 rounded-lg transition-colors ${
                          provider.enabled ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-gray-500'
                        }`}
                        title={provider.enabled ? 'Enabled' : 'Disabled'}
                      >
                        <Power size={16} />
                      </button>
                      <button
                        onClick={() => removeProvider(provider.id)}
                        className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Remove provider"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Endpoint</label>
                        <input
                          value={provider.apiEndpoint}
                          onChange={(e) => updateProvider(provider.id, { apiEndpoint: e.target.value })}
                          placeholder="https://api.openai.com/v1/chat/completions"
                          className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Model</label>
                        <input
                          value={provider.model}
                          onChange={(e) => updateProvider(provider.id, { model: e.target.value })}
                          placeholder="gpt-4o-mini"
                          className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gold"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">API Key</label>
                      <input
                        type="password"
                        value={provider.apiKey}
                        onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gold"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => testProvider(provider)}
                        disabled={isTestingThis}
                        className="px-3 py-1.5 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                      >
                        {isTestingThis ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <FlaskConical size={14} />
                        )}
                        Test
                      </button>
                      {result && (
                        <span className={`text-xs ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                          {result.message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border border-white/10 rounded-lg p-4 space-y-3 bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium text-white">Provider Queue JSON</h4>
            <p className="text-xs text-gray-500 mt-1">
              Providers are tried by priority; failed calls automatically fall back to the next enabled provider.
            </p>
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {config.aiProviders.filter(p => p.enabled).length} enabled
          </span>
        </div>

        <textarea
          value={providerConfigJson}
          onChange={(e) => setProviderConfigJson(e.target.value)}
          spellCheck={false}
          className="w-full min-h-48 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-gold"
        />

        {providerConfigMessage && (
          <div className={`p-3 rounded-lg text-sm ${providerConfigMessage.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {providerConfigMessage.message}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={exportProviderConfig}
            className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            Export JSON
          </button>
          <label className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors cursor-pointer">
            Import File
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => importProviderConfigFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            onClick={importProviderConfig}
            className="px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors"
          >
            Apply JSON
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Saving...
            </>
          ) : saveSuccess ? (
            <>
              <CheckCircle size={16} />
              Saved!
            </>
          ) : (
            'Save Settings'
          )}
        </button>
        <button
          onClick={clearCache}
          className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );

  const renderStats = () => {
    if (!stats && !loading) {
      loadStats();
    }

    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-gold mb-4" />
          <p className="text-gray-400">Loading statistics...</p>
        </div>
      );
    }

    if (!stats) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <BarChart3 size={48} className="text-gray-600 mb-4" />
          <p className="text-gray-400">No statistics available</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Overview */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/5 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gold">{stats.totalAnalyzed}</div>
            <div className="text-xs text-gray-400">Photos Analyzed</div>
          </div>
          <div className="bg-white/5 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gold">
              {stats.averageQualityScore.toFixed(1)}
            </div>
            <div className="text-xs text-gray-400">Avg Quality</div>
          </div>
          <div className="bg-white/5 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gold">
              {stats.averageAestheticScore.toFixed(1)}
            </div>
            <div className="text-xs text-gray-400">Avg Aesthetic</div>
          </div>
        </div>

        {/* Top Categories */}
        {stats.topCategories?.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-3">Top Categories</h4>
            <div className="space-y-2">
              {stats.topCategories.slice(0, 5).map(([category, count]) => (
                <div key={category} className="flex items-center gap-3">
                  <div className="flex-1 bg-white/5 rounded-full h-2">
                    <div
                      className="bg-gold rounded-full h-2 transition-all"
                      style={{
                        width: `${(count / stats.topCategories[0][1]) * 100}%`
                      }}
                    />
                  </div>
                  <span className="text-sm text-white/80 w-24">{category}</span>
                  <span className="text-xs text-gray-500">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Tags */}
        {stats.topTags?.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-3">Top Tags</h4>
            <div className="flex flex-wrap gap-2">
              {stats.topTags.slice(0, 15).map(([tag, count]) => (
                <span
                  key={tag}
                  className="px-3 py-1 bg-white/5 text-white/70 text-xs rounded-full flex items-center gap-1"
                >
                  {tag}
                  <span className="text-gray-500">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSearch = () => (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && performSearch()}
          placeholder="Search by tags, description, category..."
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
        />
        <button
          onClick={performSearch}
          disabled={searching || !searchQuery.trim()}
          className="px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {searching ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">
            Found {searchResults.length} results
          </p>
          <div className="grid grid-cols-2 gap-2">
            {searchResults.map((result) => (
              <div
                key={result.photo.id}
                className="bg-white/5 rounded-lg p-3 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <div className="aspect-video bg-charcoal rounded mb-2 overflow-hidden">
                  <img
                    src={result.photo.thumbnail}
                    alt={result.photo.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-sm text-white/80 truncate">{result.photo.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gold">
                    {Math.round(result.relevanceScore * 100)}% match
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {searchResults.length === 0 && searchQuery && !searching && (
        <div className="text-center py-8 text-gray-400">
          No results found
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-charcoal border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Brain size={20} className="text-gold" />
            <h2 className="text-lg font-medium text-white">AI Analysis</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs - Show Analysis + Settings when photo is selected, all tabs when no photo */}
        <div className="flex border-b border-white/10">
          {[
            { id: 'analysis', label: 'Analysis', icon: Sparkles },
            ...(photo ? [] : [{ id: 'search', label: 'Search', icon: Search }]),
            ...(photo ? [] : [{ id: 'stats', label: 'Stats', icon: BarChart3 }]),
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'text-gold border-b-2 border-gold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'analysis' && renderAnalysis()}
          {activeTab === 'settings' && renderSettings()}
          {!photo && activeTab === 'stats' && renderStats()}
          {!photo && activeTab === 'search' && renderSearch()}
        </div>
      </div>
    </div>
  );
};

export default AIAnalysisPanel;
