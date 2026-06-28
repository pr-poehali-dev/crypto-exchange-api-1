import func2url from '../../backend/func2url.json';

const URLS = func2url as Record<string, string>;

function getToken() {
  return localStorage.getItem('nexus_token') || '';
}

async function call(fn: string, method: string, action: string, body?: unknown) {
  const url = URLS[fn] + '?action=' + action;
  const res = await fetch(url, {
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
      call('auth', 'POST', 'register', body),
    login: (body: { email: string; password: string }) =>
      call('auth', 'POST', 'login', body),
    me: () => call('auth', 'GET', 'me'),
    logout: () => call('auth', 'POST', 'logout'),
  },
  wallets: {
    list: () => call('wallets', 'GET', 'list'),
  },
  deposits: {
    list: () => call('deposits', 'GET', 'list'),
    create: (network: string) => call('deposits', 'POST', 'create', { network }),
    all: () => call('deposits', 'GET', 'all'),
    confirm: (deposit_id: number, amount: number, tx_hash: string) =>
      call('deposits', 'PUT', 'confirm', { deposit_id, amount, tx_hash }),
  },
  transactions: {
    list: () => call('transactions', 'GET', 'list'),
  },
  admin: {
    stats: () => call('admin', 'GET', 'stats'),
    users: (q?: string, page?: number) => call('admin', 'GET', `users${q ? `&q=${encodeURIComponent(q)}` : ''}${page ? `&page=${page}` : ''}`),
    userDetail: (user_id: number) => call('admin', 'GET', `user-detail&user_id=${user_id}`),
    transactions: () => call('admin', 'GET', 'transactions'),
    setBalance: (user_id: number, currency: string, amount: number, operation: string) =>
      call('admin', 'PUT', 'balance', { user_id, currency, amount, operation }),
    toggleAdmin: (user_id: number) => call('admin', 'PUT', 'toggle-admin', { user_id }),
    freeze: (user_id: number, freeze: boolean, reason?: string) =>
      call('admin', 'PUT', 'freeze', { user_id, freeze, reason }),
    setRole: (user_id: number, role: string) => call('admin', 'PUT', 'set-role', { user_id, role }),
    withdrawals: (status?: string) => call('admin', 'GET', `withdrawals${status ? `&status=${status}` : ''}`),
    approveWithdrawal: (withdrawal_id: number, tx_hash: string) =>
      call('admin', 'PUT', 'approve-withdrawal', { withdrawal_id, tx_hash }),
    rejectWithdrawal: (withdrawal_id: number, note: string) =>
      call('admin', 'PUT', 'reject-withdrawal', { withdrawal_id, note }),
    auditLog: (page?: number) => call('admin', 'GET', `audit-log${page ? `&page=${page}` : ''}`),
    orders: () => call('admin', 'GET', 'orders'),
    pairs: () => call('admin', 'GET', 'pairs'),
    updatePair: (pair_id: number, data: Record<string, unknown>) =>
      call('admin', 'PUT', 'update-pair', { pair_id, ...data }),
    circuitBreakerStatus: () => call('admin', 'GET', 'circuit-breaker'),
    circuitBreaker: (action: 'halt' | 'resume', scope: string, reason: string) =>
      call('admin', 'PUT', 'circuit-breaker', { action, scope, reason }),
  },
  orders: {
    pairs: () => call('orders', 'GET', 'pairs'),
    orderbook: (symbol: string) => call('orders', 'GET', `orderbook&symbol=${encodeURIComponent(symbol)}`),
    candles: (symbol: string, interval: string, limit?: number) =>
      call('orders', 'GET', `candles&symbol=${encodeURIComponent(symbol)}&interval=${interval}${limit ? `&limit=${limit}` : ''}`),
    trades: (symbol: string) => call('orders', 'GET', `trades&symbol=${encodeURIComponent(symbol)}`),
    myOrders: (symbol?: string) => call('orders', 'GET', `my-orders${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`),
    create: (data: { symbol: string; side: string; type: string; qty: number; price?: number; stop_price?: number }) =>
      call('orders', 'POST', 'create', data),
    cancel: (order_id: number) => call('orders', 'DELETE', `cancel&order_id=${order_id}`),
  },
  kyc: {
    status: () => call('kyc', 'GET', 'status'),
    submit: (data: Record<string, string>) => call('kyc', 'POST', 'submit', data),
    adminList: (status?: string) => call('kyc', 'GET', `admin-list${status ? `&status=${status}` : ''}`),
    approve: (submission_id: number, note?: string) => call('kyc', 'PUT', 'approve', { submission_id, note }),
    reject: (submission_id: number, reason: string) => call('kyc', 'PUT', 'reject', { submission_id, reason }),
  },
  transfer: {
    send: (to_username: string, currency: string, amount: number) =>
      call('transfer', 'POST', 'send', { to_username, currency, amount }),
    check: (username: string) =>
      call('transfer', 'GET', `check&username=${encodeURIComponent(username)}`),
  },
  exchange: {
    rates: () => call('exchange', 'GET', 'rates'),
    quote: (from: string, to: string, amount: number) =>
      call('exchange', 'GET', `quote&from=${from}&to=${to}&amount=${amount}`),
    swap: (from: string, to: string, amount: number) =>
      call('exchange', 'POST', 'swap', { from, to, amount }),
  },
  fiat: {
    info: () => call('fiat', 'GET', 'info'),
    create: (amount_rub: number) => call('fiat', 'POST', 'create', { amount_rub }),
    list: () => call('fiat', 'GET', 'list'),
  },
  cryptoWallets: {
    list: () => call('crypto-wallets', 'GET', 'list'),
    generate: (network: string) => call('crypto-wallets', 'POST', 'generate', { network }),
    deposits: () => call('crypto-wallets', 'GET', 'deposits'),
  },
  withdrawal: {
    networks: () => call('withdrawal', 'GET', 'networks'),
    create: (network: string, address: string, amount: number, memo?: string) =>
      call('withdrawal', 'POST', 'create', { network, address, amount, memo }),
    list: () => call('withdrawal', 'GET', 'list'),
    adminComplete: (withdrawal_id: number, tx_hash: string) =>
      call('withdrawal', 'PUT', 'admin-complete', { withdrawal_id, tx_hash }),
    adminReject: (withdrawal_id: number, note: string) =>
      call('withdrawal', 'PUT', 'admin-reject', { withdrawal_id, note }),
  },
  rates: {
    usdtRub: async () => {
      const res = await fetch(URLS['rates'], { headers: { 'Content-Type': 'application/json' } });
      const text = await res.text();
      let data: unknown;
      try { const p = JSON.parse(text); data = typeof p === 'string' ? JSON.parse(p) : p; }
      catch { data = { error: text }; }
      return { ok: res.ok, status: res.status, data };
    },
  },
};