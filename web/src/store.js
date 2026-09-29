import { reactive } from 'vue';

export const sessionState = reactive({
  checked: false,
  ok: false,
  version: '',
  path: '/panel',
  apiTokenSet: false,
});

let checking = null;

export async function check() {
  if (!checking) {
    checking = (async () => {
      try {
        const r = await fetch('/panel/api/session', { credentials: 'same-origin' });
        if (r.status === 200) {
          const data = await r.json();
          sessionState.ok = true;
          sessionState.version = data.version;
          sessionState.path = data.path || '/panel';
          sessionState.apiTokenSet = !!data.api_token_set;
        } else {
          sessionState.ok = false;
        }
      } catch {
        sessionState.ok = false;
      } finally {
        sessionState.checked = true;
        checking = null;
      }
    })();
  }
  return checking;
}

export function evict() {
  sessionState.ok = false;
  sessionState.checked = true;
}