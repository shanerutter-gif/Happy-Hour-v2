import { useState, useEffect, useCallback } from 'react';

interface GeoState {
  lat: number | null;
  lng: number | null;
  error: string | null;
  loading: boolean;
}

const CACHE_KEY = 'spotd-geo';

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { lat, lng } = JSON.parse(cached);
      return { lat, lng, error: null, loading: false };
    }
    return { lat: null, lng: null, error: null, loading: false };
  });

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: 'Geolocation not supported' }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lng }));
        setState({ lat, lng, error: null, loading: false });
      },
      (err) => {
        setState((s) => ({ ...s, error: err.message, loading: false }));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }, []);

  // Auto-request on mount if not cached
  useEffect(() => {
    if (state.lat === null && state.lng === null) {
      request();
    }
  }, []);

  const distanceTo = (lat: number | null, lng: number | null): number | null => {
    if (state.lat === null || state.lng === null || lat === null || lng === null) return null;
    return haversine(state.lat, state.lng, lat, lng);
  };

  return { ...state, request, distanceTo };
}
