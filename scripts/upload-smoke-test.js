import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import fs from 'fs-extra';
import sharp from 'sharp';
import { createApiRouter } from '../server/routes/api.js';

const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-gallery-upload-'));
let scanCount = 0;
let failNextScan = false;

const galleryService = {
  scanSource: async (sourceId) => {
    assert.equal(sourceId, 'uploads');
    scanCount += 1;
    if (failNextScan) {
      failNextScan = false;
      throw new Error('simulated index failure');
    }
    return [];
  }
};
const aiAnalysisService = { cache: new Map() };
const vectorSearchService = {};
const authService = {
  getSession: req => req.headers['x-test-admin'] === 'yes' ? { role: 'admin' } : null,
  isConfigured: () => true
};
const config = {
  supportedFormats: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'],
  // Legacy maxFileSizeMB is intentionally ignored: application-level uploads
  // have no single-file size cap.
  uploads: { sourceId: 'uploads', directory: uploadRoot, maxFileSizeMB: 1, maxFiles: 2 }
};

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(galleryService, aiAnalysisService, vectorSearchService, config, authService));
const server = app.listen(0, '127.0.0.1');

try {
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const unauthenticated = await fetch(`${baseUrl}/uploads/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Trips' })
  });
  assert.equal(unauthenticated.status, 401);

  const invalidCategory = await fetch(`${baseUrl}/uploads/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' },
    body: JSON.stringify({ name: '../escape' })
  });
  assert.equal(invalidCategory.status, 400);

  const categoryResponse = await fetch(`${baseUrl}/uploads/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' },
    body: JSON.stringify({ name: 'Trips' })
  });
  assert.equal(categoryResponse.status, 201);

  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#c9a227' }
  }).png().toBuffer();
  const validForm = new FormData();
  validForm.append('category', 'Trips');
  validForm.append('images', new Blob([png], { type: 'image/png' }), 'phone.png');
  const uploadResponse = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'x-test-admin': 'yes' },
    body: validForm
  });
  assert.equal(uploadResponse.status, 201);
  const uploadResult = (await uploadResponse.json()).data;
  assert.equal(uploadResult.count, 1);
  assert.equal(uploadResult.original, true);
  assert.equal(uploadResult.indexed, true);
  const storedPng = await fs.readFile(path.join(uploadRoot, 'Trips', uploadResult.files[0]));
  assert.deepEqual(storedPng, png, 'stored image must be byte-for-byte identical to the original');
  assert.equal(scanCount, 1);

  const largePng = await sharp(crypto.randomBytes(1024 * 1024 * 3), {
    raw: { width: 1024, height: 1024, channels: 3 }
  }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(largePng.length > 1024 * 1024);
  failNextScan = true;
  const retryForm = new FormData();
  retryForm.append('category', 'Trips');
  retryForm.append('images', new Blob([largePng], { type: 'image/png' }), 'large-preserved.png');
  const retryResponse = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'x-test-admin': 'yes' },
    body: retryForm
  });
  assert.equal(retryResponse.status, 201);
  const retryResult = (await retryResponse.json()).data;
  assert.equal(retryResult.indexed, false);
  const storedLargePng = await fs.readFile(path.join(uploadRoot, 'Trips', retryResult.files[0]));
  assert.deepEqual(storedLargePng, largePng, 'large original must survive an indexing failure unchanged');

  const fakeForm = new FormData();
  fakeForm.append('category', 'Trips');
  fakeForm.append('images', new Blob(['not an image'], { type: 'image/jpeg' }), 'fake.jpg');
  const fakeResponse = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'x-test-admin': 'yes' },
    body: fakeForm
  });
  assert.equal(fakeResponse.status, 400);

  console.log('Upload smoke test passed');
} finally {
  server.close();
  await fs.remove(uploadRoot);
}
