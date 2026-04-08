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
  { value: 'name', label: 'A-Z' },
  { value: 'going', label: '🔥 Hot' },
  { value: 'rating', label: '★ Rated' },
  { value: 'distance', label: '📍 Near' },
] as const;

export function FilterPanel({
  open,
  neighborhoods,
  amenities,
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
          <button className={styles.clearAll} onClick={onClearAll}>Clear All</button>
          <button className={styles.done} onClick={onDone}>Done</button>
        </div>
      </div>

      {/* Sort */}
      <div className={styles.section}>
        <span className={styles.label}>Sort by</span>
        <div className={styles.row}>
          {SORT_OPTIONS.map((opt) => (
            <Pill
              key={opt.value}
              active={sortBy === opt.value}
              onClick={() => onSortChange(opt.value as 'name' | 'going' | 'rating' | 'distance')}
            >
              {opt.label}
            </Pill>
          ))}
        </div>
      </div>

      {/* Neighborhoods */}
      {neighborhoods.length > 0 && (
        <div className={styles.section}>
          <span className={styles.label}>Neighborhood</span>
          <div className={styles.row}>
            <Pill
              active={!selectedNeighborhood}
              onClick={() => onNeighborhoodChange(null)}
            >
              All
            </Pill>
            {neighborhoods.map((n) => (
              <Pill
                key={n}
                active={selectedNeighborhood === n}
                onClick={() => onNeighborhoodChange(selectedNeighborhood === n ? null : n)}
              >
                {n}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Amenities */}
      {amenities.length > 0 && (
        <div className={styles.section}>
          <span className={styles.label}>Amenities</span>
          <div className={styles.row}>
            {amenities.map((a) => (
              <Pill
                key={a}
                variant="amenity"
                active={selectedAmenities.includes(a)}
                onClick={() => onAmenityToggle(a)}
              >
                {a}
              </Pill>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
