/**
 * Shared DOM feedback controller for cloud Push buttons.
 * Allowed dependencies: DOM timers only. Forbidden: storage, Supabase and business logic.
 * Covered by: Terminal/Wave/Tracker desktop and iPhone Playwright tests.
 */
const SAVED_CONFIRMATION_MS = 2000;

function renderState(button,state) {
  const states = {
    saving:{ icon:'cloud_upload', text:'Saving to Cloud…' },
    saved:{ icon:'check', text:'Saved to Cloud' }
  };
  const value = states[state];
  button.innerHTML = `<span class="material-icons" aria-hidden="true">${value.icon}</span> ${value.text}`;
  button.dataset.cloudState = state;
  button.classList.toggle('is-cloud-saving',state === 'saving');
  button.classList.toggle('is-cloud-saved',state === 'saved');
}

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve,milliseconds)); }

export async function runCloudPushFeedback(button,operation,{ onSuccessSettled, onUnexpectedError, confirmationMs=SAVED_CONFIRMATION_MS } = {}) {
  if (!button || button.dataset.cloudState === 'saving' || button.dataset.cloudState === 'saved') return { ok:false, skipped:true };
  const original = {
    html:button.innerHTML,
    disabled:button.disabled,
    ariaBusy:button.getAttribute('aria-busy'),
    ariaLive:button.getAttribute('aria-live')
  };
  const restore = () => {
    button.innerHTML = original.html;
    button.disabled = original.disabled;
    button.classList.remove('is-cloud-saving','is-cloud-saved');
    delete button.dataset.cloudState;
    if (original.ariaBusy === null) button.removeAttribute('aria-busy'); else button.setAttribute('aria-busy',original.ariaBusy);
    if (original.ariaLive === null) button.removeAttribute('aria-live'); else button.setAttribute('aria-live',original.ariaLive);
  };

  button.disabled = true;
  button.setAttribute('aria-busy','true');
  button.setAttribute('aria-live','polite');
  renderState(button,'saving');
  try {
    const outcome = await operation();
    if (outcome === false || outcome?.ok === false || outcome?.error) {
      restore();
      return { ok:false, error:outcome?.error || null };
    }
    button.setAttribute('aria-busy','false');
    renderState(button,'saved');
    await delay(Math.max(0,Number(confirmationMs) || 0));
    restore();
    onSuccessSettled?.();
    return { ok:true };
  } catch (error) {
    restore();
    onUnexpectedError?.(error);
    return { ok:false, error };
  }
}
