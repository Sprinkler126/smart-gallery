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
import { RedisCacheService } from './services/redisCacheService.js';
import { VectorSearchService } from './services/vectorSearchService.js';
import { createApiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file (look in parent directory)
dotenv.config({ path: path.join(__dirname, '../.env') });

// Load configuration
const configPath = path.join(__dirname, 'config.json');
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
if (process.env.AI_IMAGE_DETAIL) {
  config.aiImageDetail = process.env.AI_IMAGE_DETAIL;
}
if (process.env.AI_MAX_TOKENS) {
  config.aiMaxTokens = Number(process.env.AI_MAX_TOKENS);
}
if (process.env.AI_TEMPERATURE) {
  config.aiTemperature = Number(process.env.AI_TEMPERATURE);
}
if (process.env.MAX_CONCURRENT_ANALYSIS) {
  config.maxConcurrentAnalysis = Number(process.env.MAX_CONCURRENT_ANALYSIS);
}
if (process.env.AI_BATCH_DELAY_MS) {
  config.aiBatchDelayMs = Number(process.env.AI_BATCH_DELAY_MS);
}
if (process.env.ANALYSIS_TIMEOUT_MS) {
  config.analysisTimeout = Number(process.env.ANALYSIS_TIMEOUT_MS);
}

// Log configuration source (without exposing the actual key)
console.log('🔧 Configuration loaded:');
console.log(`   AI Endpoint: ${config.aiApiEndpoint || 'not set'} ${process.env.AI_API_ENDPOINT ? '(from env)' : '(from config)'}`);
console.log(`   AI Key: ${config.aiApiKey ? '***' + config.aiApiKey.slice(-4) : 'not set'} ${process.env.AI_API_KEY ? '(from env)' : '(from config)'}`);
console.log(`   AI Model: ${config.aiModel || 'not set'} ${process.env.AI_MODEL ? '(from env)' : '(from config)'}`);
console.log(`   AI Speed: detail=${config.aiImageDetail || 'low'}, maxTokens=${config.aiMaxTokens || 8000}, concurrent=${config.maxConcurrentAnalysis || 4}`);
console.log(`   Redis Cache: ${(config.redis?.enabled === true || process.env.REDIS_ENABLED === 'true') ? 'enabled' : 'disabled'}`);

// Create Express app
const app = express();
const httpServer = createServer(app);

// Create Socket.IO server for real-time updates
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  path: '/photowall/socket.io'
});

// Initialize Gallery Service
const galleryService = new GalleryService(config);

// Initialize optional Redis cache (disabled by default)
const redisCacheService = new RedisCacheService(config);

// Initialize AI Analysis Service
const aiAnalysisService = new AIAnalysisService(config, redisCacheService);

// Initialize Vector Search Service
const vectorSearchService = new VectorSearchService(config);

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
    thumbnail: `/photowall/api/thumbnail/${photo.id}`,
    title: photo.title,
    category: photo.category,
    date: photo.date,
    location: photo.location,
    exif: photo.exif
  });
});

galleryService.on('photoRemoved', (photoId) => {
  io.emit('photo:removed', { id: photoId });
});

galleryService.on('photoUpdated', (photo) => {
  io.emit('photo:updated', {
    id: photo.id,
    url: `/photowall/api/image/${photo.id}`,
    thumbnail: `/photowall/api/thumbnail/${photo.id}`,
    title: photo.title,
    category: photo.category,
    date: photo.date,
    location: photo.location,
    exif: photo.exif
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
app.use(express.json());

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
app.use('/photowall/api', createApiRouter(galleryService, aiAnalysisService, vectorSearchService, config));

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
    await galleryService.refreshAll();
  });
});

// Initialize and start server
async function start() {
  console.log('🚀 Starting Dynamic Photo Gallery Server...\n');
  
  // Initialize optional Redis cache before services that can use it
  await redisCacheService.connect();
  
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
