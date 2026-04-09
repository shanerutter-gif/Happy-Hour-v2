import { createContext, useContext, useState, type ReactNode } from 'react';

export interface City {
  slug: string;
  name: string;
  state_code: string;
  lat: number;
  lng: number;
  active: boolean;
}

const CITIES: City[] = [
  { slug: 'san-diego',     name: 'San Diego',     state_code: 'CA', lat: 32.7157, lng: -117.1611, active: true },
  { slug: 'los-angeles',   name: 'Los Angeles',   state_code: 'CA', lat: 34.0522, lng: -118.2437, active: false },
  { slug: 'new-york',      name: 'New York',      state_code: 'NY', lat: 40.7128, lng: -74.0060, active: false },
  { slug: 'chicago',       name: 'Chicago',       state_code: 'IL', lat: 41.8781, lng: -87.6298, active: false },
  { slug: 'austin',        name: 'Austin',        state_code: 'TX', lat: 30.2672, lng: -97.7431, active: false },
  { slug: 'miami',         name: 'Miami',         state_code: 'FL', lat: 25.7617, lng: -80.1918, active: false },
  { slug: 'orange-county', name: 'Orange County', state_code: 'CA', lat: 33.7175, lng: -117.8311, active: false },
];

interface CityState {
  cities: City[];
  currentCity: City | null;
  setCity: (slug: string) => void;
  loading: boolean;
}

const CityContext = createContext<CityState | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const saved = localStorage.getItem('spotd-last-city') || localStorage.getItem('spotd-city');
  const initial = CITIES.find((c) => c.slug === saved && c.active) || CITIES.find((c) => c.active) || CITIES[0];
  const [currentCity, setCurrentCity] = useState<City | null>(initial);

  const setCity = (slug: string) => {
    const city = CITIES.find((c) => c.slug === slug);
    if (city) {
      setCurrentCity(city);
      localStorage.setItem('spotd-last-city', slug);
    }
  };

  return (
    <CityContext.Provider value={{ cities: CITIES, currentCity, setCity, loading: false }}>
      {children}
    </CityContext.Provider>
  );
}

export function useCity() {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error('useCity must be used within CityProvider');
  return ctx;
}
