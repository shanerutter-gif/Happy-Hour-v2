import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CityBar } from '../../components/layout/CityBar';
import { SearchBox } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { useVenues, useEvents, useCheckInCounts } from '../../hooks/useVenues';
import { VenueCard } from './VenueCard';
import { FilterPanel } from './FilterPanel';
import { VenueSheet } from '../venue/VenueSheet';
import type { Venue } from '../../types/database';
import styles from './ExplorePage.module.css';

type ViewType = 'hh' | 'events';
type SortBy = 'name' | 'going' | 'rating' | 'distance';

export function ExplorePage() {
  const navigate = useNavigate();
  const { venues, loading: venuesLoading } = useVenues();
  const { events, loading: eventsLoading } = useEvents();
  const checkInCounts = useCheckInCounts();

  const [viewType, setViewType] = useState<ViewType>('hh');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  const items = viewType === 'hh' ? venues : events;
  const loading = viewType === 'hh' ? venuesLoading : eventsLoading;

  // Get unique neighborhoods for filtering
  const neighborhoods = useMemo(() => {
    return [...new Set(items.map((v) => v.neighborhood).filter(Boolean))].sort();
  }, [items]);

  // Get unique amenities
  const amenities = useMemo(() => {
    const all = items.flatMap((v) => v.amenities || []);
    return [...new Set(all)].sort();
  }, [items]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = items;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.neighborhood?.toLowerCase().includes(q) ||
          v.address?.toLowerCase().includes(q)
      );
    }

    if (selectedNeighborhood) {
      result = result.filter((v) => v.neighborhood === selectedNeighborhood);
    }

    if (selectedAmenities.length > 0) {
      result = result.filter((v) =>
        selectedAmenities.every((a) => v.amenities?.includes(a))
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'going':
          return (checkInCounts[b.id] || 0) - (checkInCounts[a.id] || 0);
        case 'rating':
          return (b.avg_rating || 0) - (a.avg_rating || 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return result;
  }, [items, search, selectedNeighborhood, selectedAmenities, sortBy, checkInCounts]);

  const activeFilters: string[] = [];
  if (selectedNeighborhood) activeFilters.push(selectedNeighborhood);
  selectedAmenities.forEach((a) => activeFilters.push(a));

  const selectedVenue = items.find((v) => v.id === selectedVenueId) || null;

  return (
    <div className={styles.page}>
      <CityBar />

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.controlsTop}>
          <SearchBox
            placeholder={viewType === 'hh' ? 'Search happy hours...' : 'Search events...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
          <button
            className={[styles.filterBtn, filterOpen && styles.filterBtnActive].filter(Boolean).join(' ')}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            ☰ Filter
          </button>
          <button
            className={styles.mapBtn}
            onClick={() => navigate('/map')}
          >
            🗺 Map
          </button>
        </div>

        {/* Type tabs */}
        <div className={styles.typeTabs}>
          <Pill active={viewType === 'hh'} onClick={() => setViewType('hh')}>
            🍺 Happy Hours
          </Pill>
          <Pill active={viewType === 'events'} onClick={() => setViewType('events')}>
            🎉 Events
          </Pill>
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className={styles.chips}>
            {activeFilters.map((f) => (
              <Pill
                key={f}
                variant="chip"
                onClick={() => {
                  if (f === selectedNeighborhood) setSelectedNeighborhood(null);
                  else setSelectedAmenities((prev) => prev.filter((a) => a !== f));
                }}
              >
                {f} ×
              </Pill>
            ))}
          </div>
        )}
      </div>

      {/* Filter panel */}
      <FilterPanel
        open={filterOpen}
        neighborhoods={neighborhoods}
        amenities={amenities}
        selectedNeighborhood={selectedNeighborhood}
        selectedAmenities={selectedAmenities}
        sortBy={sortBy}
        onNeighborhoodChange={setSelectedNeighborhood}
        onAmenityToggle={(a) =>
          setSelectedAmenities((prev) =>
            prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
          )
        }
        onSortChange={setSortBy}
        onClearAll={() => {
          setSelectedNeighborhood(null);
          setSelectedAmenities([]);
          setSortBy('name');
        }}
        onDone={() => setFilterOpen(false)}
      />

      {/* Venue list */}
      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🔍</span>
            <p>No {viewType === 'hh' ? 'happy hours' : 'events'} found</p>
          </div>
        ) : (
          filtered.map((venue) => (
            <VenueCard
              key={venue.id}
              venue={venue}
              goingCount={checkInCounts[venue.id] || 0}
              onClick={() => setSelectedVenueId(venue.id)}
            />
          ))
        )}
      </div>

      {/* Venue detail sheet */}
      {selectedVenue && (
        <VenueSheet
          venue={selectedVenue}
          open={!!selectedVenueId}
          onClose={() => setSelectedVenueId(null)}
        />
      )}
    </div>
  );
}
