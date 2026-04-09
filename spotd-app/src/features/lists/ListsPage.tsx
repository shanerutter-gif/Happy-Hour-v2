import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import { showToast } from '../../components/ui/Toast';
import type { List } from '../../types/database';
import styles from './ListsPage.module.css';

export function ListsSection() {
  const { user } = useAuth();
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLists = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('user_lists')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setLists((data || []) as List[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadLists(); }, [loadLists]);

  const createList = async () => {
    if (!user) return;
    const title = prompt('List name:');
    if (!title) return;
    const { error } = await supabase.from('user_lists').insert({
      user_id: user.id,
      title,
      emoji: '📋',
      is_public: true,
    });
    if (error) {
      showToast({ text: 'Failed to create list', type: 'error' });
    } else {
      showToast({ text: 'List created!', type: 'success' });
      loadLists();
    }
  };

  if (!user) return null;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>My Lists</h3>
        <Button size="sm" onClick={createList}>+ New</Button>
      </div>
      <div className={styles.list}>
        {loading ? (
          <div className={`skeleton ${styles.skeleton}`} />
        ) : lists.length === 0 ? (
          <p className={styles.empty}>Create your first list!</p>
        ) : (
          lists.map((list) => (
            <div key={list.id} className={styles.card}>
              <span className={styles.emoji}>{list.cover_emoji}</span>
              <div className={styles.body}>
                <span className={styles.listTitle}>{list.title}</span>
                <span className={styles.meta}>{list.item_count} venues</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
