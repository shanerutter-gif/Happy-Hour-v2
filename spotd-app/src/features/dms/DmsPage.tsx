import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/ui/Toast';
import styles from './DmsPage.module.css';

interface Thread {
  id: string;
  participants: string[];
  last_message: string | null;
  last_message_at: string | null;
  other_name?: string;
  other_avatar?: string;
  unread_count?: number;
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read: boolean;
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

  const loadThreads = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('dm_threads')
      .select('*')
      .contains('participants', [user.id])
      .order('last_message_at', { ascending: false });

    const raw = (data || []) as Thread[];

    const otherIds = raw.map((t) => t.participants.find((p) => p !== user.id)).filter(Boolean) as string[];
    if (otherIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', otherIds);
      const pMap = new Map((profiles || []).map((p: { id: string; display_name: string; avatar_url: string }) => [p.id, p]));
      raw.forEach((t) => {
        const otherId = t.participants.find((p) => p !== user!.id);
        const profile = otherId ? pMap.get(otherId) : undefined;
        if (profile) {
          t.other_name = profile.display_name;
          t.other_avatar = profile.avatar_url;
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
          <span className={styles.threadName}>{thread?.other_name || 'Chat'}</span>
        </div>
        <div className={styles.messages}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={[styles.msg, msg.sender_id === user.id ? styles.mine : styles.theirs].join(' ')}
            >
              <div className={styles.bubble}>{msg.content}</div>
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
      </div>
      <div className={styles.list}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skeleton}`} />
          ))
        ) : threads.length === 0 ? (
          <div className={styles.empty}>
            <span>💬</span>
            <p>No messages yet</p>
          </div>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              className={styles.threadRow}
              onClick={() => navigate(`/dms/${t.id}`)}
            >
              <div className={styles.threadAvatar}>
                {t.other_avatar ? (
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
          ))
        )}
      </div>
    </div>
  );
}
