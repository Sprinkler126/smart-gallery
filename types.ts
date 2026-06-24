export interface Photo {
  id: string;
  url: string;
  originalUrl?: string;  // Full resolution original image
  thumbnail: string;
  blurPlaceholder?: string; // Base64 encoded tiny blurred image for LQIP
  title: string;
  category: string;
  date: string;
  location?: string;
  exif?: {
    camera?: string;
    lens?: string;
    aperture?: string;
    shutter?: string;
    iso?: string;
    focalLength?: string;
  };
  dimensions?: {
    width: number;
    height: number;
    rawWidth?: number;
    rawHeight?: number;
    orientation?: number;
    format: string;
  };
  sourceId?: string;
}

export interface AIAnalysisResult {
  photoId: string;
  analyzedAt: string;
  tags: string[];
  category: string;
  description: string;
  depict: string;  // Poetic depiction of the image
  quality: {
    score: number;
    issues: string[];
  };
  aesthetic: {
    score: number;
    strengths: string[];
  };
  technical: {
    composition: string;
    lighting: string;
    focus: string;
    exposure: string;
  };
  raw?: string;
  parseError?: string;
}

export enum ViewMode {
  GRID = 'GRID',
  MASONRY = 'MASONRY',
  TIMELINE = 'TIMELINE'
}
