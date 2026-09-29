export function publicPhoto(photo) {
  const id = encodeURIComponent(photo.id);
  const version = encodeURIComponent(photo.lastModified || '');
  const url = kind => `/photowall/api/${kind}/${id}?v=${version}`;
  return {
    id: photo.id, url: url('display'), previewUrl: url('preview'), originalUrl: url('image'),
    thumbnail: url('thumbnail'), blurPlaceholder: photo.blurPlaceholder,
    title: photo.title, category: photo.category, date: photo.date, location: photo.location,
    latitude: photo.latitude ?? null, longitude: photo.longitude ?? null,
    exif: photo.exif, dimensions: photo.dimensions, sourceId: photo.sourceId
  };
}

export function parsePhotoQuery(query, { paginate = true } = {}) {
  const integer = (name, fallback, max) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  const options = {
    category: typeof query.category === 'string' ? query.category : undefined,
    sourceId: typeof query.sourceId === 'string' ? query.sourceId : undefined,
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 500) : undefined,
    sortBy: ['date', 'title', 'category'].includes(query.sortBy) ? query.sortBy : 'date',
    sortOrder: query.sortOrder === 'asc' ? 'asc' : 'desc'
  };
  if (paginate) {
    options.limit = integer('limit', 120, 500);
    if (options.limit === 0) throw new Error('limit must be positive');
    options.offset = integer('offset', 0, Number.MAX_SAFE_INTEGER);
  }
  if (query.ids !== undefined) {
    const ids = JSON.parse(query.ids);
    if (!Array.isArray(ids) || ids.length > 2000 || ids.some(id => typeof id !== 'string')) throw new Error('Invalid photo IDs');
    options.ids = ids;
  }
  const boundsKeys = ['south', 'north', 'west', 'east'];
  if (boundsKeys.some(key => query[key] !== undefined)) {
    const bounds = Object.fromEntries(boundsKeys.map(key => [key, Number(query[key])]));
    if (boundsKeys.some(key => query[key] === undefined || query[key] === '' || !Number.isFinite(bounds[key]))
      || bounds.south < -90 || bounds.north > 90 || bounds.south > bounds.north
      || Math.abs(bounds.west) > 180 || Math.abs(bounds.east) > 180) throw new Error('Invalid map bounds');
    options.bounds = bounds;
  }
  if (query.zoom !== undefined) options.zoom = integer('zoom', 2, 19);
  return options;
}
