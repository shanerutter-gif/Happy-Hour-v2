import { Pill } from '../../components/ui/Pill';
import styles from './FilterPanel.module.css';

interface FilterPanelProps {
  open: boolean;
  neighborhoods: string[];
  amenities: string[];
  selectedNeighborhood: string | null;
  selectedAmenities: string[];
  sortBy: string;
  onNeighborhoodChange: (n: string | null) => void;
  onAmenityToggle: (a: string) => void;
  onSortChange: (s: 'name' | 'going' | 'rating' | 'distance') => void;
  onClearAll: () => void;
  onDone: () => void;
}

const SORT_OPTIONS = [
  { value: 'name', label: 'A–Z' },
  { value: 'distance', label: 'Nearest' },
  { value: 'going', label: 'Featured' },
] as const;

const AMENITY_DEFS = [
  { key: 'has_happy_hour', label: 'Happy Hour', emoji: '🍺' },
  { key: 'has_sports_tv', label: 'Sports TV', emoji: '📺' },
  { key: 'is_dog_friendly', label: 'Dog Friendly', emoji: '🐕' },
  { key: 'has_live_music', label: 'Live Music', emoji: '🎵' },
  { key: 'has_karaoke', label: 'Karaoke', emoji: '🎤' },
  { key: 'has_trivia', label: 'Trivia', emoji: '🧠' },
  { key: 'has_bingo', label: 'Bingo', emoji: '🎯' },
  { key: 'has_comedy', label: 'Comedy', emoji: '😂' },
];

export function FilterPanel({
  open,
  neighborhoods,
  selectedNeighborhood,
  selectedAmenities,
  sortBy,
  onNeighborhoodChange,
  onAmenityToggle,
  onSortChange,
  onClearAll,
  onDone,
}: FilterPanelProps) {
  if (!open) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Filters</span>
        <div className={styles.headerRight}>
          <button className={styles.clearAll} onClick={onClearAll}>Reset</button>
          <button className={styles.done} onClick={onDone}>Done</button>
        </div>
      </div>

      {/* Sort */}
      <div className={styles.section}>
        <span className={styles.label}>Sort</span>
        <div className={styles.row}>
          {SORT_OPTIONS.map((opt) => (
            <Pill
              key={opt.value}
              active={sortBy === opt.value}
              onClick={() => onSortChange(opt.value as 'name' | 'going' | 'distance')}
            >
              {opt.label}
            </Pill>
          ))}
        </div>
      </div>

      {/* Area dropdown */}
      {neighborhoods.length > 0 && (
        <div className={styles.section}>
          <span className={styles.label}>Area</span>
          <select
            className={styles.filterSelect}
            value={selectedNeighborhood || ''}
            onChange={(e) => onNeighborhoodChange(e.target.value || null)}
          >
            <option value="">Any</option>
            {neighborhoods.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      {/* Amenities grid */}
      <div className={styles.section}>
        <span className={styles.label}>Amenities</span>
        <div className={styles.amenityGrid}>
          {AMENITY_DEFS.map((a) => (
            <button
              key={a.key}
              className={[styles.amenityCard, selectedAmenities.includes(a.key) && styles.amenityCardActive].filter(Boolean).join(' ')}
              onClick={() => onAmenityToggle(a.key)}
            >
              <span className={styles.amenityEmoji}>{a.emoji}</span>
              <span className={styles.amenityLabel}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
