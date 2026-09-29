import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import fs from 'fs-extra';
import sharp from 'sharp';
import express from 'express';
import Database from 'better-sqlite3';
import { DatabaseService } from '../server/services/databaseService.js';
import { GalleryService } from '../server/services/galleryService.js';
import { createApiRouter } from '../server/routes/api.js';
import { parsePhotoQuery, publicPhoto } from '../server/services/photoQuery.js';
import { buildPhotoLayout, visibleLayoutRange } from '../services/photoLayout.js';

const makePhoto = (index, overrides = {}) => ({
  id: `photo-${String(index).padStart(6, '0')}`, sourceId: 'library', originalPath: `/photos/${index}.jpg`,
  relativePath: `${index}.jpg`, filename: `${index}.jpg`, title: `Photo ${index}`, category: index % 2 ? 'Trips' : 'Family',
  date: '2026-09-01', location: '', latitude: index % 3 ? 30 + (index % 100) / 100 : null,
  longitude: index % 3 ? 120 + (index % 100) / 100 : null,
  exif: {}, dimensions: { width: 1200, height: index % 2 ? 1600 : 800 },
  thumbnailPath: '/cache/thumbnail.jpg', thumbnailFilename: 'thumbnail.jpg', blurPlaceholder: null,
  lastModified: '2026-09-01T00:00:00.000Z', fileSize: 5000, metadataVersion: 1, ...overrides
});

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-gallery-performance-'));
  return { directory, clean: async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('smart-gallery-performance-'));
    await fs.remove(directory);
  } };
}

test('SQLite migration preserves legacy records and supports repeated initialization', async () => {
  const temp = await temporaryDirectory();
  const dbPath = path.join(temp.directory, 'legacy.sqlite');
  let catalog;
  try {
    const legacy = new Database(dbPath);
    legacy.exec(`CREATE TABLE photos (
      id TEXT PRIMARY KEY, source_id TEXT, original_path TEXT UNIQUE, relative_path TEXT, filename TEXT,
      title TEXT, category TEXT, date TEXT, location TEXT, exif_json TEXT, dimensions_json TEXT,
      thumbnail_path TEXT, thumbnail_filename TEXT, blur_placeholder TEXT, last_modified TEXT,
      status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT
    ); INSERT INTO photos (id, source_id, original_path, title) VALUES ('legacy', 'library', '/legacy.jpg', 'Old photo');`);
    legacy.close();
    catalog = new DatabaseService({ database: { path: dbPath } });
    assert.equal(catalog.getPhoto('legacy').title, 'Old photo');
    assert.equal(catalog.getPhoto('legacy').metadataVersion, null);
    catalog.close(); catalog = new DatabaseService({ database: { path: dbPath } });
    assert.equal(catalog.getCatalogStats().totalPhotos, 1);
  } finally { catalog?.close(); await temp.clean(); }
});

test('catalog pagination, filtering, GPS aggregation and cache invalidation', async () => {
  const temp = await temporaryDirectory();
  const catalog = new DatabaseService({ database: { path: path.join(temp.directory, 'catalog.sqlite') } });
  try {
    const photos = Array.from({ length: 20000 }, (_, index) => makePhoto(index));
    photos[0] = makePhoto(0, { latitude: 0, longitude: 0, title: '100%_literal' });
    catalog.upsertPhotos(photos);
    const start = performance.now();
    const first = catalog.queryPhotos({ limit: 120 });
    const second = catalog.queryPhotos({ limit: 120, offset: 120 });
    console.log(`20,000-photo catalog: two 120-record pages in ${(performance.now() - start).toFixed(1)}ms`);
    assert.equal(first.total, 20000); assert.equal(first.photos.length, 120);
    assert.equal(new Set([...first.photos, ...second.photos].map(photo => photo.id)).size, 240);
    assert.equal(catalog.queryPhotos({ category: 'Trips', limit: 10 }).total, 10000);
    assert.equal(catalog.queryPhotos({ q: '100%_literal', limit: 10 }).total, 1);
    assert.equal(catalog.queryPhotos({ ids: [] }).total, 0);
    const queryPlan = catalog.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM photos WHERE status = 'active' ORDER BY date DESC, id ASC LIMIT 120").all();
    assert.ok(queryPlan.some(row => row.detail.includes('USING INDEX')));
    assert.ok(queryPlan.every(row => !row.detail.includes('TEMP B-TREE')), 'pagination must use index order instead of sorting the catalog');
    const viewportPlan = catalog.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM photos WHERE status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN 30 AND 31 AND longitude BETWEEN 120 AND 121").all();
    assert.ok(viewportPlan.some(row => row.detail.includes('latitude>?')), 'map queries must narrow the coordinate range through an index');
    const world = catalog.getMapPoints({ zoom: 2 });
    assert.equal(world.points.reduce((sum, point) => sum + point.count, 0), world.locatedTotal);
    assert.equal(world.total, 20000); assert.ok(world.unlocatedTotal > 0);
    const origin = catalog.getMapPoints({ zoom: 19, bounds: { south: 0, north: 0, west: 0, east: 0 } });
    assert.equal(origin.points.length, 1); assert.equal(origin.points[0].latitude, 0);
    assert.equal(origin.locatedTotal, world.locatedTotal);
    const trips = catalog.getMapPoints({ category: 'Trips', zoom: 2 });
    assert.equal(trips.total, 10000);
    catalog.removePhoto(photos[0].id);
    assert.equal(catalog.queryPhotos({ limit: 1 }).total, 19999);
    assert.equal(catalog.getMapPoints({ zoom: 2 }).total, 19999);
    catalog.upsertPhoto(makePhoto(0, { latitude: 10, longitude: 179.9 }));
    catalog.upsertPhoto(makePhoto(1, { latitude: 10, longitude: -179.9 }));
    assert.equal(catalog.queryPhotos({ bounds: { south: 9, north: 11, west: 179, east: -179 } }).total, 2);
    assert.notEqual(publicPhoto(photos[0]).thumbnail, publicPhoto({ ...photos[0], lastModified: 'changed' }).thumbnail);
  } finally { catalog.close(); await temp.clean(); }
});

test('scan reuses metadata, preserves active caches and reindexes modified files', async () => {
  const temp = await temporaryDirectory();
  const source = path.join(temp.directory, 'photos');
  const cacheDir = path.join(temp.directory, 'cache');
  const catalog = new DatabaseService({ database: { path: path.join(temp.directory, 'catalog.sqlite') } });
  const config = { imageSources: [], thumbnails: { width: 80, quality: 70, format: 'jpeg', cacheDir, autoClean: true, maxCacheSize: 1 }, supportedFormats: ['.jpg'] };
  const gallery = new GalleryService(config, catalog);
  const imagePath = path.join(source, 'test.jpg');
  try {
    await fs.ensureDir(source);
    await sharp({ create: { width: 120, height: 80, channels: 3, background: '#c9a227' } }).jpeg().toFile(imagePath);
    await gallery.addSource({ id: 'library', name: 'Test', type: 'local', path: source, enabled: true, defaultCategory: 'Trips', useFolderAsCategory: false, watch: false });
    const before = catalog.queryPhotos({ limit: 1 }).photos[0];
    assert.equal(before.metadataVersion, 1); assert.equal(gallery.photos.size, 0);
    const timestamp = catalog.db.prepare('SELECT updated_at FROM photos WHERE id = ?').get(before.id).updated_at;
    const process = gallery.imageProcessor.processImage.bind(gallery.imageProcessor);
    let processed = 0;
    gallery.imageProcessor.processImage = async (...args) => { processed++; return process(...args); };
    await Promise.all([gallery.scanSource('library'), gallery.scanSource('library')]);
    assert.equal(processed, 0);
    assert.equal(catalog.db.prepare('SELECT updated_at FROM photos WHERE id = ?').get(before.id).updated_at, timestamp);
    await fs.writeFile(path.join(cacheDir, `thumb_${'f'.repeat(32)}.jpeg`), 'orphan');
    await fs.writeFile(path.join(cacheDir, `blur_${'f'.repeat(32)}.base64`), 'orphan');
    assert.equal(await gallery.cleanThumbnailCache(), 2);
    assert.ok(await fs.pathExists(before.thumbnailPath));
    assert.ok((await fs.readdir(cacheDir)).some(name => name.startsWith('blur_')));
    await fs.utimes(imagePath, new Date(), new Date(Date.now() + 10000));
    await gallery.scanSource('library'); assert.equal(processed, 1);
    const changed = catalog.getPhoto(before.id); assert.notEqual(changed.thumbnailFilename, before.thumbnailFilename);
    assert.equal(await gallery.cleanThumbnailCache(), 2);
    await fs.remove(changed.thumbnailPath);
    const simultaneous = await Promise.all(Array.from({ length: 8 }, () => gallery.imageProcessor.getThumbnail(imagePath)));
    assert.ok(simultaneous.every(result => result?.path === changed.thumbnailPath));
    assert.equal((await sharp(changed.thumbnailPath).metadata()).width, 80);
    assert.ok((await fs.readdir(cacheDir)).every(filename => !filename.endsWith('.tmp')));
    await fs.remove(imagePath); await gallery.scanSource('library');
    assert.equal(gallery.getStats().totalPhotos, 0);
  } finally { catalog.close(); await temp.clean(); }
});

test('virtual layouts bound DOM work and never omit visible photos', () => {
  const photos = Array.from({ length: 10000 }, (_, index) => makePhoto(index));
  for (const mode of ['GRID', 'MASONRY', 'TIMELINE']) {
    for (const width of [360, 900, 1200]) {
      const layout = buildPhotoLayout(photos, width, mode);
      for (const top of [0, 3000, layout.height / 2, layout.height - 1000]) {
        const range = visibleLayoutRange(layout, top, top + 1000);
        assert.ok(range.end - range.start < 100, `${mode}: window is bounded`);
        const visible = new Set(layout.items.slice(range.start, range.end));
        for (const item of layout.items) {
          if (item.y <= top + 1000 && item.y + item.height >= top) assert.ok(visible.has(item), `${mode}: missing visible item`);
        }
      }
      assert.equal(layout.items.filter(item => item.kind === 'photo').length, photos.length);
    }
  }
  const unknown = buildPhotoLayout([makePhoto(0, { date: null }), makePhoto(1, { date: 'invalid' })], 360, 'TIMELINE');
  assert.equal(unknown.items.filter(item => item.kind === 'photo').length, 2);
});

test('HTTP pagination, IDs, map filters and malformed requests', async () => {
  const temp = await temporaryDirectory();
  const catalog = new DatabaseService({ database: { path: path.join(temp.directory, 'catalog.sqlite') } });
  const gallery = new GalleryService({ thumbnails: { cacheDir: path.join(temp.directory, 'cache'), autoClean: false } }, catalog);
  const app = express(); app.use(express.json());
  app.use('/api', createApiRouter(gallery, { cache: new Map() }, {}, {}, { getSession: () => null }));
  const server = app.listen(0, '127.0.0.1');
  try {
    catalog.upsertPhotos(Array.from({ length: 260 }, (_, index) => makePhoto(index)));
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const response = await fetch(`${base}/photos`); const result = await response.json();
    assert.equal(result.data.length, 120); assert.equal(result.pagination.hasMore, true);
    const ids = await (await fetch(`${base}/photos/ids?category=Trips`)).json(); assert.equal(ids.data.length, 130);
    const map = await (await fetch(`${base}/map/points?category=Trips&zoom=3`)).json(); assert.equal(map.data.total, 130);
    const single = await (await fetch(`${base}/photos/${result.data[0].id}`)).json(); assert.equal(single.data.id, result.data[0].id);
    for (const suffix of ['limit=-1', 'limit=0', 'limit=501', 'offset=NaN', 'south=0', 'south=91&north=92&west=0&east=1', 'ids=invalid']) {
      assert.equal((await fetch(`${base}/photos?${suffix}`)).status, 400, suffix);
    }
    assert.throws(() => parsePhotoQuery({ south: '', north: '1', west: '0', east: '1' }));
  } finally { await new Promise(resolve => server.close(resolve)); catalog.close(); await temp.clean(); }
});
