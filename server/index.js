/**
 * Dynamic Photo Gallery Server
 * Express server with real-time image source management
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { GalleryService } from './services/galleryService.js';
import { AIAnalysisService } from './services/aiAnalysisService.js';
import { VectorSearchService } from './services/vectorSearchService.js';
import { DatabaseService } from './services/databaseService.js';
import { AuthService } from './services/authService.js';
import { createApiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file (look in parent directory)
dotenv.config({ path: path.join(__dirname, '../.env') });

const mergeConfig = (base, override) => ({
  ...base,
  ...override,
  server: {
    ...(base.server || {}),
    ...(override.server || {})
  },
  thumbnails: {
    ...(base.thumbnails || {}),
    ...(override.thumbnails || {})
  }
});

// Load configuration
const configPath = path.join(__dirname, 'config.json');
const localConfigPath = path.join(__dirname, 'config.local.json');
let config;

try {
  config = await fs.readJson(configPath);
} catch (error) {
  console.error('Failed to load config:', error.message);
  config = {
    appName: "SPRINKLER",
    photographerName: "Sprinkler",
    server: { port: 3001, host: '0.0.0.0' },
    imageSources: [],
    thumbnails: {
      width: 800,
      quality: 80,
      format: 'jpeg',
      cacheDir: './server/cache/thumbnails'
    },
    supportedFormats: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'],
    autoRefreshInterval: 60000,
    enableFileWatcher: true
  };
}

if (await fs.pathExists(localConfigPath)) {
  try {
    const localConfig = await fs.readJson(localConfigPath);
    config = mergeConfig(config, localConfig);
    console.log('🔧 Loaded local config override: server/config.local.json');
  } catch (error) {
    console.error('Failed to load local config override:', error.message);
  }
}

// Override sensitive config with environment variables
// Environment variables take precedence over config.json
if (process.env.AI_API_ENDPOINT) {
  config.aiApiEndpoint = process.env.AI_API_ENDPOINT;
}
if (process.env.AI_API_KEY) {
  config.aiApiKey = process.env.AI_API_KEY;
}
if (process.env.AI_MODEL) {
  config.aiModel = process.env.AI_MODEL;
}

// The managed upload source is always available. Its directory can be moved
// outside the repository in production with UPLOAD_DIR.
config.uploads = {
  sourceId: 'uploads',
  directory: './server/data/uploads',
  maxFiles: 20,
  ...(config.uploads || {})
};
if (process.env.UPLOAD_DIR) {
  config.uploads.directory = process.env.UPLOAD_DIR;
}
config.imageSources = config.imageSources || [];
if (!config.imageSources.some(source => source.id === config.uploads.sourceId)) {
  config.imageSources.push({
    id: config.uploads.sourceId,
    name: 'Uploads',
    type: 'local',
    path: config.uploads.directory,
    enabled: true,
    defaultCategory: 'General',
    useFolderAsCategory: true,
    watch: false
  });
}

// Log configuration source (without exposing the actual key)
console.log('🔧 Configuration loaded:');
console.log(`   AI Endpoint: ${config.aiApiEndpoint || 'not set'} ${process.env.AI_API_ENDPOINT ? '(from env)' : '(from config)'}`);
console.log(`   AI Key: ${config.aiApiKey ? '***' + config.aiApiKey.slice(-4) : 'not set'} ${process.env.AI_API_KEY ? '(from env)' : '(from config)'}`);
console.log(`   AI Model: ${config.aiModel || 'not set'} ${process.env.AI_MODEL ? '(from env)' : '(from config)'}`);

// Create Express app
const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

// Create Socket.IO server for real-time updates
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  path: '/photowall/socket.io'
});

// Initialize SQLite database
const databaseService = new DatabaseService(config, __dirname);
console.log(`🗄️  SQLite database: ${databaseService.dbPath}`);

// Initialize Gallery Service
const galleryService = new GalleryService(config, databaseService);

// Initialize AI Analysis Service
const aiAnalysisService = new AIAnalysisService(config, databaseService);

// Initialize Vector Search Service
const vectorSearchService = new VectorSearchService(config);
const authService = new AuthService();

// Log AI analysis status
if (aiAnalysisService.isAvailable()) {
  console.log('🧠 AI Analysis Service initialized');
  console.log(`   Model: ${config.aiModel || 'default'}`);
  console.log(`   Auto-analysis: ${config.enableAutoAnalysis !== false ? 'enabled' : 'disabled'}`);
} else {
  console.log('🧠 AI Analysis Service not configured');
  console.log('   Set AI_API_ENDPOINT and AI_API_KEY in config.json or environment variables');
}

// Log Vector Search status
console.log('🔍 Vector Search Service initialized');
console.log(`   Indexed: ${vectorSearchService.getStats().totalIndexed} photos`);
console.log('   Model: Universal Sentence Encoder (local)');

// Set up real-time events
galleryService.on('photoAdded', (photo) => {
  io.emit('photo:added', {
    id: photo.id,
    url: `/photowall/api/image/${photo.id}`,
    previewUrl: `/photowall/api/preview/${photo.id}`,
    originalUrl: `/photowall/api/image/${photo.id}`,
    thumbnail: `/photowall/api/thumbnail/${photo.id}`,
    title: photo.title,
    category: photo.category,
    date: photo.date,
    location: photo.location,
    exif: photo.exif,
    dimensions: photo.dimensions,
    sourceId: photo.sourceId
  });

  const autoAnalysis = aiAnalysisService.enqueueAutoAnalysis(photo, {
    onStart: (queuedPhoto) => {
      io.emit('analysis:auto:start', {
        photoId: queuedPhoto.id,
        title: queuedPhoto.title
      });
    },
    onComplete: (queuedPhoto, analysis) => {
      vectorSearchService.scheduleIndex(analysis);
      io.emit('analysis:auto:complete', {
        photoId: queuedPhoto.id,
        title: queuedPhoto.title,
        analyzedAt: analysis.analyzedAt,
        tags: analysis.tags || [],
        category: analysis.category,
        description: analysis.description
      });
    },
    onError: (queuedPhoto, error) => {
      io.emit('analysis:auto:error', {
        photoId: queuedPhoto.id,
        title: queuedPhoto.title,
        error: error.message
      });
    }
  });

  if (autoAnalysis.queued) {
    io.emit('analysis:auto:queued', {
      photoId: photo.id,
      title: photo.title,
      queueLength: autoAnalysis.queueLength,
      active: autoAnalysis.active
    });
  } else if (autoAnalysis.reason !== 'cached') {
    console.log(`🧠 Auto-analysis skipped for ${photo.title}: ${autoAnalysis.reason}`);
  }
});

galleryService.on('photoRemoved', (photoId) => {
  io.emit('photo:removed', { id: photoId });
});

galleryService.on('photoUpdated', (photo) => {
  io.emit('photo:updated', {
    id: photo.id,
    url: `/photowall/api/image/${photo.id}`,
    previewUrl: `/photowall/api/preview/${photo.id}`,
    originalUrl: `/photowall/api/image/${photo.id}`,
    thumbnail: `/photowall/api/thumbnail/${photo.id}`,
    title: photo.title,
    category: photo.category,
    date: photo.date,
    location: photo.location,
    exif: photo.exif,
    dimensions: photo.dimensions,
    sourceId: photo.sourceId
  });
});

galleryService.on('scanStart', (sourceId) => {
  io.emit('scan:start', { sourceId });
});

galleryService.on('scanComplete', (sourceId, count) => {
  io.emit('scan:complete', { sourceId, count });
});

galleryService.on('refreshComplete', () => {
  io.emit('gallery:refreshed', galleryService.getStats());
});

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '6mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.includes('/thumbnail/') && !req.path.includes('/image/')) {
      console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// API Routes - mounted at /photowall/api
app.use('/photowall/api', createApiRouter(galleryService, aiAnalysisService, vectorSearchService, config, authService));

// Serve static files from dist (built frontend) at /photowall
const distPath = path.join(__dirname, '../dist');
if (await fs.pathExists(distPath)) {
  app.use('/photowall', express.static(distPath));
  
  // SPA fallback for /photowall/*
  app.get('/photowall/*', (req, res) => {
    if (!req.path.startsWith('/photowall/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

const isAdminSocket = (socket) => {
  return Boolean(authService.getSessionFromHeaders(socket.handshake.headers));
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`📱 Client connected: ${socket.id}`);
  
  // Send initial stats
  socket.emit('gallery:stats', galleryService.getStats());
  
  socket.on('disconnect', () => {
    console.log(`📴 Client disconnected: ${socket.id}`);
  });

  // Allow clients to request refresh
  socket.on('gallery:refresh', async () => {
    if (!isAdminSocket(socket)) {
      socket.emit('gallery:error', { error: 'Admin access required' });
      return;
    }
    await galleryService.refreshAll();
  });
});

// Initialize and start server
async function start() {
  console.log('🚀 Starting Dynamic Photo Gallery Server...\n');
  
  // Initialize AI analysis service (load cached analyses)
  // Pass __dirname to ensure correct cache path resolution
  await aiAnalysisService.initialize(__dirname);
  
  // Initialize gallery service
  await galleryService.initialize();
  
  // Start server
  const { port, host } = config.server;
  httpServer.listen(port, host, () => {
    console.log(`\n🌐 Server running at http://${host}:${port}`);
    console.log(`📡 API available at http://${host}:${port}/photowall/api`);
    console.log(`🔌 WebSocket enabled for real-time updates\n`);
    console.log('Available endpoints:');
    console.log('  GET  /photowall/api/photos          - Get all photos');
    console.log('  GET  /photowall/api/photos/:id      - Get single photo');
    console.log('  GET  /photowall/api/image/:id       - Get full image');
    console.log('  GET  /photowall/api/thumbnail/:id   - Get thumbnail');
    console.log('  GET  /photowall/api/categories      - Get categories');
    console.log('  GET  /photowall/api/uploads/categories - Get upload categories (admin)');
    console.log('  POST /photowall/api/uploads/categories - Create upload category (admin)');
    console.log('  POST /photowall/api/uploads         - Upload images (admin)');
    console.log('  GET  /photowall/api/sources         - Get image sources');
    console.log('  POST /photowall/api/sources         - Add new source');
    console.log('  POST /photowall/api/sources/:id/scan- Scan a source');
    console.log('  POST /photowall/api/refresh         - Refresh all');
    console.log('  GET  /photowall/api/stats           - Get statistics');
    console.log('  GET  /photowall/api/config          - Get configuration');
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app, galleryService };
