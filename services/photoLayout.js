// Layout coordinates are independent of the DOM, so off-screen cards need no elements.
export function buildPhotoLayout(photos, width, mode = 'MASONRY') {
  if (width <= 0) return { items: [], height: 0 };
  const gap = width >= 768 ? 24 : 12;
  const columns = width >= 1024 ? 3 : width >= 640 ? 2 : 1;
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const items = [];
  let height = 0;
  if (mode === 'TIMELINE') {
    const timelineColumns = width >= 1024 ? 5 : width >= 768 ? 4 : width >= 640 ? 3 : 2;
    const size = (width - gap * (timelineColumns - 1)) / timelineColumns;
    let group = '';
    let year = '';
    let row = 0;
    let groupStart = 0;
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      const parsed = new Date(photo.date);
      const key = !photo.date || Number.isNaN(parsed.getTime()) ? 'unknown' : photo.date.slice(0, 7);
      const nextYear = key === 'unknown' ? '日期未知' : key.slice(0, 4);
      if (group !== key) {
        if (group) height = groupStart + Math.ceil(row / timelineColumns) * (size + gap) + 32;
        if (nextYear !== year) {
          items.push({ kind: 'year', label: nextYear, x: 0, y: height, width, height: 88, index: -1 });
          height += 104; year = nextYear;
        }
        items.push({ kind: 'month', label: key === 'unknown' ? '未记录拍摄日期' : `${Number(key.slice(5))} 月`, x: 0, y: height, width, height: 40, index: -1 });
        height += 56; groupStart = height; row = 0; group = key;
      }
      items.push({ kind: 'photo', index, x: (row % timelineColumns) * (size + gap), y: groupStart + Math.floor(row / timelineColumns) * (size + gap), width: size, height: size });
      row++;
    }
    if (group) height = groupStart + Math.ceil(row / timelineColumns) * (size + gap);
  } else {
    const bottoms = Array(columns).fill(0);
    let rowY = 0;
    let rowHeight = 0;
    for (let index = 0; index < photos.length; index++) {
      const dimensions = photos[index].dimensions;
      const ratio = dimensions?.width > 0 && dimensions?.height > 0 ? dimensions.width / dimensions.height : 1.5;
      const itemHeight = columnWidth / ratio;
      let column;
      let y;
      if (mode === 'MASONRY') {
        column = bottoms.indexOf(Math.min(...bottoms)); y = bottoms[column];
        bottoms[column] += itemHeight + gap;
      } else {
        column = index % columns;
        if (column === 0 && index > 0) { rowY += rowHeight + gap; rowHeight = 0; }
        y = rowY; rowHeight = Math.max(rowHeight, itemHeight);
      }
      items.push({ kind: 'photo', index, x: column * (columnWidth + gap), y, width: columnWidth, height: itemHeight });
      height = Math.max(height, y + itemHeight);
    }
  }
  let maxEnd = 0;
  const ends = items.map(item => { maxEnd = Math.max(maxEnd, item.y + item.height); return maxEnd; });
  return { items, height, ends };
}

export function visibleLayoutRange(layout, start, end) {
  const lowerBound = (length, predicate) => {
    let low = 0; let high = length;
    while (low < high) { const mid = (low + high) >>> 1; if (predicate(mid)) high = mid; else low = mid + 1; }
    return low;
  };
  return {
    start: lowerBound(layout.items.length, index => layout.ends[index] >= start),
    end: lowerBound(layout.items.length, index => layout.items[index].y > end)
  };
}
