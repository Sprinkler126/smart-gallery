import React, { useMemo } from 'react';
import { Photo } from '../types';
import ProtectedImage from './ProtectedImage';
import { Calendar } from 'lucide-react';

interface TimelineViewProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo, index: number) => void;
}

const TimelineView: React.FC<TimelineViewProps> = ({ photos, onPhotoClick }) => {
  // Group photos by Year -> Month Index (0-11)
  const groupedPhotos = useMemo(() => {
    const groups: Record<number, Record<number, Photo[]>> = {};

    photos.forEach(photo => {
      const date = new Date(photo.date);
      // Validate date
      if (isNaN(date.getTime())) return;
      
      const year = date.getFullYear();
      const month = date.getMonth(); // 0 = Jan, 11 = Dec

      if (!groups[year]) groups[year] = {};
      if (!groups[year][month]) groups[year][month] = [];
      groups[year][month].push(photo);
    });

    return groups;
  }, [photos]);

  // Sort Years Descending (Newest first)
  const years = Object.keys(groupedPhotos).map(Number).sort((a, b) => b - a);

  const getMonthName = (monthIndex: number) => {
    const date = new Date();
    date.setMonth(monthIndex);
    return date.toLocaleString('default', { month: 'long' });
  };

  return (
    <div className="max-w-7xl mx-auto py-8">
      {years.map(year => {
        // Sort Months Descending within the year
        const months = Object.keys(groupedPhotos[year]).map(Number).sort((a, b) => b - a);

        return (
          <div key={year} className="mb-24 animate-fade-in">
            {/* Sticky Year Header */}
            <div className="sticky top-[72px] z-20 bg-obsidian/95 backdrop-blur-sm border-b border-white/5 py-4 mb-8 flex items-baseline gap-4">
               <h2 className="text-5xl md:text-6xl font-serif text-white/20 font-bold tracking-tighter">
                {year}
              </h2>
            </div>

            {months.map(month => (
              <div key={month} className="mb-16">
                {/* Month Header */}
                <div className="flex items-center gap-4 mb-6 pl-1">
                  <h3 className="text-gold font-serif text-2xl tracking-wide">{getMonthName(month)}</h3>
                  <div className="h-px bg-white/10 flex-grow max-w-[100px]" />
                  <span className="text-xs text-gray-500 font-mono">
                    {groupedPhotos[year][month].length} SHOTS
                  </span>
                </div>

                {/* High Density Grid for this Month */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-1 md:gap-4">
                  {groupedPhotos[year][month].map((photo) => {
                    // Find global index for lightbox navigation
                    const globalIndex = photos.findIndex(p => p.id === photo.id);
                    
                    return (
                      <div 
                        key={photo.id} 
                        className="group relative aspect-square bg-charcoal cursor-pointer overflow-hidden rounded-sm"
                        onClick={() => onPhotoClick(photo, globalIndex)}
                      >
                         <ProtectedImage 
                           src={photo.thumbnail} 
                           blurPlaceholder={photo.blurPlaceholder}
                           alt={photo.title}
                           className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                         />
                         
                         {/* Minimal Hover Overlay */}
                         <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                         
                         {/* Info Badge (Bottom Left) */}
                         <div className="absolute bottom-0 left-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <p className="text-white text-xs font-serif truncate w-32 drop-shadow-md">
                              {photo.title}
                            </p>
                            <div className="flex items-center gap-1 text-[10px] text-gray-300 mt-0.5 font-mono">
                               <Calendar size={10} />
                               <span>{photo.date.substring(5)}</span>
                            </div>
                         </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      
      {/* End of Timeline Indicator */}
      <div className="flex justify-center pb-12 opacity-30">
        <div className="h-16 w-px bg-gradient-to-b from-white to-transparent"></div>
      </div>
    </div>
  );
};

export default TimelineView;