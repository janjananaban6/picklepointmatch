/* Load the Live Queue setup from its own HTML fragment before starting the app. */
(function () {
  // Initialize the Start Screen on desktop, tablet, and mobile devices.
  const mount = document.getElementById('liveQueueStartMount');
  if (!mount) {
    console.error('Live Queue setup mount was not found.');
    return;
  }

  fetch('live-queue-start-card.html', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`Could not load Live Queue setup (${response.status}).`);
      return response.text();
    })
    .then(markup => {
      mount.outerHTML = markup;
      const app = document.createElement('script');
      app.src = 'script.js?v=queue-responsive-all-devices-20261022-1';
      app.onerror = () => console.error('Pickle Point Match could not load script.js.');
      document.body.appendChild(app);
    })
    .catch(error => {
      console.error(error);
      mount.innerHTML = '<p role="alert" style="margin:24px auto;max-width:480px;padding:16px;color:#7f1d1d;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;font:14px/1.5 Arial,sans-serif">Could not load the Live Queue setup. Please run Pickle Point Match through its web server and refresh the page.</p>';
    });
})();
