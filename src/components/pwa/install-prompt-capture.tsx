/**
 * Catches the browser's install hook before React exists.
 *
 * `beforeinstallprompt` fires early — routinely before hydration — and it
 * fires ONCE. Anything that starts listening inside a React effect misses it
 * on most loads, and the person then never sees an install offer however long
 * they stay. So this runs as a blocking inline script in the document and
 * parks the event on a global that `useInstallPrompt` reads.
 *
 * It also calls `preventDefault()`, which suppresses Chrome's own mini-infobar
 * so our card is the only thing that appears — without that you get two
 * competing prompts.
 *
 * A server component rendering a plain <script>: no client bundle, no
 * hydration, runs before anything else on the page.
 */
export function InstallPromptCapture() {
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html:
          "window.addEventListener('beforeinstallprompt',function(e){" +
          'e.preventDefault();' +
          'window.__metworkInstallEvent=e;' +
          "});" +
          "window.addEventListener('appinstalled',function(){" +
          'window.__metworkInstallEvent=null;' +
          '});',
      }}
    />
  );
}
