import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';

const now = () => new Date().toISOString();

const jsonStringify = (value) => {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
};

const jsonParse = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export class DatabaseService {
  constructor(config = {}, baseDir = process.cwd()) {
    const configuredPath = config.database?.path || './data/smart-gallery.sqlite';
    this.dbPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(baseDir, configuredPath);
    fs.ensureDirSync(path.dirname(this.dbPath));

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.initializeSchema();
    this.prepareStatements();
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        original_path TEXT NOT NULL UNIQUE,
        relative_path TEXT,
        filename TEXT,
        title TEXT,
        category TEXT,
        date TEXT,
        location TEXT,
        exif_json TEXT,
        dimensions_json TEXT,
        thumbnail_path TEXT,
        thumbnail_filename TEXT,
        blur_placeholder TEXT,
        last_modified TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_photos_source_id ON photos(source_id);
      CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category);
      CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date);
      CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);

      CREATE TABLE IF NOT EXISTS analysis (
        photo_id TEXT PRIMARY KEY,
        analyzed_at TEXT,
        tags_json TEXT,
        category TEXT,
        description TEXT,
        depict TEXT,
        quality_json TEXT,
        aesthetic_json TEXT,
        technical_json TEXT,
        raw TEXT,
        parse_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_category ON analysis(category);

      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'batch',
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        current_photo_id TEXT,
        error TEXT,
        results_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_at ON analysis_jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        path TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        default_category TEXT,
        use_folder_as_category INTEGER NOT NULL DEFAULT 1,
        watch INTEGER NOT NULL DEFAULT 1,
        photo_count INTEGER NOT NULL DEFAULT 0,
        last_scanned TEXT,
        status TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    this.migrateAnalysisTableIfNeeded();
  }

  migrateAnalysisTableIfNeeded() {
    const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(analysis)`).all();
    const referencesPhotos = foreignKeys.some(key => key.table === 'photos');
    if (!referencesPhotos) return;

    console.log('🗄️  Migrating analysis table to remove strict photo FK');
    this.db.exec(`
      ALTER TABLE analysis RENAME TO analysis_old;

      CREATE TABLE analysis (
        photo_id TEXT PRIMARY KEY,
        analyzed_at TEXT,
        tags_json TEXT,
        category TEXT,
        description TEXT,
        depict TEXT,
        quality_json TEXT,
        aesthetic_json TEXT,
        technical_json TEXT,
        raw TEXT,
        parse_error TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT OR REPLACE INTO analysis (
        photo_id, analyzed_at, tags_json, category, description, depict,
        quality_json, aesthetic_json, technical_json, raw, parse_error, updated_at
      )
      SELECT
        photo_id, analyzed_at, tags_json, category, description, depict,
        quality_json, aesthetic_json, technical_json, raw, parse_error, updated_at
      FROM analysis_old;

      DROP TABLE analysis_old;
      CREATE INDEX IF NOT EXISTS idx_analysis_category ON analysis(category);
    `);
  }

  prepareStatements() {
    this.statements = {
      upsertPhoto: this.db.prepare(`
        INSERT INTO photos (
          id, source_id, original_path, relative_path, filename, title, category, date, location,
          exif_json, dimensions_json, thumbnail_path, thumbnail_filename, blur_placeholder,
          last_modified, status, created_at, updated_at
        )
        VALUES (
          @id, @sourceId, @originalPath, @relativePath, @filename, @title, @category, @date, @location,
          @exifJson, @dimensionsJson, @thumbnailPath, @thumbnailFilename, @blurPlaceholder,
          @lastModified, 'active', @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          original_path = excluded.original_path,
          relative_path = excluded.relative_path,
          filename = excluded.filename,
          title = excluded.title,
          category = excluded.category,
          date = excluded.date,
          location = excluded.location,
          exif_json = excluded.exif_json,
          dimensions_json = excluded.dimensions_json,
          thumbnail_path = excluded.thumbnail_path,
          thumbnail_filename = excluded.thumbnail_filename,
          blur_placeholder = excluded.blur_placeholder,
          last_modified = excluded.last_modified,
          status = 'active',
          updated_at = excluded.updated_at
      `),
      getPhotos: this.db.prepare(`SELECT * FROM photos WHERE status = 'active'`),
      getPhoto: this.db.prepare(`SELECT * FROM photos WHERE id = ? AND status = 'active'`),
      removePhoto: this.db.prepare(`DELETE FROM photos WHERE id = ?`),
      removePhotosBySource: this.db.prepare(`DELETE FROM photos WHERE source_id = ?`),
      markMissingPhotosForSource: this.db.prepare(`
        UPDATE photos
        SET status = 'missing', updated_at = ?
        WHERE source_id = ? AND id NOT IN (
          SELECT value FROM json_each(?)
        )
      `),
      upsertAnalysis: this.db.prepare(`
        INSERT INTO analysis (
          photo_id, analyzed_at, tags_json, category, description, depict,
          quality_json, aesthetic_json, technical_json, raw, parse_error, updated_at
        )
        VALUES (
          @photoId, @analyzedAt, @tagsJson, @category, @description, @depict,
          @qualityJson, @aestheticJson, @technicalJson, @raw, @parseError, @updatedAt
        )
        ON CONFLICT(photo_id) DO UPDATE SET
          analyzed_at = excluded.analyzed_at,
          tags_json = excluded.tags_json,
          category = excluded.category,
          description = excluded.description,
          depict = excluded.depict,
          quality_json = excluded.quality_json,
          aesthetic_json = excluded.aesthetic_json,
          technical_json = excluded.technical_json,
          raw = excluded.raw,
          parse_error = excluded.parse_error,
          updated_at = excluded.updated_at
      `),
      getAnalyses: this.db.prepare(`SELECT * FROM analysis`),
      getAnalysis: this.db.prepare(`SELECT * FROM analysis WHERE photo_id = ?`),
      clearAnalysis: this.db.prepare(`DELETE FROM analysis`),
      upsertJob: this.db.prepare(`
        INSERT INTO analysis_jobs (
          id, type, status, total, completed, failed, current_photo_id, error,
          results_json, created_at, updated_at
        )
        VALUES (
          @id, @type, @status, @total, @completed, @failed, @currentPhotoId, @error,
          @resultsJson, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          total = excluded.total,
          completed = excluded.completed,
          failed = excluded.failed,
          current_photo_id = excluded.current_photo_id,
          error = excluded.error,
          results_json = excluded.results_json,
          updated_at = excluded.updated_at
      `),
      getJob: this.db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`),
      getRecentJobs: this.db.prepare(`
        SELECT * FROM analysis_jobs
        ORDER BY created_at DESC
        LIMIT ?
      `),
      upsertSource: this.db.prepare(`
        INSERT INTO sources (
          id, name, type, path, enabled, default_category, use_folder_as_category,
          watch, photo_count, last_scanned, status, updated_at
        )
        VALUES (
          @id, @name, @type, @path, @enabled, @defaultCategory, @useFolderAsCategory,
          @watch, @photoCount, @lastScanned, @status, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          path = excluded.path,
          enabled = excluded.enabled,
          default_category = excluded.default_category,
          use_folder_as_category = excluded.use_folder_as_category,
          watch = excluded.watch,
          photo_count = excluded.photo_count,
          last_scanned = excluded.last_scanned,
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
    };
  }

  photoFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      sourceId: row.source_id,
      originalPath: row.original_path,
      relativePath: row.relative_path,
      filename: row.filename,
      title: row.title,
      category: row.category,
      date: row.date,
      location: row.location,
      exif: jsonParse(row.exif_json, {}),
      dimensions: jsonParse(row.dimensions_json, null),
      thumbnailPath: row.thumbnail_path,
      thumbnailFilename: row.thumbnail_filename,
      blurPlaceholder: row.blur_placeholder,
      lastModified: row.last_modified
    };
  }

  upsertPhoto(photo) {
    const timestamp = now();
    this.statements.upsertPhoto.run({
      id: photo.id,
      sourceId: photo.sourceId,
      originalPath: photo.originalPath,
      relativePath: photo.relativePath,
      filename: photo.filename,
      title: photo.title,
      category: photo.category,
      date: photo.date,
      location: photo.location,
      exifJson: jsonStringify(photo.exif || {}),
      dimensionsJson: jsonStringify(photo.dimensions || null),
      thumbnailPath: photo.thumbnailPath,
      thumbnailFilename: photo.thumbnailFilename,
      blurPlaceholder: photo.blurPlaceholder || null,
      lastModified: photo.lastModified,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  getPhotos() {
    return this.statements.getPhotos.all().map(row => this.photoFromRow(row));
  }

  getPhoto(id) {
    return this.photoFromRow(this.statements.getPhoto.get(id));
  }

  removePhoto(id) {
    this.statements.removePhoto.run(id);
  }

  removePhotosBySource(sourceId) {
    this.statements.removePhotosBySource.run(sourceId);
  }

  markMissingPhotosForSource(sourceId, activeIds) {
    const idsJson = JSON.stringify(activeIds);
    this.statements.markMissingPhotosForSource.run(now(), sourceId, idsJson);
  }

  analysisFromRow(row) {
    if (!row) return null;
    return {
      photoId: row.photo_id,
      analyzedAt: row.analyzed_at,
      tags: jsonParse(row.tags_json, []),
      category: row.category,
      description: row.description || '',
      depict: row.depict || '',
      quality: jsonParse(row.quality_json, { score: 0, issues: [] }),
      aesthetic: jsonParse(row.aesthetic_json, { score: 0, strengths: [] }),
      technical: jsonParse(row.technical_json, { composition: '', lighting: '', focus: '', exposure: '' }),
      raw: row.raw || undefined,
      parseError: row.parse_error || undefined
    };
  }

  upsertAnalysis(analysis) {
    this.statements.upsertAnalysis.run({
      photoId: analysis.photoId,
      analyzedAt: analysis.analyzedAt,
      tagsJson: jsonStringify(analysis.tags || []),
      category: analysis.category || '',
      description: analysis.description || '',
      depict: analysis.depict || '',
      qualityJson: jsonStringify(analysis.quality || { score: 0, issues: [] }),
      aestheticJson: jsonStringify(analysis.aesthetic || { score: 0, strengths: [] }),
      technicalJson: jsonStringify(analysis.technical || { composition: '', lighting: '', focus: '', exposure: '' }),
      raw: analysis.raw || '',
      parseError: analysis.parseError || null,
      updatedAt: now()
    });
  }

  getAnalyses() {
    return this.statements.getAnalyses.all().map(row => this.analysisFromRow(row));
  }

  getAnalysis(photoId) {
    return this.analysisFromRow(this.statements.getAnalysis.get(photoId));
  }

  clearAnalysis() {
    this.statements.clearAnalysis.run();
  }

  jobToRow(job) {
    return {
      id: job.id,
      type: job.type || 'batch',
      status: job.status,
      total: job.total || 0,
      completed: job.completed || 0,
      failed: job.failed || 0,
      currentPhotoId: job.currentPhotoId || null,
      error: job.error || null,
      resultsJson: jsonStringify(job.results || []),
      createdAt: job.createdAt || now(),
      updatedAt: job.updatedAt || now()
    };
  }

  jobFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      currentPhotoId: row.current_photo_id,
      error: row.error || undefined,
      results: jsonParse(row.results_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  upsertAnalysisJob(job) {
    this.statements.upsertJob.run(this.jobToRow(job));
  }

  getAnalysisJob(id) {
    return this.jobFromRow(this.statements.getJob.get(id));
  }

  getRecentAnalysisJobs(limit = 10) {
    return this.statements.getRecentJobs.all(limit).map(row => this.jobFromRow(row));
  }

  upsertSource(source) {
    this.statements.upsertSource.run({
      id: source.id,
      name: source.name,
      type: source.type,
      path: source.path,
      enabled: source.enabled === false ? 0 : 1,
      defaultCategory: source.defaultCategory || 'General',
      useFolderAsCategory: source.useFolderAsCategory === false ? 0 : 1,
      watch: source.watch === false ? 0 : 1,
      photoCount: source.photoCount || 0,
      lastScanned: source.lastScanned || null,
      status: source.status || 'idle',
      updatedAt: now()
    });
  }

  close() {
    this.db.close();
  }
}

export default DatabaseService;
