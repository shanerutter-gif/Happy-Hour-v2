import { createContext, useContext, useState, type ReactNode } from 'react';

export interface City {
  slug: string;
  name: string;
  state_code: string;
  active: boolean;
}

const CITIES: City[] = [
  { slug: 'san-diego',     name: 'San Diego',     state_code: 'CA', active: true },
  { slug: 'los-angeles',   name: 'Los Angeles',   state_code: 'CA', active: false },
  { slug: 'new-york',      name: 'New York',      state_code: 'NY', active: false },
  { slug: 'chicago',       name: 'Chicago',       state_code: 'IL', active: false },
  { slug: 'austin',        name: 'Austin',        state_code: 'TX', active: false },
  { slug: 'miami',         name: 'Miami',         state_code: 'FL', active: false },
  { slug: 'orange-county', name: 'Orange County', state_code: 'CA', active: false },
];

interface CityState {
  cities: City[];
  currentCity: City | null;
  setCity: (slug: string) => void;
  loading: boolean;
}

const CityContext = createContext<CityState | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const saved = localStorage.getItem('spotd-city');
  const initial = CITIES.find((c) => c.slug === saved) || CITIES.find((c) => c.active) || CITIES[0];
  const [currentCity, setCurrentCity] = useState<City | null>(initial);

  const setCity = (slug: string) => {
    const city = CITIES.find((c) => c.slug === slug);
    if (city) {
      setCurrentCity(city);
      localStorage.setItem('spotd-city', slug);
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
