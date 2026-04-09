import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useCity } from '../contexts/CityContext';
import type { Venue } from '../types/database';

export function useVenues() {
  const { currentCity } = useCity();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentCity) return;
    setLoading(true);
    const { data } = await supabase
      .from('venues')
      .select('*')
      .eq('city_slug', currentCity.slug)
      .eq('active', true)
      .order('name');
    setVenues((data as Venue[]) || []);
    setLoading(false);
  }, [currentCity]);

  useEffect(() => { load(); }, [load]);

  return { venues, loading, refresh: load };
}

export function useEvents() {
  const { currentCity } = useCity();
  const [events, setEvents] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentCity) return;
    setLoading(true);
    supabase
      .from('events')
      .select('*')
      .eq('city_slug', currentCity.slug)
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        setEvents((data as Venue[]) || []);
        setLoading(false);
      });
  }, [currentCity]);

  return { events, loading };
}

/** Get today's check-in counts for a city */
export function useCheckInCounts() {
  const { currentCity } = useCity();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentCity) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from('check_ins')
      .select('venue_id')
      .eq('city_slug', currentCity.slug)
      .eq('date', today)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data || []).forEach((row: { venue_id: string }) => {
          map[row.venue_id] = (map[row.venue_id] || 0) + 1;
        });
        setCounts(map);
      });
  }, [currentCity]);

  return counts;
}
