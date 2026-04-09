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
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import { useCity } from '../../contexts/CityContext';
import { VenueCard } from './VenueCard';
import { FilterPanel } from './FilterPanel';
import { VenueSheet } from '../venue/VenueSheet';
import type { Venue } from '../../types/database';
import styles from './ExplorePage.module.css';

const OnboardingFlow = lazy(() => import('../onboarding/OnboardingFlow'));

type ViewType = 'hh' | 'events';
type SortBy = 'name' | 'going' | 'rating' | 'distance';

const SUGGESTIONS = [
  { id: 'pup', emoji: '🐕', label: 'Drinks with the pup?', amenities: ['is_dog_friendly', 'has_happy_hour'], search: '' },
  { id: 'game', emoji: '🏈', label: 'Catch the game', amenities: ['has_sports_tv'], search: '' },
  { id: 'sing', emoji: '🎤', label: 'Sing your heart out', amenities: ['has_karaoke'], search: '' },
  { id: 'live', emoji: '🎵', label: 'Live vibes tonight', amenities: ['has_live_music'], search: '' },
  { id: 'trivia', emoji: '🧠', label: 'Test your brain', amenities: ['has_trivia'], search: '' },
  { id: 'comedy', emoji: '😂', label: 'Make me laugh', amenities: ['has_comedy'], search: '' },
  { id: 'cheap', emoji: '💰', label: '$5 deals & under', amenities: ['has_happy_hour'], search: '$5' },
  { id: 'rooftop', emoji: '🌅', label: 'Rooftop sunset vibes', amenities: [], search: 'rooftop' },
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
  const { currentCity } = useCity();
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
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestFields, setRequestFields] = useState({ name: '', neighborhood: '', details: '' });
  const [submittingRequest, setSubmittingRequest] = useState(false);

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
        selectedAmenities.every((a) => (v as Record<string, unknown>)[a])
      );
    }

    if (activeSuggestion) {
      const sug = SUGGESTIONS.find((s) => s.id === activeSuggestion);
      if (sug) {
        if (sug.amenities.length > 0) {
          result = result.filter((v) =>
            sug.amenities.some((a) => (v as Record<string, unknown>)[a])
          );
        }
        if (sug.search) {
          const q = sug.search.toLowerCase();
          result = result.filter((v) =>
            v.name.toLowerCase().includes(q) ||
            v.deals?.some(d => d.toLowerCase().includes(q)) ||
            v.neighborhood?.toLowerCase().includes(q)
          );
        }
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

  const submitVenueRequest = async () => {
    if (!requestFields.name.trim()) { showToast({ text: 'Enter a venue name', type: 'error' }); return; }
    setSubmittingRequest(true);
    await supabase.from('venue_requests').insert({
      venue_name: requestFields.name.trim(),
      neighborhood: requestFields.neighborhood.trim() || null,
      details: requestFields.details.trim() || null,
      city_slug: currentCity?.slug || 'san-diego',
      user_id: user?.id || null,
    });
    setSubmittingRequest(false);
    setShowRequestForm(false);
    setRequestFields({ name: '', neighborhood: '', details: '' });
    showToast({ text: 'Request submitted — thanks!', type: 'success' });
  };

  const selectedVenue = [...venues, ...events].find((v) => v.id === selectedVenueId) || null;

  // Split venues into tiers matching vanilla app layout
  const heroVenues = filtered.filter(v => v.is_hero && (v.photo_url || (v.photo_urls && v.photo_urls.length)));
  const nonHeroes = filtered.filter(v => !v.is_hero || !(v.photo_url || (v.photo_urls && v.photo_urls.length)));
  const withPhoto = nonHeroes.filter(v => v.photo_url || (v.photo_urls && v.photo_urls.length));
  const withoutPhoto = nonHeroes.filter(v => !(v.photo_url || (v.photo_urls && v.photo_urls.length)));
  const compactVenues = withPhoto.slice(0, 6);
  const standardVenues = [...withPhoto.slice(6), ...withoutPhoto];
  const eventItems = viewType === 'events' ? filtered : [];

  return (
    <div className={styles.page}>
      <CityBar />

      {/* HH / Events toggle */}
      <div className={styles.viewToggle}>
        <button
          className={[styles.viewTab, viewType === 'hh' && styles.viewTabActive].filter(Boolean).join(' ')}
          onClick={() => setViewType('hh')}
        >Happy Hours</button>
        <button
          className={[styles.viewTab, viewType === 'events' && styles.viewTabActive].filter(Boolean).join(' ')}
          onClick={() => setViewType('events')}
        >Events</button>
      </div>

      <div className={styles.controls}>
        <div className={styles.controlsTop}>
          <SearchBox
            placeholder={viewType === 'hh' ? 'Search happy hours...' : 'Search events...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
          <button className={styles.mapBtn} onClick={() => navigate('/map')}>
            Map
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

        {/* Filter toggle button */}
        <div className={styles.controlsActions}>
          <button
            className={[styles.filterToggle, filterOpen && styles.filterToggleActive].filter(Boolean).join(' ')}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            Personalize Your Search
            {activeFilters.length > 0 && <span className={styles.filterDot} />}
          </button>
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

      {/* Results bar */}
      {!loading && filtered.length > 0 && (
        <div className={styles.resultsBar}>
          <span className={styles.resultsCount}>{filtered.length} spots</span>
          <button className={styles.requestBtn} onClick={() => setShowRequestForm(!showRequestForm)}>+ Request a Venue</button>
        </div>
      )}

      {/* Venue request form */}
      {showRequestForm && (
        <div className={styles.requestForm}>
          <input
            className={styles.requestInput}
            placeholder="Venue name *"
            value={requestFields.name}
            onChange={(e) => setRequestFields(f => ({ ...f, name: e.target.value }))}
          />
          <input
            className={styles.requestInput}
            placeholder="Neighborhood (optional)"
            value={requestFields.neighborhood}
            onChange={(e) => setRequestFields(f => ({ ...f, neighborhood: e.target.value }))}
          />
          <input
            className={styles.requestInput}
            placeholder="Any details? (optional)"
            value={requestFields.details}
            onChange={(e) => setRequestFields(f => ({ ...f, details: e.target.value }))}
          />
          <div className={styles.requestActions}>
            <button className={styles.requestCancel} onClick={() => setShowRequestForm(false)}>Cancel</button>
            <button className={styles.requestSubmit} onClick={submitVenueRequest} disabled={submittingRequest}>
              {submittingRequest ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🔍</span>
            <p>No {viewType === 'hh' ? 'happy hours' : 'events'} found</p>
            <p className={styles.emptyHint}>Try removing a filter or searching something different</p>
          </div>
        ) : viewType === 'events' ? (
          <>
            <div className={styles.feedLabel}>Events</div>
            {eventItems.map(venue => (
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
        ) : (
          <>
            {/* Hero cards - "Hot right now" */}
            {heroVenues.length > 0 && (
              <>
                <div className={styles.feedLabel}>🔥 Hot right now</div>
                {heroVenues.map(venue => (
                  <VenueCard
                    key={venue.id}
                    venue={venue}
                    goingCount={checkInCounts[venue.id] || 0}
                    onClick={() => setSelectedVenueId(venue.id)}
                    tier="hero"
                    isFavorite={isFavorite(venue.id)}
                  />
                ))}
              </>
            )}

            {/* Compact grid - "Near you" / "Today's happy hours" */}
            {compactVenues.length > 0 && (
              <>
                <div className={styles.feedLabel}>{heroVenues.length ? 'Near you' : "Today's happy hours"}</div>
                <div className={styles.compactGrid}>
                  {compactVenues.map(venue => (
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
              </>
            )}

            {/* Standard rows - "More spots" */}
            {standardVenues.length > 0 && (
              <>
                <div className={styles.feedLabel}>More spots</div>
                {standardVenues.map(venue => (
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
