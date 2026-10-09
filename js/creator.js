// ── Spotd Creator Program — client foundation ─────────────────────────────
// Spec: goals/grow-and-monetize-spotd/hidden_files/creator-program-spec-2026-10-05.md
//
// This file is Spotd-side ONLY. OAuth (TikTok Login Kit / Meta login) and the
// content-sync poller are OUT OF SCOPE — see the TODO seams marked
// [CREATOR-OAUTH-SEAM] below for exactly where they plug in.
//
// Contents:
//   creatorBadge(profile)            — badge HTML next to display names
//   renderCreatorFollowCard(el, opts) — existing-user "creators are here" card
//                                      (NOT auto-surfaced; see trigger notes)
//   maybeShowCreatorDisclosure()     — signup-modal disclosure line
//   getCreatorReferralLink(handle)   — spotd.biz/r/[handle] builder
//   copyCreatorReferralLink(handle)  — clipboard helper for the dashboard

(function () {
  'use strict';

  // ── HTML escaping ─────────────────────────────────────────────────────
  // Strings interpolated into innerHTML below MUST go through escHtml.
  // Escapes & FIRST: the old /</-only pass left a double-encoding hole —
  // a display_name containing literal "&lt;img src=x onerror=...&gt;"
  // decodes back into a live tag when the browser parses the entities.
  // Creators are admin-approved so practical risk is low, but the follow
  // card renders whatever display_name is on the profile, so do it right.
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Badge (§4) ────────────────────────────────────────────────────────
  // Sibling of officialBadge() in js/app.js — same seal-check shape family,
  // coral for verified creators, gold seal + FOUNDING pill for founders.
  window.creatorBadge = function creatorBadge(profile) {
    if (!profile || !profile.is_creator) return '';
    var tier = profile.creator_tier === 'founding' ? 'founding' : 'verified';
    var sealFill = tier === 'founding' ? '#E9A13B' : '#FF6B4A';
    var label = tier === 'founding'
      ? '<span class="creator-badge-founding-label">Founding</span>'
      : '';
    return ' <span class="creator-badge creator-badge--' + tier + '"' +
      ' title="' + (tier === 'founding' ? 'Spotd Founding Creator' : 'Spotd Creator') + '"' +
      ' aria-label="' + (tier === 'founding' ? 'Spotd founding creator' : 'Spotd verified creator') + '"' +
      ' role="img">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" focusable="false" aria-hidden="true">' +
        '<path fill="' + sealFill + '" fill-rule="evenodd" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>' +
      '</svg>' + label +
      '</span>';
  };

  // ── Signup disclosure (§5) ─────────────────────────────────────────────
  // Shows "You're following Spotd's creators..." inside the signup modal,
  // but ONLY when at least one active creator exists (never show it to an
  // empty roster). Called after the auth modal renders in signup mode.
  // Wires into renderAuth() in js/app.js.
  var _disclosureShown = false;
  window.maybeShowCreatorDisclosure = function maybeShowCreatorDisclosure() {
    if (_disclosureShown) return;
    var slot = document.getElementById('creatorDisclosure');
    if (!slot) return;
    fetch('/api/creators?limit=1')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.count > 0) {
          slot.style.display = 'block';
          _disclosureShown = true;
        }
      })
      .catch(function () { /* stay hidden on failure — never block signup */ });
  };
  window.resetCreatorDisclosure = function () { _disclosureShown = false; };

  // ── Existing-user follow card (§5) ─────────────────────────────────────
  // "Spotd creators are here — follow the ones you like."
  // Follow-all (one tap) + pick-and-choose list. Deliberately NOT surfaced
  // anywhere yet — no silent mass-follow of the existing ~150 users.
  //
  // TRIGGER PLAN (when ready to launch): call renderCreatorFollowCard() from
  // a home-screen card slot or a modal, e.g. once per user (flag in
  // localStorage 'spotd_creator_card_seen'), AFTER the founding cohort is
  // live. Do not call it during onboarding — new signups are auto-followed
  // by the DB trigger instead.
  window.renderCreatorFollowCard = function renderCreatorFollowCard(el, opts) {
    opts = opts || {};
    if (!el || typeof fetch !== 'function') return;
    var city = opts.citySlug || null;
    var endpoint = '/api/creators?limit=50' + (city ? '&ordered_for=' + encodeURIComponent(city) : '');
    el.innerHTML = '<div class="creator-card"><div class="creator-card-title">Spotd creators are here</div>' +
      '<p class="creator-card-sub">Follow the ones you like — your feed, your call.</p>' +
      '<div class="creator-card-list"><div class="creator-card-loading">Loading creators…</div></div></div>';

    function track() { if (typeof window.track === 'function') { try { window.track.apply(null, arguments); } catch (e) {} } }

    fetch(endpoint).then(function (r) { return r.json(); }).then(function (data) {
      var creators = (data && data.creators) || [];
      if (!creators.length) { el.innerHTML = ''; return; }
      var listHtml = creators.map(function (c) {
        var name = escHtml(c.display_name || c.username || 'Creator');
        var avatar = c.avatar_url
          ? '<img class="creator-card-avatar" src="' + escHtml(c.avatar_url) + '" alt="">'
          : '<div class="creator-card-avatar creator-card-avatar--fallback">' + name.charAt(0).toUpperCase() + '</div>';
        return '<label class="creator-card-row">' +
          '<input type="checkbox" class="creator-card-check" value="' + c.id + '" checked>' +
          avatar +
          '<span class="creator-card-name">' + name + window.creatorBadge({ is_creator: true, creator_tier: c.creator_tier }) + '</span>' +
          '</label>';
      }).join('');
      el.querySelector('.creator-card-list').innerHTML = listHtml;

      var actions = document.createElement('div');
      actions.className = 'creator-card-actions';
      actions.innerHTML =
        '<button class="creator-card-followall" type="button">Follow all</button>' +
        '<button class="creator-card-followselected" type="button">Follow selected</button>' +
        '<button class="creator-card-dismiss" type="button">Not now</button>';
      el.querySelector('.creator-card').appendChild(actions);

      function selectedIds() {
        return Array.prototype.map.call(
          el.querySelectorAll('.creator-card-check:checked'), function (cb) { return cb.value; });
      }
      function doFollow(ids) {
        if (!window.currentUser || !ids.length) return;
        // Client-side mirror of buildAutoFollowRows(): dedupe + source tag.
        // The unique(follower_id, following_id) constraint is the real guard.
        var seen = {};
        var rows = [];
        ids.forEach(function (id) {
          if (id && id !== window.currentUser.id && !seen[id]) { seen[id] = 1; rows.push(id); }
        });
        if (!rows.length) return;
        track('creator_card_follow', { count: rows.length, source: 'creator_card' });
        var db = window.db;
        if (!db) return;
        db.from('user_follows')
          .upsert(rows.map(function (id) {
            return { follower_id: window.currentUser.id, following_id: id, source: 'creator_card' };
          }), { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
          .then(function () {
            el.innerHTML = '<div class="creator-card"><div class="creator-card-title">You\'re in.</div>' +
              '<p class="creator-card-sub">Unfollow anyone, anytime from their profile.</p></div>';
          })
          .catch(function () {});
      }
      actions.querySelector('.creator-card-followall').addEventListener('click', function () {
        doFollow(creators.map(function (c) { return c.id; }));
      });
      actions.querySelector('.creator-card-followselected').addEventListener('click', function () {
        doFollow(selectedIds());
      });
      actions.querySelector('.creator-card-dismiss').addEventListener('click', function () {
        try { localStorage.setItem('spotd_creator_card_seen', '1'); } catch (e) {}
        el.innerHTML = '';
        track('creator_card_dismissed', {});
      });
      track('creator_card_shown', { count: creators.length });
    }).catch(function () { el.innerHTML = ''; });
  };

  // ── Referral link (§9) ─────────────────────────────────────────────────
  window.getCreatorReferralLink = function getCreatorReferralLink(handle) {
    var norm = String(handle || '').trim().replace(/^@/, '');
    if (!norm) return null;
    return 'https://www.spotd.biz/r/' + encodeURIComponent(norm);
  };
  window.copyCreatorReferralLink = function copyCreatorReferralLink(handle) {
    var link = window.getCreatorReferralLink(handle);
    if (!link) return Promise.resolve(false);
    function done(ok) {
      if (typeof window.showToast === 'function') {
        window.showToast(ok ? 'Referral link copied' : 'Copy this link: ' + link);
      }
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(link).then(function () { return done(true); }, function () { return done(false); });
    }
    var ta = document.createElement('textarea');
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return Promise.resolve(done(ok));
  };

  // ── OAuth connect seams (OUT OF SCOPE — §6) ────────────────────────────
  // [CREATOR-OAUTH-SEAM:connect-buttons]
  // The creator dashboard renders "Connect TikTok" / "Connect Instagram" as
  // disabled "coming soon" buttons. When the platform apps are approved:
  //   1. TikTok: redirect to the Login Kit authorize URL with
  //      scopes=user.info.basic+video.list, then handle the callback in
  //      api/creator-oauth-callback.js (NEW — exchange code, encrypt tokens,
  //      insert into creator_connections with status='active').
  //   2. Instagram: Meta login flow with the same callback; store long-lived
  //      token (60d) in creator_connections.token_expires_at.
  //   3. Flip the buttons to enabled here + in creator-dashboard.html, and
  //      show the consent copy from spec §6 at connect time.
  window.creatorOAuthStatus = function creatorOAuthStatus() {
    return { tiktok: 'coming_soon', instagram: 'coming_soon' };
  };

  // [CREATOR-OAUTH-SEAM:sync-status]
  // The dashboard's sync-status section reads creator_connections + the
  // latest feed_items per platform. Until the poller exists it renders the
  // empty state ("No connected accounts yet"). The poller (server-side cron,
  // OUT OF SCOPE) will: refresh tokens, poll /video/list (TikTok) and
  // /media (IG) per creator every 4-6h staggered, upsert into feed_items on
  // (platform, platform_media_id) conflict, and tombstone on disconnect.
  window.renderCreatorSyncStatus = function renderCreatorSyncStatus(el, connections) {
    if (!el) return;
    var conns = connections || [];
    if (!conns.length) {
      el.innerHTML = '<div class="creator-sync-empty">' +
        '<div class="creator-sync-empty-title">No connected accounts yet</div>' +
        '<p>Connect TikTok or Instagram and your latest posts will start ' +
        'appearing in the Spotd feed with credit and a link back to you.</p></div>';
      return;
    }
    el.innerHTML = '<ul class="creator-sync-list">' + conns.map(function (c) {
      var label = c.platform === 'tiktok' ? 'TikTok' : 'Instagram';
      var status = c.status === 'active' ? 'Syncing' : c.status;
      return '<li class="creator-sync-row"><span class="creator-sync-platform">' + label + '</span>' +
        '<span class="creator-sync-status creator-sync-status--' + c.status + '">' + status + '</span></li>';
    }).join('') + '</ul>';
  };
})();
