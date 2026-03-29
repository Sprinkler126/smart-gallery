import React, { useState, useEffect, useCallback } from 'react';
import { Photo, AIAnalysisResult } from '../types';
import { 
  Brain, Settings, Search, Tag, Image, 
  BarChart3, Sparkles, Loader2, X, ChevronRight,
  Star, AlertCircle, CheckCircle, RefreshCw
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
}

interface AnalysisStats {
  totalAnalyzed: number;
  averageQualityScore: number;
  averageAestheticScore: number;
  topCategories: [string, number][];
  topTags: [string, number][];
}

const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({ photo, onClose }) => {
  const [activeTab, setActiveTab] = useState<'analysis' | 'settings' | 'stats' | 'search'>(photo ? 'analysis' : 'search');
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AIConfig>({
    apiEndpoint: '',
    apiKey: '',
    model: 'multimodal-large',
    enableAutoAnalysis: false
  });
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null);
  
  // Batch analysis state
  const [batchProgress, setBatchProgress] = useState<{current: number; total: number; photoId?: string} | null>(null);
  const [batchResults, setBatchResults] = useState<any[]>([]);
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
        setConfig({
          apiEndpoint: data.data.aiApiEndpoint || '',
          apiKey: data.data.aiApiKey ? '••••••••' : '',
          model: data.data.aiModel || 'multimodal-large',
          enableAutoAnalysis: data.data.enableAutoAnalysis || false
        });
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

  const triggerAnalysis = async () => {
    if (!photo) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/photowall/api/analysis/${photo.id}`, { method: 'POST' });
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
      const response = await fetch('/photowall/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiApiEndpoint: config.apiEndpoint,
          aiApiKey: config.apiKey === '••••••••' ? undefined : config.apiKey,
          aiModel: config.model,
          enableAutoAnalysis: config.enableAutoAnalysis
        })
      });
      const data = await response.json();
      if (data.success) {
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
    
    const results = [];
    
    for (let i = 0; i < unanalyzedPhotos.length; i++) {
      const photo = unanalyzedPhotos[i];
      setBatchProgress({ current: i + 1, total: unanalyzedPhotos.length, photoId: photo.id });
      
      try {
        const response = await fetch(`/photowall/api/analysis/${photo.id}`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
          results.push({ photo, success: true, analysis: data.data });
        } else {
          results.push({ photo, success: false, error: data.error });
        }
      } catch (err) {
        results.push({ photo, success: false, error: 'Network error' });
      }
      
      // Small delay to avoid rate limiting
      if (i < unanalyzedPhotos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    setBatchResults(results);
    setBatchProgress(null);
    
    // Refresh stats after batch analysis
    loadStats();
  };

  const testAPI = async () => {
    if (!config.apiEndpoint || !config.apiKey || config.apiKey === '••••••••') {
      setTestResult({ success: false, message: 'Please fill in API endpoint and key' });
      return;
    }
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const response = await fetch('/photowall/api/analysis/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiEndpoint: config.apiEndpoint,
          apiKey: config.apiKey,
          model: config.model
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setTestResult({ success: true, message: `✅ ${data.message} (Model: ${data.model})` });
      } else {
        setTestResult({ success: false, message: `❌ ${data.error}` });
      }
    } catch (err) {
      setTestResult({ success: false, message: `❌ Test failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    } finally {
      setTesting(false);
    }
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
      await fetch('/photowall/api/analysis/cache', { method: 'DELETE' });
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
              onClick={triggerAnalysis}
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
            onClick={triggerAnalysis}
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
      <div>
        <label className="block text-sm text-gray-400 mb-2">API Endpoint</label>
        <input
          type="text"
          value={config.apiEndpoint}
          onChange={(e) => setConfig({ ...config, apiEndpoint: e.target.value })}
          placeholder="https://api.openai.com/v1/chat/completions"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
        />
        <p className="text-xs text-gray-500 mt-1">
          Your multimodal LLM API endpoint (OpenAI compatible)
        </p>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-2">API Key</label>
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          placeholder="sk-..."
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-2">Model</label>
        <input
          type="text"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          placeholder="gpt-4-vision-preview"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="autoAnalysis"
          checked={config.enableAutoAnalysis}
          onChange={(e) => setConfig({ ...config, enableAutoAnalysis: e.target.checked })}
          className="w-4 h-4 rounded border-white/20 bg-white/5 text-gold"
        />
        <label htmlFor="autoAnalysis" className="text-sm text-gray-300">
          Enable auto-analysis for new photos
        </label>
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`p-3 rounded-lg text-sm ${testResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {testResult.message}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={testAPI}
          disabled={testing || !config.apiEndpoint || !config.apiKey}
          className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {testing ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Brain size={16} />
              Test API
            </>
          )}
        </button>
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
