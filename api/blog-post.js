export const config = { runtime: 'edge' };

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Simple Markdown to HTML converter ────────── */
function md(text) {
  if (!text) return '';
  let html = text
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold & italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)(?:\s*<br>)?/gs, '$1');
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');

  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br>');

  // Wrap in paragraph
  html = '<p>' + html + '</p>';
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  // Don't wrap block elements in paragraphs
  html = html.replace(/<p>\s*(<h[1-3]|<ul|<blockquote|<pre|<hr|<img)/g, '$1');
  html = html.replace(/(<\/h[1-3]>|<\/ul>|<\/blockquote>|<\/pre>|<hr>)\s*<\/p>/g, '$1');

  return html;
}

/* ── Fetch post from Supabase ────────────────── */
async function fetchPost(supabaseUrl, serviceKey, slug) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const posts = await res.json();
  return posts.length ? posts[0] : null;
}

/* ── Build the page ──────────────────────────── */
function buildPage(post) {
  const title = esc(post.title);
  const author = esc(post.author || 'Spotd');
  const authorInitial = (post.author || 'S')[0].toUpperCase();
  const tag = esc(post.tag || 'City Guide');
  const excerpt = esc(post.excerpt || '');
  const metaDesc = esc(post.meta_description || post.excerpt || '');
  const keywords = esc(post.keywords || '');
  const featuredImage = post.featured_image_url || 'https://spotd.biz/icons/icon-512.png';
  const slug = esc(post.slug);
  const canonicalUrl = `https://spotd.biz/blog/${slug}`;
  const dateStr = post.created_at ? new Date(post.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const contentHtml = md(post.content || '');

  // Estimate reading time
  const wordCount = (post.content || '').split(/\s+/).length;
  const readTime = Math.max(1, Math.round(wordCount / 200));

  // Encoded title for sharing
  const encodedTitle = encodeURIComponent(post.title);

  // JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description || post.excerpt || '',
    datePublished: post.created_at,
    dateModified: post.updated_at || post.created_at,
    author: { '@type': 'Organization', name: 'Spotd', url: 'https://spotd.biz' },
    publisher: {
      '@type': 'Organization', name: 'Spotd',
      logo: { '@type': 'ImageObject', url: 'https://spotd.biz/icons/icon-512.png' }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://spotd.biz' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://spotd.biz/blog.html' },
      { '@type': 'ListItem', position: 3, name: post.title, item: canonicalUrl }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<script>
(function(){
  var t = localStorage.getItem('spotd-theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
</script>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-5271Q2407Q"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-5271Q2407Q');
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Spotd</title>
<meta name="description" content="${metaDesc}">
<link rel="canonical" href="${canonicalUrl}">

<meta property="og:type" content="article">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:image" content="${esc(featuredImage)}">
<meta property="og:site_name" content="Spotd">
<meta property="article:published_time" content="${post.created_at || ''}">
<meta property="article:author" content="Spotd">
<meta property="article:section" content="${tag}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${metaDesc}">
<meta name="twitter:image" content="${esc(featuredImage)}">

<meta name="robots" content="index, follow">
${keywords ? `<meta name="keywords" content="${keywords}">` : ''}

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;500;700;800;900&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/blog.css">
</head>
<body>

<!-- Reading Progress Bar -->
<div class="blog-progress" id="blogProgress"></div>

<nav class="blog-nav">
  <a href="/" class="nav-brand">
    <img src="/spotd_logo_v5.png" alt="Spotd" class="nav-logo-img"
      onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
    <span style="display:none">Spotd</span>
  </a>
  <div class="blog-nav-links">
    <a href="/" class="blog-nav-link">App</a>
    <a href="/blog.html" class="blog-nav-link blog-nav-link--active">Blog</a>
    <a href="/" class="blog-nav-cta">Open App</a>
  </div>
  <a href="javascript:history.back()" class="blog-nav-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Back</a>
</nav>
<script>if(window.navigator.standalone||window.matchMedia('(display-mode:standalone)').matches||/[?&]inapp=1/.test(location.search))document.documentElement.classList.add('standalone');</script>

<!-- Share toast -->
<div class="blog-share-toast" id="shareToast">Link copied!</div>

<article class="blog-article">
  <header class="blog-article-header">
    <a href="/blog.html" class="blog-back">&larr; Back to Blog</a>
    <span class="blog-card-tag">${tag}</span>
    <h1 class="blog-article-title">${title}</h1>
    ${excerpt ? `<p class="blog-article-subtitle">${esc(excerpt)}</p>` : ''}
    <div class="blog-article-meta">
      <span>By ${author}</span>
      ${dateStr ? `<span>${dateStr}</span>` : ''}
      <span>${readTime} min read</span>
    </div>

    <div class="blog-share">
      <span class="blog-share-label">Share</span>
      <a class="blog-share-btn" href="https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodeURIComponent(canonicalUrl)}" target="_blank" rel="noopener" title="Share on X">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
      <a class="blog-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl)}" target="_blank" rel="noopener" title="Share on Facebook">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
      </a>
      <a class="blog-share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(canonicalUrl)}" target="_blank" rel="noopener" title="Share on LinkedIn">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
      </a>
      <button class="blog-share-btn" onclick="blogCopyLink()" title="Copy link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
    </div>
  </header>

  <nav class="blog-toc" id="blogToc">
    <div class="blog-toc-title">📋 In this article</div>
    <ul class="blog-toc-list" id="blogTocList"></ul>
  </nav>

  <div class="blog-article-body" id="blogBody">
    ${contentHtml}

    <div class="blog-cta-inline">
      <a href="/" class="blog-cta-btn">Explore Spots on Spotd</a>
    </div>

    <div class="blog-newsletter">
      <div class="blog-newsletter-icon">📬</div>
      <div class="blog-newsletter-title">Get the best deals in your inbox</div>
      <div class="blog-newsletter-sub">Weekly happy hour picks, new spots, and local events — no spam, just good times.</div>
      <form class="blog-newsletter-form" onsubmit="blogNewsletterSubmit(event)">
        <input type="email" class="blog-newsletter-input" placeholder="your@email.com" required>
        <button type="submit" class="blog-newsletter-btn">Subscribe</button>
      </form>
    </div>

    <div class="blog-author">
      <div class="blog-author-avatar">${authorInitial}</div>
      <div>
        <div class="blog-author-name">${author}</div>
        <div class="blog-author-role">Spotd Editorial — discovering the best spots since 2025</div>
      </div>
    </div>
  </div>
</article>

<footer class="blog-footer">
  <div class="blog-footer-inner">
    <p class="blog-footer-brand">Spotd</p>
    <p class="blog-footer-copy">&copy; 2026 Spotd. All rights reserved.</p>
    <div class="blog-footer-links">
      <a href="/">Home</a>
      <a href="/blog.html">Blog</a>
      <a href="/business-landing.html">For Business</a>
    </div>
  </div>
</footer>

<script>
(function(){
  var bar = document.getElementById('blogProgress');
  if (!bar) return;
  window.addEventListener('scroll', function(){
    var h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (h > 0 ? (window.scrollY / h * 100) : 0) + '%';
  }, {passive:true});
})();
(function(){
  var body = document.getElementById('blogBody');
  var tocList = document.getElementById('blogTocList');
  if (!body || !tocList) return;
  var headings = body.querySelectorAll('h2, h3');
  if (headings.length < 3) { document.getElementById('blogToc').style.display = 'none'; return; }
  headings.forEach(function(h, i){
    if (!h.id) h.id = 'section-' + i;
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    if (h.tagName === 'H3') a.className = 'toc-h3';
    var li = document.createElement('li');
    li.appendChild(a);
    tocList.appendChild(li);
  });
  var links = tocList.querySelectorAll('a');
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) {
        links.forEach(function(l){ l.classList.remove('active'); });
        var active = tocList.querySelector('a[href="#'+e.target.id+'"]');
        if (active) active.classList.add('active');
      }
    });
  }, {rootMargin:'-80px 0px -60% 0px'});
  headings.forEach(function(h){ observer.observe(h); });
})();
function blogCopyLink(){
  navigator.clipboard.writeText(window.location.href).then(function(){
    var t = document.getElementById('shareToast');
    t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 2000);
  });
}
function blogNewsletterSubmit(e){
  e.preventDefault();
  var email = e.target.querySelector('input').value;
  if (!email) return;
  var btn = e.target.querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = 'Subscribing...'; }
  fetch('https://opcskuzbdfrlnyhraysk.supabase.co/rest/v1/newsletter_subscribers', {
    method: 'POST',
    headers: {
      'apikey': 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs',
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ email: email, source: window.location.pathname })
  }).then(function(r){
    e.target.innerHTML = '<div style="font-size:14px;color:var(--coral);font-weight:600;padding:8px 0">Thanks! You\\'re on the list \\u2709\\ufe0f</div>';
  }).catch(function(){
    e.target.innerHTML = '<div style="font-size:14px;color:var(--coral);font-weight:600;padding:8px 0">Thanks! You\\'re on the list.</div>';
  });
}
</script>

</body>
</html>`;
}

/* ── Handler ──────────────────────────────────── */
export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response('Server error', { status: 500 });
  }

  const reqUrl = new URL(req.url);
  const slug = (reqUrl.searchParams.get('slug') || '').replace(/^\/+|\/+$/g, '').toLowerCase();

  if (!slug) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const post = await fetchPost(supabaseUrl, serviceKey, slug);

    if (!post) {
      return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Post Not Found — Spotd</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/blog.css"><link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;700;800;900&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="background:var(--bg);display:flex;flex-direction:column;min-height:100vh"><nav class="blog-nav"><a href="/" class="nav-brand"><img src="/spotd_logo_v5.png" alt="Spotd" class="nav-logo-img" onerror="this.style.display='none'"></a><div class="blog-nav-links"><a href="/blog.html" class="blog-nav-link">Blog</a><a href="/" class="blog-nav-cta">Open App</a></div></nav><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px"><div><div style="font-size:48px;margin-bottom:16px">📝</div><h1 style="font-family:'Cabinet Grotesk',sans-serif;font-size:24px;color:var(--ink);margin-bottom:8px">Post not found</h1><p style="color:var(--muted);margin-bottom:20px">This article doesn't exist or hasn't been published yet.</p><a href="/blog.html" style="color:var(--coral);font-weight:600;text-decoration:none">Browse all articles →</a></div></div></body></html>`, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
      });
    }

    const html = buildPage(post);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600'
      }
    });
  } catch (err) {
    return new Response('Internal server error', { status: 500 });
  }
}
