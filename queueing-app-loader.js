/* Load the Queueing workspace on desktop, tablet, and mobile devices. */
(function () {
  const app = document.createElement('script');
  app.src = 'script.js?v=queue-tablet-modal-guard-20261023-1';
  app.onerror = () => console.error('Pickle Point Match could not load script.js.');
  document.body.appendChild(app);
})();
