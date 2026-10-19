/* Load the Queueing workspace only on supported desktop and iPad devices. */
(function () {
  if (window.ppMobileQueueingBlocked) return;
  const app = document.createElement('script');
  app.src = 'script.js?v=separate-queue-page-20261019-1';
  app.onerror = () => console.error('Pickle Point Match could not load script.js.');
  document.body.appendChild(app);
})();
