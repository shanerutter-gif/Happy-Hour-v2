import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

export interface City {
  slug: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  enabled: boolean;
}

interface CityState {
  cities: City[];
  currentCity: City | null;
  setCity: (slug: string) => void;
  loading: boolean;
}

const CityContext = createContext<CityState | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const [cities, setCities] = useState<City[]>([]);
  const [currentCity, setCurrentCity] = useState<City | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCities() {
      const { data } = await supabase
        .from('cities')
        .select('*')
        .order('name');
      if (data) {
        setCities(data as City[]);
        const saved = localStorage.getItem('spotd-city');
        const match = data.find((c: City) => c.slug === saved) || data.find((c: City) => c.enabled);
        if (match) setCurrentCity(match as City);
      }
      setLoading(false);
    }
    loadCities();
  }, []);

  const setCity = (slug: string) => {
    const city = cities.find((c) => c.slug === slug);
    if (city) {
      setCurrentCity(city);
      localStorage.setItem('spotd-city', slug);
    }
  };

  return (
    <CityContext.Provider value={{ cities, currentCity, setCity, loading }}>
      {children}
    </CityContext.Provider>
  );
}

export function useCity() {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error('useCity must be used within CityProvider');
  return ctx;
}
