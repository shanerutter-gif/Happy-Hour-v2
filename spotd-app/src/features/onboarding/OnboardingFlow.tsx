import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { haptic } from '../../lib/haptic';
import styles from './OnboardingFlow.module.css';

const OB_KEY = 'spotd-ob-complete';

const NEIGHBORHOODS = [
  { name: 'North Park', deals: 8, popular: true },
  { name: 'Downtown', deals: 12, popular: false },
  { name: 'Little Italy', deals: 9, popular: false },
  { name: 'Gaslamp', deals: 6, popular: false },
  { name: 'Pacific Beach', deals: 7, popular: false },
  { name: 'Hillcrest', deals: 5, popular: false },
  { name: 'East Village', deals: 6, popular: false },
  { name: 'Ocean Beach', deals: 4, popular: false },
  { name: 'La Jolla', deals: 3, popular: false },
  { name: 'Mission Hills', deals: 5, popular: false },
];

const VIBES = [
  { id: 'cocktails', emoji: '🍸', label: 'Craft cocktails' },
  { id: 'dive', emoji: '🍺', label: 'Dive bars' },
  { id: 'rooftop', emoji: '🌅', label: 'Rooftop views' },
  { id: 'music', emoji: '🎵', label: 'Live music' },
  { id: 'wine', emoji: '🍷', label: 'Wine bars' },
  { id: 'food', emoji: '🌮', label: 'Food + drinks' },
  { id: 'brunch', emoji: '🥂', label: 'Boozy brunch' },
  { id: 'sports', emoji: '🏈', label: 'Sports bars' },
  { id: 'tiki', emoji: '🌴', label: 'Tiki bars' },
  { id: 'date', emoji: '💕', label: 'Date night' },
];

const FEATURED_VENUES = [
  { name: 'Coin-Op Game Room', deal: '$5 arcade tokens + $6 craft beers', hood: 'North Park', time: 'HH 4\u20137pm' },
  { name: 'Kettner Exchange', deal: '$8 cocktails + $2 oysters', hood: 'Little Italy', time: 'HH 4\u20136pm' },
  { name: 'Wonderland OB', deal: '$5 margs + ocean view', hood: 'Ocean Beach', time: 'HH 3\u20136pm' },
  { name: 'The Grass Skirt', deal: '$7 tiki cocktails', hood: 'Pacific Beach', time: 'HH 4\u20137pm' },
  { name: 'Raised by Wolves', deal: '$10 speakeasy cocktails', hood: 'East Village', time: 'HH 5\u20137pm' },
  { name: 'Cannonball', deal: '$6 poolside margs', hood: 'Mission Beach', time: 'HH 3\u20135pm' },
  { name: 'Craft & Commerce', deal: '$7 old fashioneds', hood: 'Little Italy', time: 'HH 5\u20137pm' },
  { name: 'Fairweather', deal: '$6 rooftop spritzes', hood: 'North Park', time: 'HH 4\u20136pm' },
];

const SCREEN1_HEADLINES = [
  { title: '{count} deals are live right now.', sub: 'See what\u2019s happening tonight near you.' },
  { title: '{count} happy hours happening now.', sub: 'The best deals in San Diego, updated live.' },
  { title: '{count} spots are popping off tonight.', sub: 'Find out where the locals are heading.' },
  { title: 'Tonight looks good \u2014 {count} deals live.', sub: 'Don\u2019t miss what\u2019s happening near you.' },
];

const SCREEN2_HEADLINES = [
  { title: 'What\u2019s your vibe tonight?', sub: 'Pick all that apply \u2014 we\u2019ll show you the best spots.' },
  { title: 'What are you in the mood for?', sub: 'Choose a few \u2014 we\u2019ll match you with the best deals.' },
  { title: 'Tell us what you\u2019re into.', sub: 'We\u2019ll curate the perfect night for you.' },
  { title: 'How do you like to go out?', sub: 'Pick your favorites and we\u2019ll do the rest.' },
];

const SCREEN3_HEADLINES = [
  { title: 'Where in San Diego?', sub: '{total} deals live across the city tonight' },
  { title: 'Pick your neighborhood.', sub: '{total} spots are serving deals right now' },
  { title: 'Where are you headed tonight?', sub: '{total} happy hours live across San Diego' },
  { title: 'Choose your turf.', sub: 'We\u2019ve got {total} deals waiting for you' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function shouldShowOnboarding(userId: string | undefined): boolean {
  if (userId) return false;
  if (localStorage.getItem(OB_KEY)) return false;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return false;
  }
  return true;
}

export default function OnboardingFlow() {
  const navigate = useNavigate();
  const { signInWithGoogle } = useAuth();
  const [screen, setScreen] = useState(0);
  const [selectedVibes, setSelectedVibes] = useState<Set<string>>(new Set());
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<{ name: string; deals: number } | null>(null);
  const [liveCount, setLiveCount] = useState(47);
  const [email, setEmail] = useState('');
  const [closing, setClosing] = useState(false);

  // Randomized content — stable per mount
  const featured = useMemo(() => pick(FEATURED_VENUES), []);
  const h1 = useMemo(() => pick(SCREEN1_HEADLINES), []);
  const h2 = useMemo(() => pick(SCREEN2_HEADLINES), []);
  const h3 = useMemo(() => pick(SCREEN3_HEADLINES), []);
  const vibes = useMemo(() => shuffle(VIBES).slice(0, 6), []);
  const neighborhoods = useMemo(() => {
    const shuffled = shuffle(NEIGHBORHOODS);
    const popIdx = Math.floor(Math.random() * Math.min(3, shuffled.length));
    return shuffled.map((n, i) => ({ ...n, showPopular: i === popIdx }));
  }, []);
  const totalDeals = neighborhoods.reduce((s, n) => s + n.deals, 0);

  // Live counter tick
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveCount((c) => {
        const delta = Math.floor(Math.random() * 5) - 2;
        return Math.max(32, Math.min(89, c + delta));
      });
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  const complete = useCallback(() => {
    localStorage.setItem(OB_KEY, '1');
    localStorage.removeItem('spotd-ob-pending');
    setClosing(true);
    setTimeout(() => navigate('/', { replace: true }), 350);
  }, [navigate]);

  const goTo = (idx: number) => {
    haptic('light');
    setScreen(idx);
  };

  const toggleVibe = (id: string) => {
    haptic('light');
    setSelectedVibes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectNeighborhood = (name: string, deals: number) => {
    haptic('medium');
    setSelectedNeighborhood({ name, deals });
    setTimeout(() => goTo(4), 300);
  };

  const handleEmailSignup = () => {
    if (!email.trim() || !email.includes('@')) return;
    haptic('medium');
    complete();
    navigate('/auth', { replace: true });
  };

  const handleGoogleSignup = async () => {
    haptic('medium');
    localStorage.setItem('spotd-ob-pending', '1');
    await signInWithGoogle();
  };

  const timerH = Math.floor(Math.random() * 3) + 1;
  const timerM = Math.floor(Math.random() * 50) + 10;

  return (
    <div className={[styles.overlay, closing && styles.closing].filter(Boolean).join(' ')}>
      {/* Progress dots */}
      <div className={styles.progress}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={[styles.dot, i <= screen && styles.dotActive].filter(Boolean).join(' ')} />
        ))}
      </div>

      {/* Screen 0: Welcome splash */}
      <div className={[styles.screen, screen === 0 && styles.screenActive, screen > 0 && styles.screenPrev].filter(Boolean).join(' ')}>
        <div className={styles.welcomeIcon}>🍻</div>
        <h1 className={styles.bigTitle}>spotd</h1>
        <p className={styles.subtitle}>The best happy hours, live.</p>
        <button className={styles.primaryBtn} onClick={() => goTo(1)}>
          Find tonight's deals
        </button>
        <button className={styles.ghostBtn} onClick={complete}>
          Skip for now
        </button>
      </div>

      {/* Screen 1: Value preview — live deals map */}
      <div className={[styles.screen, screen === 1 && styles.screenActive, screen > 1 && styles.screenPrev, screen < 1 && styles.screenNext].filter(Boolean).join(' ')}>
        <button className={styles.backBtn} onClick={() => goTo(0)}>←</button>
        <h2 className={styles.title}>
          {h1.title.replace('{count}', String(liveCount))}
        </h2>
        <p className={styles.sub}>{h1.sub}</p>

        <div className={styles.previewCard}>
          <div className={styles.previewTag}>{featured.hood}</div>
          <div className={styles.previewName}>{featured.name}</div>
          <div className={styles.previewDeal}>{featured.deal} · {featured.time}</div>
          <div className={styles.previewMeta}>
            {featured.hood} · Ends in <span className={styles.timer}>{timerH}h {timerM}m</span>
          </div>
        </div>

        <div className={styles.liveBar}>
          <span className={styles.liveDot} />
          <span className={styles.liveText}>{liveCount} deals live right now</span>
        </div>

        <button className={styles.primaryBtn} onClick={() => goTo(2)}>
          Show me deals →
        </button>
      </div>

      {/* Screen 2: Vibe picker */}
      <div className={[styles.screen, screen === 2 && styles.screenActive, screen > 2 && styles.screenPrev, screen < 2 && styles.screenNext].filter(Boolean).join(' ')}>
        <button className={styles.backBtn} onClick={() => goTo(1)}>←</button>
        <h2 className={styles.title}>{h2.title}</h2>
        <p className={styles.sub}>{h2.sub}</p>

        <div className={styles.vibeGrid}>
          {vibes.map((v) => (
            <button
              key={v.id}
              className={[styles.vibeCard, selectedVibes.has(v.id) && styles.vibeSelected].filter(Boolean).join(' ')}
              onClick={() => toggleVibe(v.id)}
            >
              <span className={styles.vibeEmoji}>{v.emoji}</span>
              <span className={styles.vibeLabel}>{v.label}</span>
            </button>
          ))}
        </div>

        <button className={styles.primaryBtn} onClick={() => goTo(3)}>
          {selectedVibes.size > 0 ? "That's my vibe →" : 'Skip for now →'}
        </button>
      </div>

      {/* Screen 3: Neighborhood picker */}
      <div className={[styles.screen, screen === 3 && styles.screenActive, screen > 3 && styles.screenPrev, screen < 3 && styles.screenNext].filter(Boolean).join(' ')}>
        <button className={styles.backBtn} onClick={() => goTo(2)}>←</button>
        <h2 className={styles.title}>{h3.title}</h2>
        <p className={styles.sub}>{h3.sub.replace('{total}', String(totalDeals))}</p>

        <div className={styles.neighGrid}>
          {neighborhoods.map((n) => (
            <button
              key={n.name}
              className={[
                styles.neighBtn,
                n.showPopular && styles.neighPopular,
                selectedNeighborhood?.name === n.name && styles.neighSelected,
              ].filter(Boolean).join(' ')}
              onClick={() => selectNeighborhood(n.name, n.deals)}
            >
              {n.showPopular && <span className={styles.popularBadge}>🔥 Most popular tonight</span>}
              <span className={styles.neighName}>{n.name}</span>
              <span className={styles.neighDeals}>{n.deals} deals live</span>
            </button>
          ))}
        </div>
      </div>

      {/* Screen 4: Signup */}
      <div className={[styles.screen, screen === 4 && styles.screenActive, screen < 4 && styles.screenNext].filter(Boolean).join(' ')}>
        <button className={styles.backBtn} onClick={() => goTo(3)}>←</button>
        <h2 className={styles.title}>
          We found {selectedNeighborhood?.deals || 23} happy hours matching your vibe
          in {selectedNeighborhood?.name || 'San Diego'}
        </h2>
        <p className={styles.sub}>Create your free account to see them all.</p>

        <input
          className={styles.emailInput}
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleEmailSignup()}
        />
        <button className={styles.primaryBtn} onClick={handleEmailSignup}>
          Continue with email
        </button>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <button className={styles.socialBtn} onClick={handleGoogleSignup}>
          <span>G</span> Continue with Google
        </button>

        <button className={styles.ghostBtn} onClick={complete}>
          Browse as guest
        </button>
      </div>
    </div>
  );
}
