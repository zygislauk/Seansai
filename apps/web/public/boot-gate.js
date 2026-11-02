/**
 * Runs before the first paint and decides whether this visitor may see the page's snapshot, which
 * only ever holds the plain page for a first-time visitor on the day it was built. Anyone else gets
 * `data-boot="client"`: their page stays hidden until the app has rendered what they asked for
 * (research.md §10). A separate file because the CSP allows no inline scripts.
 */
(function () {
  function remembersCity() {
    try {
      return window.localStorage.getItem('seansai.city') !== null;
    } catch {
      // Storage is unavailable, so nothing can have been remembered.
      return false;
    }
  }

  var snapshotDate = document.querySelector('meta[name="snapshot-date"]');
  // The en-CA format is YYYY-MM-DD, as in the meta tag.
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' }).format(new Date());

  if (
    window.location.search !== '' ||
    remembersCity() ||
    !snapshotDate ||
    snapshotDate.content !== today
  ) {
    document.documentElement.dataset.boot = 'client';
  }
})();
