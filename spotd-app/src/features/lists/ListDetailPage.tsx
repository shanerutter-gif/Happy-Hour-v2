import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import { showToast } from '../../components/ui/Toast';
import type { List, ListItem } from '../../types/database';
import styles from './ListDetailPage.module.css';

interface EnrichedItem extends ListItem {
  venue_name?: string;
  venue_neighborhood?: string;
}

export default function ListDetailPage() {
  const { listId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [list, setList] = useState<List | null>(null);
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!listId) return;
    setLoading(true);

    const { data: listData } = await supabase.from('user_lists').select('*').eq('id', listId).single();
    setList(listData as List | null);

    const { data: itemData } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('created_at', { ascending: true });

    const raw = (itemData || []) as EnrichedItem[];

    // Enrich with venue names
    const venueIds = raw.map((i) => i.venue_id).filter(Boolean);
    if (venueIds.length) {
      const { data: venues } = await supabase
        .from('venues')
        .select('id, name, neighborhood')
        .in('id', venueIds);
      const vMap = new Map((venues || []).map((v: { id: string; name: string; neighborhood: string }) => [v.id, v]));
      raw.forEach((item) => {
        const v = vMap.get(item.venue_id);
        if (v) {
          item.venue_name = v.name;
          item.venue_neighborhood = v.neighborhood;
        }
      });
    }

    setItems(raw);
    setLoading(false);
  }, [listId]);

  useEffect(() => { load(); }, [load]);

  const removeItem = async (itemId: string) => {
    await supabase.from('list_items').delete().eq('id', itemId);
    showToast({ text: 'Removed from list' });
    load();
  };

  const deleteList = async () => {
    if (!listId) return;
    await supabase.from('list_items').delete().eq('list_id', listId);
    await supabase.from('user_lists').delete().eq('id', listId);
    showToast({ text: 'List deleted' });
    navigate(-1);
  };

  const shareList = async () => {
    if (!list) return;
    const url = `${window.location.origin}/lists/${list.id}`;
    if (navigator.share) {
      await navigator.share({ title: list.title, text: `Check out my list: ${list.title}`, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
      showToast({ text: 'Link copied!', type: 'success' });
    }
  };

  const isOwner = user && list && list.user_id === user.id;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <h1 className={styles.title}>{list?.emoji} {list?.title || 'List'}</h1>
      </div>

      {list?.description && <p className={styles.desc}>{list.description}</p>}

      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={shareList}>📤 Share</Button>
        {isOwner && <Button size="sm" variant="ghost" onClick={deleteList}>🗑 Delete</Button>}
      </div>

      <div className={styles.items}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <span>📋</span>
            <p>No venues in this list yet</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className={styles.itemRow}>
              <div className={styles.itemBody}>
                <span className={styles.itemName}>{item.venue_name || 'Venue'}</span>
                {item.venue_neighborhood && (
                  <span className={styles.itemHood}>{item.venue_neighborhood}</span>
                )}
                {item.note && <span className={styles.itemNote}>{item.note}</span>}
              </div>
              {isOwner && (
                <button className={styles.removeBtn} onClick={() => removeItem(item.id)}>×</button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
