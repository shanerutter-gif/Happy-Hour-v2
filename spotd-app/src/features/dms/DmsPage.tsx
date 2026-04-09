import { useState, useEffect, useRef, useCallback, type TouchEvent as ReactTouchEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import styles from './DmsPage.module.css';

// Swipe-to-delete state
const swipeState: { startX: number; el: HTMLElement | null } = { startX: 0, el: null };

interface Thread {
  id: string;
  participants: string[];
  last_message: string | null;
  last_message_at: string | null;
  is_group?: boolean;
  name?: string | null;
  other_name?: string;
  other_avatar?: string;
  unread_count?: number;
  member_names?: string[];
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read: boolean;
  message_type?: string;
  venue_id?: string;
}

export default function DmsPage() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // New DM compose state
  const [showCompose, setShowCompose] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');
  const [composeResults, setComposeResults] = useState<{ id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [composeSending, setComposeSending] = useState(false);
  const composeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadThreads = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('dm_threads')
      .select('*')
      .contains('participants', [user.id])
      .order('last_message_at', { ascending: false });

    const raw = (data || []) as Thread[];

    // Collect all non-self participant IDs across all threads
    const allOtherIds = new Set<string>();
    raw.forEach((t) => {
      t.participants.filter((p) => p !== user.id).forEach((id) => allOtherIds.add(id));
    });
    const otherIds = [...allOtherIds];
    if (otherIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', otherIds);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string; avatar_url: string }) => [p.id, p]));
      raw.forEach((t) => {
        const others = t.participants.filter((p) => p !== user!.id);
        const isGroup = others.length > 1;
        t.is_group = isGroup;
        if (isGroup) {
          // Group: show custom name or concatenated first names
          t.member_names = others.map((id) => {
            const prof = pMap.get(id);
            return prof ? (prof.display_name || 'User').split(' ')[0] : 'User';
          });
          t.other_name = t.name || t.member_names.join(', ');
        } else {
          const profile = others[0] ? pMap.get(others[0]) : undefined;
          if (profile) {
            t.other_name = profile.display_name;
            t.other_avatar = profile.avatar_url;
          }
        }
      });
    }

    // Count unread messages per thread
    if (raw.length) {
      const { data: unreadData } = await supabase
        .from('dm_messages')
        .select('thread_id')
        .in('thread_id', raw.map(t => t.id))
        .neq('sender_id', user.id)
        .eq('read', false);
      const unreadMap: Record<string, number> = {};
      (unreadData || []).forEach((m: { thread_id: string }) => {
        unreadMap[m.thread_id] = (unreadMap[m.thread_id] || 0) + 1;
      });
      raw.forEach(t => { t.unread_count = unreadMap[t.id] || 0; });
    }

    setThreads(raw);
    setLoading(false);
  }, [user]);

  const loadMessages = useCallback(async () => {
    if (!threadId) return;
    const { data } = await supabase
      .from('dm_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    setMessages((data || []) as Message[]);
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    // Mark messages as read
    if (user && data?.length) {
      const unreadIds = data.filter((m: Message) => !m.read && m.sender_id !== user.id).map((m: Message) => m.id);
      if (unreadIds.length) {
        supabase.from('dm_messages').update({ read: true }).in('id', unreadIds);
      }
    }
  }, [threadId, user]);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Real-time subscription for new messages in active thread
  useEffect(() => {
    if (!threadId) return;

    const channel = supabase
      .channel(`dm-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'dm_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      subscriptionRef.current = null;
    };
  }, [threadId]);

  // --- Swipe-to-delete ---
  const handleSwipeStart = (e: ReactTouchEvent) => {
    swipeState.startX = e.touches[0].clientX;
    swipeState.el = e.currentTarget as HTMLElement;
  };

  const handleSwipeMove = (e: ReactTouchEvent) => {
    if (!swipeState.el) return;
    const dx = e.touches[0].clientX - swipeState.startX;
    if (dx < 0) {
      const clamped = Math.max(dx, -80);
      swipeState.el.style.transform = `translateX(${clamped}px)`;
    }
  };

  const handleSwipeEnd = (threadIdToDelete: string) => {
    if (!swipeState.el) return;
    const rect = swipeState.el.getBoundingClientRect();
    const currentX = parseFloat(swipeState.el.style.transform.replace(/[^-\d.]/g, '')) || 0;
    if (currentX < -50) {
      // Show delete button — keep swiped
      swipeState.el.style.transform = 'translateX(-70px)';
      swipeState.el.dataset.swiped = threadIdToDelete;
    } else {
      swipeState.el.style.transform = 'translateX(0)';
    }
    swipeState.el = null;
  };

  const deleteThread = async (tid: string) => {
    if (!user) return;
    // Delete messages then thread
    await supabase.from('dm_messages').delete().eq('thread_id', tid);
    await supabase.from('dm_threads').delete().eq('id', tid);
    setThreads((prev) => prev.filter((t) => t.id !== tid));
    showToast({ text: 'Conversation deleted' });
  };

  // --- New DM compose ---
  const searchComposeUsers = (query: string) => {
    setComposeSearch(query);
    if (composeTimer.current) clearTimeout(composeTimer.current);
    if (query.length < 2) { setComposeResults([]); return; }
    composeTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .ilike('display_name', `%${query}%`)
        .neq('id', user!.id)
        .limit(10);
      setComposeResults((data || []) as typeof composeResults);
    }, 200);
  };

  const startDmWith = async (recipientId: string) => {
    if (!user || composeSending) return;
    setComposeSending(true);
    // Check for existing 1:1 thread
    const { data: existingThreads } = await supabase
      .from('dm_threads')
      .select('*')
      .contains('participants', [user.id, recipientId]);
    const existing = (existingThreads || []).find(
      (t: { participants: string[] }) =>
        t.participants.length === 2 &&
        t.participants.includes(user.id) &&
        t.participants.includes(recipientId)
    );
    if (existing) {
      setShowCompose(false);
      setComposeSearch('');
      setComposeResults([]);
      setComposeSending(false);
      navigate(`/dms/${existing.id}`);
      return;
    }
    // Create new thread
    const { data: newThread } = await supabase
      .from('dm_threads')
      .insert({ participants: [user.id, recipientId] })
      .select('id')
      .single();
    setComposeSending(false);
    setShowCompose(false);
    setComposeSearch('');
    setComposeResults([]);
    if (newThread) {
      navigate(`/dms/${newThread.id}`);
    } else {
      showToast({ text: 'Failed to create conversation', type: 'error' });
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !threadId || !user) return;
    const content = input.trim();
    setInput('');

    const { error } = await supabase.from('dm_messages').insert({
      thread_id: threadId,
      sender_id: user.id,
      content,
    });

    if (error) {
      showToast({ text: 'Failed to send', type: 'error' });
      return;
    }

    await supabase
      .from('dm_threads')
      .update({ last_message: content, last_message_at: new Date().toISOString() })
      .eq('id', threadId);

    // Don't manually reload — realtime will pick up the insert
  };

  const timeAgo = (date: string | null) => {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  if (!user) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <span>💬</span>
          <p>Sign in to message other users</p>
        </div>
      </div>
    );
  }

  // Thread view
  if (threadId) {
    const thread = threads.find((t) => t.id === threadId);
    return (
      <div className={styles.page}>
        <div className={styles.threadHeader}>
          <button className={styles.backBtn} onClick={() => navigate('/dms')}>←</button>
          <div>
            <span className={styles.threadName}>{thread?.other_name || 'Chat'}</span>
            {thread?.is_group && thread.member_names && (
              <div className={styles.memberPills}>
                {thread.member_names.map((name, i) => (
                  <span key={i} className={styles.memberPill}>{name}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={styles.messages}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={[styles.msg, msg.sender_id === user.id ? styles.mine : styles.theirs].join(' ')}
            >
              {msg.message_type === 'venue_share' ? (
                <div
                  className={styles.venueShareBubble}
                  onClick={() => {
                    // Extract venue link from content or navigate via venue_id
                    const urlMatch = msg.content.match(/\?spot=([a-f0-9-]+)/);
                    if (urlMatch) navigate(`/?spot=${urlMatch[1]}`);
                  }}
                >
                  <span className={styles.venueShareIcon}>📍</span>
                  <div className={styles.venueShareText}>
                    {msg.content.split('\n').map((line, i) => (
                      <span key={i}>{line}{i < msg.content.split('\n').length - 1 && <br />}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={styles.bubble}>{msg.content}</div>
              )}
              <span className={styles.msgTime}>
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          <div ref={messagesEnd} />
        </div>
        <div className={styles.compose}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Message..."
          />
          <button className={styles.sendBtn} onClick={sendMessage}>↑</button>
        </div>
      </div>
    );
  }

  // Thread list
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Messages</h1>
        <button className={styles.newDmBtn} onClick={() => setShowCompose(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>

      {/* New DM compose overlay */}
      {showCompose && (
        <div className={styles.composeOverlay}>
          <div className={styles.composeHeader}>
            <button className={styles.backBtn} onClick={() => { setShowCompose(false); setComposeSearch(''); setComposeResults([]); }}>←</button>
            <span className={styles.threadName}>New Message</span>
          </div>
          <input
            className={styles.composeSearchInput}
            placeholder="Search by name..."
            value={composeSearch}
            onChange={(e) => searchComposeUsers(e.target.value)}
            autoFocus
          />
          <div className={styles.composeResultsList}>
            {composeResults.map((p) => (
              <button
                key={p.id}
                className={styles.composeResultRow}
                onClick={() => startDmWith(p.id)}
                disabled={composeSending}
              >
                <div className={styles.threadAvatar}>
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" />
                  ) : (
                    <span>{(p.display_name || 'U').slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <span className={styles.composeResultName}>{p.display_name}</span>
              </button>
            ))}
            {composeSearch.length >= 2 && composeResults.length === 0 && (
              <p className={styles.composeEmpty}>No users found</p>
            )}
          </div>
        </div>
      )}
      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : threads.length === 0 ? (
          <div className={styles.empty}>
            <span>💬</span>
            <p>No messages yet</p>
            <button className={styles.inviteBtn} onClick={async () => {
              const text = 'Check out Spotd — find the best happy hours, events & nightlife near you!';
              const url = window.location.origin;
              if (navigator.share) {
                await navigator.share({ title: 'Spotd', text, url }).catch(() => {});
              } else {
                await navigator.clipboard.writeText(url);
                showToast({ text: 'Link copied!', type: 'success' });
              }
            }}>
              📤 Invite a friend to Spotd
            </button>
          </div>
        ) : (
          threads.map((t) => (
            <div key={t.id} className={styles.threadSwipeWrap}>
              <div
                className={styles.threadSwipeInner}
                onTouchStart={handleSwipeStart}
                onTouchMove={handleSwipeMove}
                onTouchEnd={() => handleSwipeEnd(t.id)}
              >
                <button
                  className={styles.threadRow}
                  onClick={() => navigate(`/dms/${t.id}`)}
                >
                  <div className={styles.threadAvatar}>
                    {t.is_group ? (
                      <span>👥</span>
                    ) : t.other_avatar ? (
                      <img src={t.other_avatar} alt="" />
                    ) : (
                      <span>{(t.other_name || 'U').slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div className={styles.threadBody}>
                    <span className={styles.threadTitle}>{t.other_name || 'User'}</span>
                    <span className={styles.threadPreview}>{t.last_message || 'No messages'}</span>
                  </div>
                  <div className={styles.threadRight}>
                    <span className={styles.threadTime}>{timeAgo(t.last_message_at)}</span>
                    {(t.unread_count || 0) > 0 && <span className={styles.unreadBadge}>{t.unread_count}</span>}
                  </div>
                </button>
              </div>
              <button className={styles.swipeDelete} onClick={() => deleteThread(t.id)}>Delete</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
