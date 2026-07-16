export function buildDisplayHtml({ apiUrl, mediaBaseUrl, interval, maxDaysAhead, enableDebug, timezone }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CoLiving Event Kiosk</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/display.css" />
</head>
<body>
  <div class="top-bar">
    <div id="clock">--:--</div>
    <div id="offline" class="offline">Offline: waiting for API</div>
  </div>

  <main class="kiosk-shell">
    <section class="carousel-container">
      <article id="mainSlide" class="slide active"></article>
    </section>
    <section class="preview-viewport">
      <div id="previewTrack" class="preview-track"></div>
    </section>
  </main>

  <aside id="debugPanel" class="debug-panel" aria-live="polite"></aside>

  <script>
    window.__DISPLAY_CONFIG__ = {
      apiUrl: ${JSON.stringify(apiUrl)},
      mediaBaseUrl: ${JSON.stringify(mediaBaseUrl)},
      intervalMs: ${Number.isFinite(interval) ? interval : 8000},
      maxDaysAhead: ${Number.isFinite(maxDaysAhead) ? maxDaysAhead : 30},
      enableDebug: ${enableDebug ? "true" : "false"},
      timezone: ${JSON.stringify(timezone || "Europe/London")}
    };
  </script>
  <script type="module" src="/display.js"></script>
</body>
</html>`;
}
