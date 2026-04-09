import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useVenues, useCheckInCounts } from '../../hooks/useVenues';
import { useFavorites } from '../../hooks/useFavorites';
import { useCity } from '../../contexts/CityContext';
import { VenueSheet } from '../venue/VenueSheet';
import type { Venue } from '../../types/database';
import styles from './MapPage.module.css';

export default function MapPage() {
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const { venues, loading: venuesLoading } = useVenues();
  const checkInCounts = useCheckInCounts();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const { currentCity } = useCity();
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);

  const initMap = useCallback(() => {
    if (!mapRef.current || leafletMap.current) return;

    const lat = currentCity?.lat || 32.7157;
    const lng = currentCity?.lng || -117.1611;

    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);

    leafletMap.current = map;
  }, [currentCity]);

  // Add markers
  useEffect(() => {
    const map = leafletMap.current;
    if (!map || venues.length === 0) return;

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        return L.divIcon({
          html: `<div class="${styles.clusterIcon}">${count}</div>`,
          className: '',
          iconSize: L.point(36, 36),
        });
      },
    });

    venues.forEach((v) => {
      if (!v.lat || !v.lng) return;
      const going = checkInCounts[v.id] || 0;
      const marker = L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          html: `<div class="${styles.pin}${going > 0 ? ` ${styles.pinHot}` : ''}">${going > 0 ? `🔥${going}` : '📍'}</div>`,
          className: '',
          iconSize: L.point(36, 36),
          iconAnchor: L.point(18, 36),
        }),
      });

      marker.on('click', () => setSelectedVenue(v));
      cluster.addLayer(marker);
    });

    map.addLayer(cluster);
    return () => { map.removeLayer(cluster); };
  }, [venues, checkInCounts]);

  useEffect(() => {
    initMap();
    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, [initMap]);

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate('/')}>
        ← List
      </button>
      <div ref={mapRef} className={styles.map} />

      {/* Map sidebar cards */}
      <div className={styles.cards}>
        {venuesLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.cardSkeleton}`} />
          ))
        ) : (
          venues.filter((v) => v.lat && v.lng).slice(0, 20).map((v) => (
            <button
              key={v.id}
              className={styles.card}
              onClick={() => setSelectedVenue(v)}
            >
              <span className={styles.cardName}>{v.name}</span>
              <span className={styles.cardHood}>{v.neighborhood}</span>
              {v.when_text && <span className={styles.cardWhen}>{v.when_text}</span>}
            </button>
          ))
        )}
      </div>

      {selectedVenue && (
        <VenueSheet
          venue={selectedVenue}
          open={!!selectedVenue}
          onClose={() => setSelectedVenue(null)}
          isFavorite={isFavorite(selectedVenue.id)}
          onToggleFavorite={() => toggleFavorite(selectedVenue.id)}
        />
      )}
    </div>
  );
}
