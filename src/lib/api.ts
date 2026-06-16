import func2url from '../../backend/func2url.json';

const URLS = func2url as Record<string, string>;

function getToken() {
  return localStorage.getItem('nexus_token') || '';
}

async function call(fn: string, method: string, path: string, body?: unknown) {
  const res = await fetch(URLS[fn] + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': getToken(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    const parsed = JSON.parse(text);
    data = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    data = { error: text };
  }
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  auth: {
    register: (body: { email: string; username: string; password: string }) =>
      call('auth', 'POST', '/register', body),
    login: (body: { email: string; password: string }) =>
      call('auth', 'POST', '/login', body),
    me: () => call('auth', 'GET', '/me'),
    logout: () => call('auth', 'POST', '/logout'),
  },
  wallets: {
    list: () => call('wallets', 'GET', '/'),
  },
  deposits: {
    list: () => call('deposits', 'GET', '/'),
    create: (network: string) => call('deposits', 'POST', '/', { network }),
    all: () => call('deposits', 'GET', '/all'),
    confirm: (deposit_id: number, amount: number, tx_hash: string) =>
      call('deposits', 'PUT', '/confirm', { deposit_id, amount, tx_hash }),
  },
  transactions: {
    list: () => call('transactions', 'GET', '/'),
  },
  admin: {
    stats: () => call('admin', 'GET', '/stats'),
    users: () => call('admin', 'GET', '/users'),
    transactions: () => call('admin', 'GET', '/transactions'),
    setBalance: (user_id: number, currency: string, amount: number, operation: string) =>
      call('admin', 'PUT', '/balance', { user_id, currency, amount, operation }),
    toggleAdmin: (user_id: number) =>
      call('admin', 'PUT', '/toggle-admin', { user_id }),
  },
};
