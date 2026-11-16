// Account identity is already rendered by the server. Only explicit user
// actions make requests; the shared Rust reader owns progress and study sync.
const page = document.querySelector('main[data-page]');
const button = document.getElementById('account-action');
if (page && button) {
  const card = document.querySelector('.account-card');
  const status = document.getElementById('account-status');
  const alert = document.getElementById('account-error');
  const native = page.dataset.page === 'native';
  const request = page.dataset.requestId;
  const originalLabel = button.textContent;
  const nonce = /^[a-f0-9]{64}$/;
  let pending = false;

  function message(element, text) {
    element.textContent = text;
    element.hidden = !text;
  }
  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw Error('Account action failed');
    return payload;
  }
  button.addEventListener('click', async () => {
    if (pending || button.disabled) return;
    pending = true;
    button.disabled = true;
    card.setAttribute('aria-busy', 'true');
    message(alert, '');
    const action = button.dataset.action;
    message(status, action === 'approve' ? 'Connecting your app…' : action === 'sign-out' ? 'Signing out…' : 'Opening Google sign-in…');
    let leaving = false;
    try {
      if (action === 'sign-out') {
        await post('/api/auth/sign-out', {});
        window.location.reload();
        leaving = true;
      } else if (action === 'approve') {
        if (!nonce.test(request)) throw Error('Invalid connection');
        const { ticket } = await post('/api/native-login', { operation: 'approve', id: request });
        if (typeof ticket !== 'string' || !nonce.test(ticket)) throw Error('Invalid approval');
        const callback = `crosscanon://login-complete?request=${request}&ticket=${ticket}`;
        document.getElementById('native-return-link').href = callback;
        document.getElementById('native-return').hidden = false;
        document.getElementById('account-prompt').hidden = true;
        document.getElementById('account-heading').textContent = 'You’re ready to read.';
        message(status, '');
        // Keep the return link available even when the browser cannot open the
        // app automatically, or the reader later switches back to this tab.
        try { window.location.assign(callback); } catch {}
      } else {
        if (page.dataset.configured !== 'true') throw Error('Sign-in unavailable');
        if (native && !nonce.test(request)) throw Error('Invalid connection');
        const callbackURL = native ? `/account/native?id=${encodeURIComponent(request)}` : '/account';
        const errorCallbackURL = native ? `${callbackURL}&signin=failed` : '/account?signin=failed';
        const payload = await post('/api/auth/sign-in/social', { provider: 'google', callbackURL, errorCallbackURL });
        if (typeof payload.url !== 'string') throw Error('Missing sign-in address');
        const target = new URL(payload.url, window.location.origin);
        if (!['https:', 'http:'].includes(target.protocol)) throw Error('Invalid sign-in address');
        window.location.assign(target.href);
        leaving = true;
      }
    } catch {
      message(status, '');
      message(alert, action === 'approve'
        ? 'This connection expired or could not be approved. Start again in the app.'
        : native ? 'Could not start Google sign-in. Please try again.'
        : 'Could not update sign-in. Reconnect and try again.');
    } finally {
      if (!leaving) {
        pending = false;
        button.disabled = page.dataset.configured !== 'true' && action !== 'sign-out';
        button.textContent = originalLabel;
        card.setAttribute('aria-busy', 'false');
      }
    }
  });
}
