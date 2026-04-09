import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../components/ui/Toast';
import { haptic } from '../lib/haptic';

export function useFavorites() {
  const { user } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) { setFavoriteIds(new Set()); return; }
    const { data } = await supabase
      .from('favorites')
      .select('item_id')
      .eq('user_id', user.id);
    setFavoriteIds(new Set((data || []).map((f: { item_id: string }) => f.item_id)));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (itemId: string, itemType: string = 'venue') => {
    haptic('light');
    if (!user) {
      showToast({ text: 'Sign in to save favorites', type: 'error' });
      return;
    }
    const isFav = favoriteIds.has(itemId);
    if (isFav) {
      await supabase.from('favorites').delete().eq('user_id', user.id).eq('item_id', itemId);
      setFavoriteIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
      showToast({ text: 'Removed from favorites' });
    } else {
      await supabase.from('favorites').insert({ user_id: user.id, item_id: itemId, item_type: itemType });
      setFavoriteIds((prev) => new Set(prev).add(itemId));
      showToast({ text: 'Saved!', type: 'success' });
    }
  };

  const isFavorite = (itemId: string) => favoriteIds.has(itemId);

  return { favoriteIds, toggle, isFavorite, refresh: load };
}
