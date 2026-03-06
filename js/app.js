/* ═══════════════════════════════════════════════════════
   APP.JS — UI logic
   Filters · Cards · Map · Modals · Auth · Reviews · Share
   ═══════════════════════════════════════════════════════ */

const state = {
  view:'list', filtersOpen:false, favFilterOn:false,
  filters:{ day:null, area:null, type:null, search:'' },
  activeVenueId:null, map:null, markers:{}, filtered:[],
  reviewCache:{}, reviewCacheTime:{}
};

const DAYS     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TODAY    = DAYS[new Date().getDay()];
const AREAS    = [...new Set(VENUES.map(v=>v.neighborhood))].sort();
const CUISINES = ['Bar','Brewery','Seafood','Mexican','Italian','Asian','BBQ','Wine Bar','Steakhouse','Beach Bar'];
const CACHE_MS = 60000;

document.addEventListener('DOMContentLoaded', () => {
  buildFilterPills();
  applyFilters();
  initMap();
});

// called by db.js on every auth state change
function onAuthChange(user) {
  renderNav(user);
  renderCards();
  document.getElementById('favFilterGroup').style.display = user ? '' : 'none';
  if (!user && state.favFilterOn) { state.favFilterOn = false; applyFilters(); }
}

// ── NAV ────────────────────────────────────────────────
function renderNav(user) {
  const r = document.getElementById('navRight');
  r.innerHTML = user
    ? `<button class="nav-btn" onclick="openFavView()">★ Saved</button>
       <button class="nav-btn nav-profile" onclick="openProfile()">${(user.user_metadata?.full_name||user.email).split(' ')[0]} ↗</button>
       <button class="nav-btn nav-signout" onclick="doSignOut()">Sign out</button>`
    : `<button class="nav-btn nav-login" onclick="openAuth('signin')">Sign In / Join</button>`;
}
async function doSignOut() { await authSignOut(); showToast('Signed out'); }

// ── AUTH ───────────────────────────────────────────────
function openAuth(mode='signin') {
  renderAuth(mode);
  openOverlay('authOverlay');
}
function closeAuth(e) {
  if (e && e.target !== document.getElementById('authOverlay')) return;
  closeOverlay('authOverlay');
}
function renderAuth(mode) {
  const si = mode === 'signin';
  document.getElementById('authContent').innerHTML = `
    <div class="auth-title">${si ? 'Welcome back' : 'Create account'}</div>
    <p class="auth-sub">${si ? 'Sign in to save favorites & manage reviews' : 'Free forever — save spots, write reviews'}</p>
    ${!si?`<div class="field-group"><div class="field-label">Name</div><input class="field" id="aName" type="text" placeholder="Your name" autocomplete="name"></div>`:''}
    <div class="field-group"><div class="field-label">Email</div><input class="field" id="aEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
    <div class="field-group"><div class="field-label">Password</div><input class="field" id="aPass" type="password" placeholder="${si?'Your password':'Min 8 characters'}" autocomplete="${si?'current-password':'new-password'}"></div>
    ${si?`<button class="auth-forgot" onclick="doForgot()">Forgot password?</button>`:''}
    <button class="btn-submit" id="authBtn" onclick="doAuth('${mode}')" style="width:100%;margin-top:4px">${si?'Sign In':'Create Account'}</button>
    <p class="auth-switch">${si?"No account?":'Have an account?'} <button class="auth-switch-btn" onclick="renderAuth('${si?'signup':'signin'}')">${si?'Sign up free':'Sign in'}</button></p>`;
  setTimeout(()=>{
    ['aEmail','aPass','aName'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.addEventListener('keydown',e=>{if(e.key==='Enter')doAuth(mode);});
    });
  },50);
}
async function doAuth(mode) {
  const btn = document.getElementById('authBtn');
  btn.disabled=true; btn.textContent='Please wait…';
  const email    = (document.getElementById('aEmail')?.value||'').trim();
  const password =  document.getElementById('aPass')?.value||'';
  if (!email||!password) { showToast('Please fill in all fields'); btn.disabled=false; btn.textContent=mode==='signin'?'Sign In':'Create Account'; return; }
  try {
    const result = mode==='signup'
      ? await authSignUp(email, password, (document.getElementById('aName')?.value||'').trim())
      : await authSignIn(email, password);
    if (result.error) throw result.error;
    closeOverlay('authOverlay');
    showToast(mode==='signup' ? 'Account created!' : 'Welcome back!');
  } catch(err) {
    showToast('❌ ' + (err.message||'Something went wrong'));
    btn.disabled=false; btn.textContent=mode==='signin'?'Sign In':'Create Account';
  }
}
async function doForgot() {
  const email=(document.getElementById('aEmail')?.value||'').trim();
  if(!email){showToast('Enter your email first');return;}
  const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
  if(error){showToast('❌ '+error.message);return;}
  showToast('Reset link sent!'); closeOverlay('authOverlay');
}

// ── FILTERS ────────────────────────────────────────────
function buildFilterPills() {
  DAYS.forEach(d=>{const b=mkPill(d+(d===TODAY?' ★':''),()=>setFilter('day',d,b));document.getElementById('dayFilters').appendChild(b);});
  AREAS.forEach(a=>{const b=mkPill(a,()=>setFilter('area',a,b));document.getElementById('areaFilters').appendChild(b);});
  CUISINES.forEach(t=>{const b=mkPill(t,()=>setFilter('type',t,b));document.getElementById('typeFilters').appendChild(b);});
}
function mkPill(label,onclick){const b=document.createElement('button');b.className='pill';b.textContent=label;b.onclick=onclick;return b;}
function setFilter(key,val,btn){
  if(state.filters[key]===val){state.filters[key]=null;btn.classList.remove('active');}
  else{btn.parentElement.querySelectorAll('.pill.active').forEach(b=>b.classList.remove('active'));state.filters[key]=val;btn.classList.add('active');}
  applyFilters();updateChips();updateDot();
}
function updateChips(){
  const row=document.getElementById('chipsRow');row.innerHTML='';
  const {day,area,type,search}=state.filters;
  if(day)    addChip(row,`Day: ${day}`,   ()=>clearFilter('day'));
  if(area)   addChip(row,`Area: ${area}`, ()=>clearFilter('area'));
  if(type)   addChip(row,`Type: ${type}`, ()=>clearFilter('type'));
  if(search) addChip(row,`"${search}"`,   ()=>{state.filters.search='';document.getElementById('searchBox').value='';applyFilters();updateChips();updateDot();});
  if(state.favFilterOn) addChip(row,'★ Saved',()=>{state.favFilterOn=false;document.getElementById('favFilterBtn').classList.remove('active');applyFilters();updateChips();});
}
function addChip(row,label,fn){const c=document.createElement('div');c.className='chip';c.innerHTML=`${label} <span class="chip-x">✕</span>`;c.onclick=fn;row.appendChild(c);}
function clearFilter(key){
  state.filters[key]=null;
  const m={day:'dayFilters',area:'areaFilters',type:'typeFilters'};
  document.querySelectorAll(`#${m[key]} .pill.active`).forEach(b=>b.classList.remove('active'));
  applyFilters();updateChips();updateDot();
}
function updateDot(){
  const has=state.filters.day||state.filters.area||state.filters.type||state.favFilterOn;
  document.getElementById('filterDot').classList.toggle('show',!!has);
  document.getElementById('filterToggle').classList.toggle('active',!!has);
}
function applyFilters(){
  const search=(document.getElementById('searchBox').value||'').toLowerCase().trim();
  state.filters.search=search;
  state.filtered=VENUES.filter(v=>{
    const{day,area,type}=state.filters;
    if(day&&!v.days.includes(day))return false;
    if(area&&v.neighborhood!==area)return false;
    if(type){const t=type.toLowerCase();if(!v.cuisine.toLowerCase().includes(t)&&!v.deals.some(d=>d.toLowerCase().includes(t)))return false;}
    if(search){const h=[v.name,v.neighborhood,v.cuisine,v.address,...v.deals].join(' ').toLowerCase();if(!h.includes(search))return false;}
    if(state.favFilterOn&&!isFavorite(v.id))return false;
    return true;
  });
  renderCards();
  if(state.view==='map')updateMapMarkers();
  document.getElementById('resultsCount').textContent=`${state.filtered.length} of ${VENUES.length} venues`;
}
function toggleFilters(){state.filtersOpen=!state.filtersOpen;document.getElementById('filterPanel').classList.toggle('open',state.filtersOpen);document.getElementById('filterToggle').classList.toggle('active',state.filtersOpen);}

// ── CARDS ──────────────────────────────────────────────
function renderCards(){
  const grid=document.getElementById('cardsGrid');
  if(!state.filtered.length){grid.innerHTML=`<div class="no-results">No venues match — try different filters</div>`;return;}
  grid.innerHTML=state.filtered.map(cardHTML).join('');
}
function cardHTML(v){
  const isToday=v.days.includes(TODAY);
  const cached=state.reviewCache[v.id]||[];
  const avg=avgFromList(cached);const rc=cached.length;
  const faved=isFavorite(v.id);
  return `<div class="card" onclick="openModal(${v.id})" role="button" tabindex="0">
    <div class="card-head">
      <div class="card-name">${v.name}</div>
      <div class="card-right">
        <button class="heart-btn${faved?' faved':''}" onclick="event.stopPropagation();doFavorite(${v.id},this)" aria-label="Save">${faved?'★':'☆'}</button>
        <div class="card-badge${isToday?'':' wn'}">${isToday?'Today':'Weekday'}</div>
      </div>
    </div>
    <div class="card-meta"><span>${v.neighborhood}</span><span class="card-meta-sep">·</span><span class="card-when">${v.hours}</span></div>
    <ul class="deals">${v.deals.slice(0,3).map(d=>`<li>${d}</li>`).join('')}${v.deals.length>3?`<li class="deals-more">+${v.deals.length-3} more</li>`:''}</ul>
    <div class="card-foot">
      <span class="card-cuisine">${v.cuisine}</span>
      <div class="card-stars">${starHTML(avg,5,12)}<span class="card-rcount">${rc?`(${rc})`:'—'}</span></div>
    </div>
  </div>`;
}
async function doFavorite(venueId,btn){
  if(!currentUser){openAuth('signin');showToast('Sign in to save favorites');return;}
  const added=await toggleFavorite(venueId);
  btn.textContent=added?'★':'☆'; btn.classList.toggle('faved',added);
  showToast(added?'Saved ★':'Removed from saved');
}
function openFavView(){if(!currentUser){openAuth('signin');return;}state.favFilterOn=true;document.getElementById('favFilterBtn').classList.add('active');applyFilters();updateChips();}
function toggleFavFilter(){if(!currentUser){openAuth('signin');return;}state.favFilterOn=!state.favFilterOn;document.getElementById('favFilterBtn').classList.toggle('active',state.favFilterOn);applyFilters();updateChips();}

// ── VENUE MODAL ────────────────────────────────────────
async function openModal(id){
  const v=VENUES.find(x=>x.id===id);if(!v)return;
  state.activeVenueId=id;
  renderModal(v,state.reviewCache[id]||[]);
  openOverlay('modalOverlay');
  const reviews=await getCachedReviews(id);
  const le=document.getElementById(`rlist-${id}`);
  const ae=document.getElementById(`ravg-${id}`);
  if(le)le.innerHTML=renderReviewList(reviews,id);
  if(ae)ae.innerHTML=avgHTML(reviews);
}
async function getCachedReviews(id){
  const now=Date.now();
  if(state.reviewCache[id]&&(now-state.reviewCacheTime[id])<CACHE_MS)return state.reviewCache[id];
  const r=await fetchReviews(id);state.reviewCache[id]=r;state.reviewCacheTime[id]=now;return r;
}
async function refreshReviews(id){
  delete state.reviewCache[id];
  const r=await getCachedReviews(id);
  const le=document.getElementById(`rlist-${id}`);const ae=document.getElementById(`ravg-${id}`);
  if(le)le.innerHTML=renderReviewList(r,id);if(ae)ae.innerHTML=avgHTML(r);
  renderCards();
}
function avgHTML(reviews){
  if(!reviews.length)return'';
  const avg=avgFromList(reviews);
  return `${starHTML(avg,5,11)} <span class="review-summary-sub">${avg.toFixed(1)} · ${reviews.length} review${reviews.length!==1?'s':''}</span>`;
}
function renderModal(v,reviews){
  const faved=isFavorite(v.id);
  document.getElementById('modalContent').innerHTML=`
    <div style="display:flex;align-items:flex-start;gap:10px;padding-right:38px">
      <div style="flex:1"><div class="s-name">${v.name}</div><div class="s-hood">${v.neighborhood}</div><div class="s-addr">📍 ${v.address}</div></div>
      <button class="heart-btn heart-btn--lg${faved?' faved':''}" onclick="doFavorite(${v.id},this)" style="margin-top:2px">${faved?'★':'☆'}</button>
    </div>
    <div class="s-div"></div>
    <div class="s-label">Hours</div>
    <div class="s-when">${v.hours}</div>
    <div class="s-label" style="margin-top:8px">Days open</div>
    <div class="s-days">${DAYS.map(d=>`<span class="day-pill${v.days.includes(d)?(d===TODAY?' today':' on'):''}">${d}</span>`).join('')}</div>
    <div class="s-div"></div>
    <div class="s-label">Deals &amp; Specials</div>
    <ul class="s-deals">${v.deals.map(d=>`<li>${d}</li>`).join('')}</ul>
    <div class="s-cuisine">${v.cuisine}</div>
    <div class="s-div"></div>
    <div class="s-actions">
      ${v.url&&v.url!=='#'?`<a class="btn-primary" href="${v.url}" target="_blank" rel="noopener">Website ↗</a>`:`<button class="btn-primary" disabled style="opacity:.3;cursor:default">No Website</button>`}
      <button class="btn-sec" onclick="goToMap(${v.id})">Map</button>
      <button class="btn-sec" onclick="shareVenue(${v.id})">Share</button>
    </div>
    <div class="s-div"></div>
    <div class="s-label">Reviews <span id="ravg-${v.id}">${avgHTML(reviews)}</span></div>
    <div class="review-form">
      <div class="star-picker" id="sp-${v.id}" data-val="0">${[1,2,3,4,5].map(n=>`<button class="sp" onclick="pickStar(${v.id},${n})" aria-label="${n} stars">★</button>`).join('')}</div>
      ${!currentUser?`<p class="review-guest-note">Posting as guest — <button class="auth-switch-btn" onclick="openAuth('signin')">sign in</button> to manage your reviews</p>`:''}
      <input class="field" id="rname-${v.id}" type="text" value="${currentUser?esc(currentUser.user_metadata?.full_name||''):''}" placeholder="Your name" ${currentUser?'style="display:none"':''} autocomplete="name">
      <textarea class="field" id="rtext-${v.id}" placeholder="How was it? Leave a review…" rows="3"></textarea>
      <button class="btn-submit" onclick="submitReview(${v.id})">Post Review</button>
    </div>
    <div class="reviews-list" id="rlist-${v.id}">${reviews.length?renderReviewList(reviews,v.id):'<div class="no-reviews">Loading…</div>'}</div>`;
}
function renderReviewList(reviews,venueId){
  if(!reviews.length)return`<div class="no-reviews">No reviews yet — be the first</div>`;
  return reviews.map(r=>{
    const isOwn=currentUser&&r.user_id===currentUser.id;
    const name=r.profiles?.display_name||r.name||'Anonymous';
    return `<div class="review-item">
      <div class="review-head">
        <span class="review-author">${esc(name)}${isOwn?' <span class="review-you">(you)</span>':''}</span>
        <span class="review-stars">${starHTML(r.rating,5,11)}</span>
        <span class="review-date">${fmtDate(r.created_at)}</span>
      </div>
      ${r.text?`<div class="review-text">${esc(r.text)}</div>`:''}
      ${isOwn?`<div class="review-acts">
        <button class="review-act" onclick="openEditReview('${r.id}',${venueId},${r.rating},\`${esc(r.text||'')}\`)">Edit</button>
        <button class="review-act del" onclick="doDeleteReview('${r.id}',${venueId})">Delete</button>
      </div>`:''}
    </div>`;
  }).join('');
}
function pickStar(venueId,n){const p=document.getElementById(`sp-${venueId}`);p.dataset.val=n;p.querySelectorAll('.sp').forEach((b,i)=>b.classList.toggle('lit',i<n));}
async function submitReview(venueId){
  const rating=parseInt(document.getElementById(`sp-${venueId}`).dataset.val||'0');
  if(!rating){showToast('Pick a star rating first');return;}
  const text=document.getElementById(`rtext-${venueId}`).value.trim();
  const guestName=document.getElementById(`rname-${venueId}`)?.value.trim()||'Anonymous';
  const{error}=await postReview({venueId,rating,text,guestName});
  if(error){showToast('❌ '+error.message);return;}
  const p=document.getElementById(`sp-${venueId}`);p.dataset.val='0';p.querySelectorAll('.sp').forEach(b=>b.classList.remove('lit'));
  const te=document.getElementById(`rtext-${venueId}`);if(te)te.value='';
  const ne=document.getElementById(`rname-${venueId}`);if(ne)ne.value='';
  await refreshReviews(venueId);
  showToast('Review posted!');
}
function closeModal(e){if(e&&e.target!==document.getElementById('modalOverlay'))return;closeOverlay('modalOverlay');}

// ── EDIT REVIEW ────────────────────────────────────────
function openEditReview(reviewId,venueId,rating,text){
  document.getElementById('editContent').innerHTML=`
    <div class="s-name" style="font-size:20px">Edit Review</div>
    <div class="review-form" style="margin-top:14px">
      <div class="star-picker" id="epick" data-val="${rating}">${[1,2,3,4,5].map((n,i)=>`<button class="sp${i<rating?' lit':''}" onclick="pickEditStar(${n})">★</button>`).join('')}</div>
      <textarea class="field" id="etext" rows="4">${esc(text)}</textarea>
      <div style="display:flex;gap:8px">
        <button class="btn-submit" style="flex:1" onclick="saveEditReview('${reviewId}',${venueId})">Save</button>
        <button class="btn-sec" onclick="closeOverlay('editOverlay')" style="flex:0 0 auto">Cancel</button>
      </div>
    </div>`;
  openOverlay('editOverlay');
}
function pickEditStar(n){const p=document.getElementById('epick');p.dataset.val=n;p.querySelectorAll('.sp').forEach((b,i)=>b.classList.toggle('lit',i<n));}
async function saveEditReview(reviewId,venueId){
  const rating=parseInt(document.getElementById('epick').dataset.val||'0');
  const text=document.getElementById('etext').value.trim();
  if(!rating){showToast('Pick a rating');return;}
  const{error}=await updateReview(reviewId,{rating,text});
  if(error){showToast('❌ '+error.message);return;}
  delete state.reviewCache[venueId];
  closeOverlay('editOverlay');
  showToast('Review updated');
  if(state.activeVenueId===venueId)refreshReviews(venueId);
  if(document.getElementById('profileOverlay').classList.contains('open'))renderProfile(currentUser);
}
async function doDeleteReview(reviewId,venueId){
  if(!confirm('Delete this review?'))return;
  const error=await deleteReview(reviewId);
  if(error){showToast('❌ '+error.message);return;}
  delete state.reviewCache[venueId];
  showToast('Review deleted');
  if(state.activeVenueId===venueId)refreshReviews(venueId);
  if(document.getElementById('profileOverlay').classList.contains('open'))renderProfile(currentUser);
  renderCards();
}
function closeEditReview(e){if(e&&e.target!==document.getElementById('editOverlay'))return;closeOverlay('editOverlay');}

// ── PROFILE ────────────────────────────────────────────
async function openProfile(){
  if(!currentUser){openAuth('signin');return;}
  await renderProfile(currentUser);
  openOverlay('profileOverlay');
}
function closeProfile(e){if(e&&e.target!==document.getElementById('profileOverlay'))return;closeOverlay('profileOverlay');}
async function renderProfile(user){
  const[profile,myReviews,favIds,followed]=await Promise.all([getProfile(user.id),fetchMyReviews(user.id),getFavoriteVenues(user.id),getFollowedNeighborhoods(user.id)]);
  const favVenues=VENUES.filter(v=>favIds.includes(v.id));
  document.getElementById('profileContent').innerHTML=`
    <div class="s-name" style="font-size:20px">My Account</div>
    <div class="profile-email">${user.email}</div>
    <div class="p-section">
      <div class="p-section-title">Display Name</div>
      <div style="display:flex;gap:8px">
        <input class="field" id="pName" type="text" value="${esc(profile?.display_name||user.user_metadata?.full_name||'')}" placeholder="Your name" style="flex:1">
        <button class="btn-save-sm" onclick="saveName()">Save</button>
      </div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Weekly Digest Email</div>
      <label class="toggle-row">
        <input type="checkbox" id="digestCb" ${profile?.digest_enabled?'checked':''} onchange="saveDigest(this.checked)">
        <span class="t-track"><span class="t-thumb"></span></span>
        <span class="t-text">Email me new happy hour deals weekly</span>
      </label>
    </div>
    <div class="p-section">
      <div class="p-section-title">Followed Neighborhoods</div>
      <div class="hood-grid">${AREAS.map(a=>`<button class="hood-pill${followed.includes(a)?' on':''}" onclick="toggleHood('${a}',this)">${a}</button>`).join('')}</div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Saved Venues (${favVenues.length})</div>
      ${favVenues.length?`<div class="fav-list">${favVenues.map(v=>`<div class="fav-item" onclick="closeOverlay('profileOverlay');openModal(${v.id})"><div class="fav-name">${v.name}</div><div class="fav-meta">${v.neighborhood} · ${v.hours}</div></div>`).join('')}</div>`:'<div class="no-reviews">Nothing saved yet</div>'}
    </div>
    <div class="p-section">
      <div class="p-section-title">My Reviews (${myReviews.length})</div>
      ${myReviews.length?`<div class="reviews-list">${myReviews.map(r=>{const v=VENUES.find(x=>x.id===r.venue_id);return`<div class="review-item"><span class="review-venue-link" onclick="closeOverlay('profileOverlay');openModal(${r.venue_id})">${v?v.name:'Unknown Venue'}</span><div class="review-head"><span class="review-stars">${starHTML(r.rating,5,11)}</span><span class="review-date">${fmtDate(r.created_at)}</span></div>${r.text?`<div class="review-text">${esc(r.text)}</div>`:''}<div class="review-acts"><button class="review-act" onclick="openEditReview('${r.id}',${r.venue_id},${r.rating},\`${esc(r.text||'')}\`)">Edit</button><button class="review-act del" onclick="doDeleteReview('${r.id}',${r.venue_id})">Delete</button></div></div>`;}).join('')}</div>`:'<div class="no-reviews">No reviews yet</div>'}
    </div>`;
}
async function saveName(){const n=document.getElementById('pName').value.trim();if(!n)return;await updateProfile(currentUser.id,{display_name:n});showToast('Name saved');}
async function saveDigest(v){await setDigestPreference(currentUser.id,v);showToast(v?'Digest enabled':'Digest off');}
async function toggleHood(hood,btn){if(!currentUser)return;const added=await toggleNeighborhoodFollow(currentUser.id,hood);btn.classList.toggle('on',added);showToast(added?`Following ${hood}`:`Unfollowed ${hood}`);}

// ── SHARE ──────────────────────────────────────────────
function shareVenue(id){
  const v=VENUES.find(x=>x.id===id);if(!v)return;
  const msg=`Happy Hour at ${v.name}\n📍 ${v.neighborhood} — ${v.address}\n🕐 ${v.hours}\n${v.deals.slice(0,2).join(' · ')}\n\nSD Happy Hour Guide`;
  if(navigator.share){navigator.share({title:`Happy Hour at ${v.name}`,text:msg}).catch(()=>{});}
  else{window.open(`sms:?body=${encodeURIComponent(msg)}`,'_blank');}
}

// ── VIEW TOGGLE ────────────────────────────────────────
function toggleView(){
  const isMap=state.view==='map';state.view=isMap?'list':'map';
  document.getElementById('listView').classList.toggle('active',state.view==='list');
  document.getElementById('mapView').classList.toggle('active',state.view==='map');
  document.getElementById('viewIcon').textContent=state.view==='map'?'List':'Map';
  document.getElementById('viewToggle').classList.toggle('map-active',state.view==='map');
  if(state.view==='map')setTimeout(()=>{state.map.invalidateSize();updateMapMarkers();buildMapSidebar();},100);
}
function goToMap(id){closeOverlay('modalOverlay');if(state.view!=='map')toggleView();setTimeout(()=>flyTo(id),350);}

// ── MAP ────────────────────────────────────────────────
function initMap(){
  const map=L.map('map',{center:[32.82,-117.18],zoom:11});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',subdomains:'abcd',maxZoom:19}).addTo(map);
  state.map=map;
}
function updateMapMarkers(){
  Object.values(state.markers).forEach(m=>m.remove());state.markers={};
  state.filtered.forEach(v=>{
    const color=v.days.includes(TODAY)?'#D4872A':'#5A6070';
    const icon=L.divIcon({className:'',html:`<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid rgba(255,255,255,0.7);box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:11px">🍺</span></div>`,iconSize:[26,26],iconAnchor:[13,26],popupAnchor:[0,-28]});
    const marker=L.marker([v.lat,v.lng],{icon}).addTo(state.map).bindPopup(popupHTML(v),{maxWidth:250});
    marker.on('click',()=>hlMapCard(v.id));
    state.markers[v.id]=marker;
  });
}
function popupHTML(v){return`<div class="popup-body"><div class="popup-name">${v.name}</div><div class="popup-hood">${v.neighborhood}</div><div class="popup-when">${v.hours}</div>${v.deals.slice(0,2).map(d=>`<div class="popup-deal">${d}</div>`).join('')}<div class="popup-actions"><button class="popup-btn" onclick="openModal(${v.id})">Details</button><button class="popup-share" onclick="shareVenue(${v.id})">Share</button></div></div>`;}
function flyTo(id){const v=VENUES.find(x=>x.id===id);if(!v||!state.map)return;state.map.flyTo([v.lat,v.lng],15,{animate:true,duration:0.8});if(state.markers[id])setTimeout(()=>state.markers[id].openPopup(),900);hlMapCard(id);}
function hlMapCard(id){document.querySelectorAll('.map-card').forEach(c=>c.classList.toggle('highlighted',c.dataset.id==id));const c=document.querySelector(`.map-card[data-id="${id}"]`);if(c)c.scrollIntoView({behavior:'smooth',block:'nearest'});}
function buildMapSidebar(){document.getElementById('mapCards').innerHTML=state.filtered.map(v=>`<div class="map-card" data-id="${v.id}" onclick="flyTo(${v.id})"><div class="map-card-name">${v.name}</div><div class="map-card-hood">${v.neighborhood}</div><div class="map-card-when">${v.hours}</div></div>`).join('');}

// ── OVERLAY HELPERS ────────────────────────────────────
function openOverlay(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';}
function closeOverlay(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}

// ── UTILS ──────────────────────────────────────────────
function avgFromList(r){return r.length?r.reduce((s,x)=>s+x.rating,0)/r.length:0;}
function starHTML(rating,max=5,size=13){return Array.from({length:max},(_,i)=>`<span style="font-size:${size}px;color:${i<Math.round(rating)?'var(--amber)':'rgba(240,230,211,0.15)'}">★</span>`).join('');}
function fmtDate(iso){return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function showToast(msg){document.querySelectorAll('.toast').forEach(t=>t.remove());const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600);}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
