import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CityBar } from '../../components/layout/CityBar';
import { SearchBox } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { useVenues, useEvents, useCheckInCounts } from '../../hooks/useVenues';
import { useFavorites } from '../../hooks/useFavorites';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useAuth } from '../../contexts/AuthContext';
import { shouldShowOnboarding } from '../onboarding/OnboardingFlow';
import { VenueCard } from './VenueCard';
import { FilterPanel } from './FilterPanel';
import { VenueSheet } from '../venue/VenueSheet';
import type { Venue } from '../../types/database';
import styles from './ExplorePage.module.css';

const OnboardingFlow = lazy(() => import('../onboarding/OnboardingFlow'));

type ViewType = 'hh' | 'events';
type SortBy = 'name' | 'going' | 'rating' | 'distance';

const SUGGESTIONS = [
  { id: 'pup', emoji: '🐕', label: 'Drinks with the pup?', amenities: ['is_dog_friendly', 'has_happy_hour'] },
  { id: 'game', emoji: '🏈', label: 'Catch the game', amenities: ['has_sports_tv'] },
  { id: 'music', emoji: '🎵', label: 'Live music tonight', amenities: ['has_live_music'] },
  { id: 'trivia', emoji: '🧠', label: 'Trivia night', amenities: ['has_trivia'] },
  { id: 'karaoke', emoji: '🎤', label: 'Karaoke vibes', amenities: ['has_karaoke'] },
  { id: 'comedy', emoji: '😂', label: 'Comedy shows', amenities: ['has_comedy'] },
];

export default function ExplorePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { venues, loading: venuesLoading } = useVenues();
  const { events, loading: eventsLoading } = useEvents();
  const checkInCounts = useCheckInCounts();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const geo = useGeolocation();
  const [showOnboarding] = useState(() => shouldShowOnboarding(user?.id));

  const [viewType, setViewType] = useState<ViewType>('hh');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null);
  const [favFilterOn, setFavFilterOn] = useState(false);

  // Deep linking: ?spot=VENUE_ID
  useEffect(() => {
    const spotId = searchParams.get('spot');
    if (spotId && venues.length > 0) {
      setSelectedVenueId(spotId);
    }
  }, [searchParams, venues]);

  const items = viewType === 'hh' ? venues : events;
  const loading = viewType === 'hh' ? venuesLoading : eventsLoading;

  const neighborhoods = useMemo(() => {
    return [...new Set(items.map((v) => v.neighborhood).filter(Boolean))].sort();
  }, [items]);

  const amenities = useMemo(() => {
    const all = items.flatMap((v) => v.amenities || []);
    return [...new Set(all)].sort();
  }, [items]);

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

    if (activeSuggestion) {
      const sug = SUGGESTIONS.find((s) => s.id === activeSuggestion);
      if (sug) {
        result = result.filter((v) =>
          sug.amenities.some((a) => v.amenities?.includes(a))
        );
      }
    }

    if (favFilterOn) {
      result = result.filter((v) => isFavorite(v.id));
    }

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'going':
          return (checkInCounts[b.id] || 0) - (checkInCounts[a.id] || 0);
        case 'rating':
          return (b.avg_rating || 0) - (a.avg_rating || 0);
        case 'distance': {
          const dA = geo.distanceTo(a.lat, a.lng);
          const dB = geo.distanceTo(b.lat, b.lng);
          if (dA === null && dB === null) return 0;
          if (dA === null) return 1;
          if (dB === null) return -1;
          return dA - dB;
        }
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return result;
  }, [items, search, selectedNeighborhood, selectedAmenities, sortBy, checkInCounts, activeSuggestion, favFilterOn, isFavorite, geo.lat, geo.lng]);

  const activeFilters: string[] = [];
  if (selectedNeighborhood) activeFilters.push(selectedNeighborhood);
  selectedAmenities.forEach((a) => activeFilters.push(a));

  const selectedVenue = [...venues, ...events].find((v) => v.id === selectedVenueId) || null;

  const assignTier = (venue: Venue, index: number): 'hero' | 'compact' | 'standard' => {
    if (index === 0 && venue.featured) return 'hero';
    if (index === 0 && venue.photo_url) return 'hero';
    if (index >= 1 && index <= 4) return 'compact';
    return 'standard';
  };

  return (
    <div className={styles.page}>
      <CityBar />

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
            className={[styles.favBtn, favFilterOn && styles.favBtnActive].filter(Boolean).join(' ')}
            onClick={() => setFavFilterOn(!favFilterOn)}
          >
            {favFilterOn ? '★' : '☆'}
          </button>
          <button className={styles.mapBtn} onClick={() => navigate('/map')}>
            🗺 Map
          </button>
        </div>

        {/* Smart suggestion chips */}
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <Pill
              key={s.id}
              variant="chip"
              active={activeSuggestion === s.id}
              onClick={() => setActiveSuggestion(activeSuggestion === s.id ? null : s.id)}
            >
              {s.emoji} {s.label}
            </Pill>
          ))}
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
          setActiveSuggestion(null);
          setFavFilterOn(false);
        }}
        onDone={() => setFilterOpen(false)}
      />

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
          <>
            {filtered.length > 0 && (
              <VenueCard
                key={filtered[0].id}
                venue={filtered[0]}
                goingCount={checkInCounts[filtered[0].id] || 0}
                onClick={() => setSelectedVenueId(filtered[0].id)}
                tier={assignTier(filtered[0], 0)}
                isFavorite={isFavorite(filtered[0].id)}
              />
            )}
            {filtered.length > 1 && (
              <div className={styles.compactGrid}>
                {filtered.slice(1, 5).map((venue) => (
                  <VenueCard
                    key={venue.id}
                    venue={venue}
                    goingCount={checkInCounts[venue.id] || 0}
                    onClick={() => setSelectedVenueId(venue.id)}
                    tier="compact"
                    isFavorite={isFavorite(venue.id)}
                  />
                ))}
              </div>
            )}
            {filtered.slice(5).map((venue) => (
              <VenueCard
                key={venue.id}
                venue={venue}
                goingCount={checkInCounts[venue.id] || 0}
                onClick={() => setSelectedVenueId(venue.id)}
                tier="standard"
                isFavorite={isFavorite(venue.id)}
              />
            ))}
          </>
        )}
      </div>

      {selectedVenue && (
        <VenueSheet
          venue={selectedVenue}
          open={!!selectedVenueId}
          onClose={() => setSelectedVenueId(null)}
          isFavorite={isFavorite(selectedVenue.id)}
          onToggleFavorite={() => toggleFavorite(selectedVenue.id)}
        />
      )}

      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingFlow />
        </Suspense>
      )}
    </div>
  );
}
