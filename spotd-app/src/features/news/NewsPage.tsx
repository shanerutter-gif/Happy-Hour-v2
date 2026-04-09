import { useMemo } from 'react';
import { useCity } from '../../contexts/CityContext';
import styles from './NewsPage.module.css';

interface Article {
  city: string;
  img: string;
  tag: string;
  author: string;
  title: string;
  excerpt: string;
  url: string;
  date: string;
  readTime: string;
}

const NEWS_ARTICLES: Article[] = [
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80', tag: 'Events', author: 'Shane', title: 'San Diego Weekend Events: April 3\u20135, 2026', excerpt: 'Drone art shows, North Park Festival of Beers, Easter brunch, four Friday night markets, live tributes at Belly Up, and 25+ things to do this Easter weekend.', url: '/blog/sd-weekend-events-april-3-5-2026.html', date: 'April 2, 2026', readTime: '10 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&q=80', tag: 'City Guide', author: 'Shane', title: 'Best Happy Hours in Pacific Beach (2026)', excerpt: '$2.50 beers at Rocky\u2019s, rooftop sushi at Cannonball, $3.50 drafts at Duck Dive \u2014 every PB happy hour worth your time.', url: '/blog/best-happy-hours-pacific-beach.html', date: 'March 31, 2026', readTime: '9 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=800&q=80', tag: 'City Guide', author: 'Shane', title: 'The Best Burritos in San Diego, Ranked', excerpt: 'La Perla\u2019s viral Oaxacalifornia, Lolita\u2019s classic California burrito, and 7 more spots locals swear by.', url: '/blog/best-burritos-san-diego.html', date: 'March 31, 2026', readTime: '8 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800&q=80', tag: 'City Guide', author: 'Alexis', title: 'Best Tacos in San Diego: A Neighborhood Guide', excerpt: 'Tacos El Gordo\u2019s adobada, LOLA 55\u2019s Michelin creations, Mike\u2019s Red birria, Oscar\u2019s fish tacos \u2014 12 spots across every neighborhood.', url: '/blog/best-tacos-san-diego.html', date: 'March 30, 2026', readTime: '9 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1538970272646-f61fabb3a8a2?w=800&q=80', tag: 'City Guide', author: 'Ryan', title: 'A Local\u2019s Ultimate San Diego To-Do List', excerpt: 'Windansea sunsets, Torrey Pines hikes, sea cave kayaking, PopUp Bagels, and the spots only locals know.', url: '/blog/locals-san-diego-to-do-list.html', date: 'March 30, 2026', readTime: '9 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=80', tag: 'City Guide', author: 'John', title: '10 Happy Hour Spots San Diego Locals Swear By', excerpt: 'Skip the tourist traps. $1 oysters, 2-for-1 drinks, $7 wine, and late-night steals \u2014 the spots locals actually go to.', url: '/blog/happy-hour-spots-locals-love-san-diego.html', date: 'March 29, 2026', readTime: '7 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=800&q=80', tag: 'Events', author: 'Shane', title: 'San Diego Weekend Events: March 27\u201329, 2026', excerpt: 'Happy Opening Day. Padres vs. Tigers, Crew Classic, IRONMAN 70.3, Wave FC, live music, markets, and 30+ things to do this weekend.', url: '/blog/sd-weekend-events-march-27-29-2026.html', date: 'March 27, 2026', readTime: '12 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1436076863939-06870fe779c2?w=800&q=80', tag: 'City Guide', author: 'Alexis', title: 'The 15 Best Happy Hours in San Diego (2026)', excerpt: 'From $5 margs in the Gaslamp to ocean-view pints in Pacific Beach \u2014 our definitive guide to San Diego\u2019s best happy hour deals.', url: '/blog/best-happy-hours-san-diego.html', date: 'March 25, 2026', readTime: '8 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1543007631-283050bb3e8c?w=800&q=80', tag: 'Events', author: 'Ryan', title: 'Best Trivia Nights in San Diego \u2014 Every Day of the Week', excerpt: 'Whether you\u2019re a Tuesday regular or a weekend warrior, here\u2019s where to flex your brain and score free drinks.', url: '/blog/best-trivia-nights-san-diego.html', date: 'March 24, 2026', readTime: '7 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80', tag: 'Niche Guide', author: 'John', title: 'San Diego Rooftop Happy Hours You Can\u2019t Miss', excerpt: 'Sunset views + drink specials = peak San Diego. These rooftop bars deliver both, without the tourist-trap prices.', url: '/blog/rooftop-happy-hours-san-diego.html', date: 'March 22, 2026', readTime: '6 min' },
  { city: 'all', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&q=80', tag: 'Tips', author: 'Shane', title: 'How to Find the Best Happy Hour Deals Near You', excerpt: 'Stop guessing, start saving. Here\u2019s the playbook for finding killer drink and food specials wherever you are.', url: '/blog/how-to-find-best-happy-hour-deals.html', date: 'March 20, 2026', readTime: '5 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1501612780327-45045538702b?w=800&q=80', tag: 'Events', author: 'Alexis', title: 'Live Music + Happy Hour: San Diego\u2019s Best Combos', excerpt: 'Why choose between cheap drinks and great music? These San Diego spots serve both \u2014 and they\u2019re all on Spotd.', url: '/blog/live-music-happy-hours-san-diego.html', date: 'March 18, 2026', readTime: '6 min' },
];

export default function NewsPage() {
  const { currentCity } = useCity();
  const citySlug = currentCity?.slug || 'san-diego';
  const cityName = currentCity?.name || 'San Diego';

  const articles = useMemo(() =>
    NEWS_ARTICLES.filter(a => a.city === citySlug || a.city === 'all'),
    [citySlug]
  );

  if (!articles.length) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <img src="/spotd_logo_v5.png" alt="Spotd" className={styles.logo} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <div className={styles.empty}>
          <span>📰</span>
          <p>No articles for this city yet — stay tuned!</p>
        </div>
      </div>
    );
  }

  const hero = articles[0];
  const rest = articles.slice(1);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <img src="/spotd_logo_v5.png" alt="Spotd" className={styles.logo} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>

      <div className={styles.cityLabel}>{cityName}</div>

      <a href={`${hero.url}?inapp=1`} target="_blank" rel="noopener noreferrer" className={styles.hero}>
        <img src={hero.img} alt="" className={styles.heroImg} loading="eager" />
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <span className={styles.heroTag}>{hero.tag}</span>
          <div className={styles.heroTitle}>{hero.title}</div>
          <div className={styles.heroMeta}>By {hero.author} · {hero.readTime} read</div>
        </div>
      </a>

      <div className={styles.grid}>
        {rest.map((a, i) => (
          <a key={i} href={`${a.url}?inapp=1`} target="_blank" rel="noopener noreferrer" className={styles.card}>
            <div className={styles.cardImgWrap}>
              <img src={a.img} alt="" className={styles.cardImg} loading="lazy" />
            </div>
            <div className={styles.cardBody}>
              <span className={styles.cardTag}>{a.tag}</span>
              <div className={styles.cardTitle}>{a.title}</div>
              <div className={styles.cardMeta}>By {a.author} · {a.readTime} read</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
