/**
 * OWLGEBRA AI — INTERACTIONS & SCROLL ANIMATIONS
 */
(function () {
  'use strict';

  /* ── Nav: scroll shadow ───────────────────────────────────── */
  const nav = document.getElementById('nav');
  function onScroll() {
    if (window.scrollY > 20) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── Nav: mobile toggle ───────────────────────────────────── */
  const navToggle = document.getElementById('navToggle');
  const navLinks  = document.getElementById('navLinks');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      const open = navLinks.classList.toggle('open');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', String(open));
    });

    // Close on link click (mobile)
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) {
        navLinks.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ── Scroll reveal ────────────────────────────────────────── */
  const revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    // Fallback: show everything immediately
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ── Stagger reveal children within cards ────────────────── */
  function staggerChildren(selector, childSelector, delayStep) {
    document.querySelectorAll(selector).forEach(function (parent) {
      parent.querySelectorAll(childSelector).forEach(function (child, i) {
        child.style.transitionDelay = (i * delayStep) + 'ms';
      });
    });
  }
  staggerChildren('.what__cards',   '.what__card',       80);
  staggerChildren('.research__grid','.research__card',   80);
  staggerChildren('.blog__grid',    '.blog__card',       80);
  staggerChildren('.platform__features', '.platform__feature', 60);

  /* ── Blog tab filter ─────────────────────────────────────── */
  const tabs  = document.querySelectorAll('.blog__tab');
  const cards = document.querySelectorAll('.blog__card');

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');

      const filter = tab.getAttribute('data-filter');
      cards.forEach(function (card) {
        const match = filter === 'all' || card.getAttribute('data-category') === filter;
        card.style.display = match ? '' : 'none';
      });
    });
  });

  /* ── Smooth active nav link on scroll ────────────────────── */
  const sections = document.querySelectorAll('section[id], div[id]');
  const navLinkEls = document.querySelectorAll('.nav__links a[href^="#"]');

  function updateActiveNav() {
    let current = '';
    sections.forEach(function (section) {
      const sectionTop = section.offsetTop - 100;
      if (window.scrollY >= sectionTop) {
        current = section.getAttribute('id');
      }
    });
    navLinkEls.forEach(function (a) {
      a.classList.remove('active');
      if (a.getAttribute('href') === '#' + current) {
        a.classList.add('active');
      }
    });
  }
  window.addEventListener('scroll', updateActiveNav, { passive: true });

  /* ── Canvas responsive resize ─────────────────────────────── */
  const heroCanvas = document.getElementById('heroCanvas');
  if (heroCanvas) {
    // The canvas internal resolution is set by animation.js; CSS makes it responsive
    // Ensure crisp rendering hint is set
    heroCanvas.style.imageRendering = 'pixelated';
  }

  /* ── Initial call ─────────────────────────────────────────── */
  onScroll();
  updateActiveNav();

})();
