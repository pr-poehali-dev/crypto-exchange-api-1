import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import Icon from '@/components/ui/icon';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stats {
  total_users: number;
  new_users_24h: number;
  pending_deposits: number;
  pending_withdrawals: number;
  total_usdt: number;
  pending_kyc: number;
  open_orders: number;
  volume_24h: number;
}

interface AdminUser {
  id: number;
  email: string;
  username: string;
  role: string;
  kyc_status: string;
  kyc_level: number;
  is_frozen: boolean;
  created_at: string;
  usdt_balance: number;
}

interface UserDetail {
  user: {
    id: number;
    email: string;
    username: string;
    role: string;
    kyc_status: string;
    kyc_level: number;
    is_frozen: boolean;
    freeze_reason: string | null;
    full_name: string | null;
    created_at: string;
    sessions: { id: number; ip: string; user_agent: string; created_at: string }[];
  };
  balances: { currency: string; available: number; locked: number }[];
  transactions: { id: number; type: string; currency: string; amount: number; status: string; created_at: string }[];
}

interface KycSubmission {
  id: number;
  user_id: number;
  email: string;
  username: string;
  level: number;
  status: string;
  full_name: string;
  birth_date: string;
  passport_number: string;
  doc_passport_url: string;
  doc_selfie_url: string;
  created_at: string;
}

interface Withdrawal {
  id: number;
  username: string;
  email: string;
  kyc_level: number;
  network: string;
  currency: string;
  amount: number;
  fee: number;
  to_address: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
}

interface Order {
  id: number;
  username: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  price: number;
  qty: number;
  filled_qty: number;
  created_at: string;
}

interface Pair {
  id: number;
  symbol: string;
  is_active: boolean;
  maker_fee: number;
  taker_fee: number;
  last_price: number;
  volume_24h: number;
}

interface AuditEntry {
  id: number;
  admin: string;
  action: string;
  entity_type: string;
  entity_id: number;
  old: unknown;
  new: unknown;
  ip: string;
  created_at: string;
}

type Tab = 'stats' | 'users' | 'kyc' | 'withdrawals' | 'orders' | 'pairs' | 'audit';
type UserDetailTab = 'profile' | 'balances' | 'transactions' | 'sessions';

const ROLES = ['user', 'support', 'compliance', 'finance', 'devops', 'admin', 'superadmin'];

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function kycBadge(status: string) {
  const map: Record<string, string> = {
    none: 'text-muted-foreground',
    pending: 'text-yellow-400',
    approved: 'text-buy',
    rejected: 'text-sell',
  };
  return <span className={`text-xs font-medium ${map[status] ?? 'text-muted-foreground'}`}>{status}</span>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'text-yellow-400',
    completed: 'text-buy',
    approved: 'text-buy',
    rejected: 'text-sell',
    cancelled: 'text-sell',
    open: 'text-primary',
    filled: 'text-buy',
    partially_filled: 'text-yellow-400',
  };
  return <span className={`text-xs font-medium ${map[status] ?? 'text-muted-foreground'}`}>{status}</span>;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon name={icon} size={18} className={color} />
      </div>
      <p className="text-2xl font-bold font-mono-num">{value}</p>
    </div>
  );
}

// ─── User Detail Modal ───────────────────────────────────────────────────────

function UserDetailModal({
  userId,
  onClose,
  onMsg,
}: {
  userId: number;
  onClose: () => void;
  onMsg: (m: string) => void;
}) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [dtab, setDtab] = useState<UserDetailTab>('profile');
  const [roleVal, setRoleVal] = useState('');
  const [freezeReason, setFreezeReason] = useState('');
  const [balCurrency, setBalCurrency] = useState('USDT');
  const [balAmount, setBalAmount] = useState('');
  const [balOp, setBalOp] = useState('add');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { ok, data: d } = await api.admin.userDetail(userId);
      if (ok) {
        const det = d as UserDetail;
        setData(det);
        setRoleVal(det.user.role);
      }
    })();
  }, [userId]);

  const handleFreeze = async () => {
    if (!data) return;
    setLoading(true);
    const frozen = data.user.is_frozen;
    const { ok } = await api.admin.freeze(userId, !frozen, frozen ? undefined : freezeReason);
    if (ok) {
      onMsg(frozen ? 'Пользователь разморожен' : 'Пользователь заморожен');
      setData(prev => prev ? { ...prev, user: { ...prev.user, is_frozen: !frozen } } : prev);
    }
    setLoading(false);
  };

  const handleRole = async () => {
    if (!data) return;
    setLoading(true);
    const { ok } = await api.admin.setRole(userId, roleVal);
    if (ok) {
      onMsg('Роль обновлена');
      setData(prev => prev ? { ...prev, user: { ...prev.user, role: roleVal } } : prev);
    }
    setLoading(false);
  };

  const handleBalance = async () => {
    if (!data || !balAmount) return;
    setLoading(true);
    const { ok } = await api.admin.setBalance(userId, balCurrency, parseFloat(balAmount), balOp);
    if (ok) {
      onMsg('Баланс обновлён');
      setBalAmount('');
    }
    setLoading(false);
  };

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center" onClick={onClose}>
        <div className="bg-card border border-border rounded-xl p-8">
          <Icon name="Loader2" size={24} className="animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const u = data.user;

  const DTABS: { id: UserDetailTab; label: string }[] = [
    { id: 'profile', label: 'Профиль' },
    { id: 'balances', label: 'Балансы' },
    { id: 'transactions', label: 'Транзакции' },
    { id: 'sessions', label: 'Сессии' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold">{u.username}</p>
            <p className="text-xs text-muted-foreground">{u.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {u.is_frozen && (
              <span className="text-xs bg-sell/15 text-sell px-2 py-0.5 rounded font-medium">ЗАМОРОЖЕН</span>
            )}
            <span className="text-xs bg-secondary text-foreground px-2 py-0.5 rounded font-medium">{u.role}</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2">
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>

        {/* sub-tabs */}
        <div className="flex gap-1 px-5 pt-3 shrink-0">
          {DTABS.map(t => (
            <button
              key={t.id}
              onClick={() => setDtab(t.id)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${dtab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">

          {dtab === 'profile' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['ID', u.id],
                  ['ФИО', u.full_name ?? '—'],
                  ['KYC статус', u.kyc_status],
                  ['KYC уровень', u.kyc_level],
                  ['Регистрация', fmtDate(u.created_at)],
                  ['Причина заморозки', u.freeze_reason ?? '—'],
                ].map(([k, v]) => (
                  <div key={String(k)} className="bg-secondary/40 rounded-lg px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{k}</p>
                    <p className="font-medium">{String(v)}</p>
                  </div>
                ))}
              </div>

              {/* Freeze */}
              <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Заморозка</p>
                {!u.is_frozen && (
                  <input
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    placeholder="Причина (необязательно)"
                    value={freezeReason}
                    onChange={e => setFreezeReason(e.target.value)}
                  />
                )}
                <button
                  disabled={loading}
                  onClick={handleFreeze}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${u.is_frozen ? 'bg-buy/20 text-buy hover:bg-buy/30' : 'bg-sell/20 text-sell hover:bg-sell/30'}`}
                >
                  {u.is_frozen ? 'Разморозить' : 'Заморозить'}
                </button>
              </div>

              {/* Role */}
              <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Изменить роль</p>
                <div className="flex gap-2">
                  <select
                    value={roleVal}
                    onChange={e => setRoleVal(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    disabled={loading}
                    onClick={handleRole}
                    className="px-4 py-2 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg text-sm font-medium transition-colors"
                  >
                    Сохранить
                  </button>
                </div>
              </div>

              {/* Balance */}
              <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Корректировка баланса</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Валюта"
                    value={balCurrency}
                    onChange={e => setBalCurrency(e.target.value.toUpperCase())}
                    className="w-24 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <input
                    type="number"
                    placeholder="Сумма"
                    value={balAmount}
                    onChange={e => setBalAmount(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <select
                    value={balOp}
                    onChange={e => setBalOp(e.target.value)}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="add">+ add</option>
                    <option value="subtract">- sub</option>
                    <option value="set">= set</option>
                  </select>
                  <button
                    disabled={loading || !balAmount}
                    onClick={handleBalance}
                    className="px-4 py-2 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    Применить
                  </button>
                </div>
              </div>
            </div>
          )}

          {dtab === 'balances' && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Валюта</th>
                  <th className="text-right px-3 py-2 font-medium">Доступно</th>
                  <th className="text-right px-3 py-2 font-medium">В ордерах</th>
                  <th className="text-right px-3 py-2 font-medium">Итого</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.balances.map(b => (
                  <tr key={b.currency} className="hover:bg-secondary/50">
                    <td className="px-3 py-2 font-medium">{b.currency}</td>
                    <td className="px-3 py-2 text-right font-mono-num">{fmt(b.available, 8)}</td>
                    <td className="px-3 py-2 text-right font-mono-num text-muted-foreground">{fmt(b.locked, 8)}</td>
                    <td className="px-3 py-2 text-right font-mono-num text-primary">{fmt(b.available + b.locked, 8)}</td>
                  </tr>
                ))}
                {data.balances.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Нет балансов</td></tr>
                )}
              </tbody>
            </table>
          )}

          {dtab === 'transactions' && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">ID</th>
                  <th className="text-left px-3 py-2 font-medium">Тип</th>
                  <th className="text-left px-3 py-2 font-medium">Валюта</th>
                  <th className="text-right px-3 py-2 font-medium">Сумма</th>
                  <th className="text-left px-3 py-2 font-medium">Статус</th>
                  <th className="text-left px-3 py-2 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.transactions.map(t => (
                  <tr key={t.id} className="hover:bg-secondary/50">
                    <td className="px-3 py-2 text-muted-foreground">#{t.id}</td>
                    <td className="px-3 py-2">{t.type}</td>
                    <td className="px-3 py-2 font-medium">{t.currency}</td>
                    <td className="px-3 py-2 text-right font-mono-num">{fmt(t.amount, 8)}</td>
                    <td className="px-3 py-2">{statusBadge(t.status)}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
                {data.transactions.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Нет транзакций</td></tr>
                )}
              </tbody>
            </table>
          )}

          {dtab === 'sessions' && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">ID</th>
                  <th className="text-left px-3 py-2 font-medium">IP</th>
                  <th className="text-left px-3 py-2 font-medium">User-Agent</th>
                  <th className="text-left px-3 py-2 font-medium">Создана</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(u.sessions ?? []).map(s => (
                  <tr key={s.id} className="hover:bg-secondary/50">
                    <td className="px-3 py-2 text-muted-foreground">#{s.id}</td>
                    <td className="px-3 py-2 font-mono-num text-xs">{s.ip}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">{s.user_agent}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
                {(u.sessions ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Нет сессий</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('stats');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  // stats
  const [stats, setStats] = useState<Stats | null>(null);

  // users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // kyc
  const [kycFilter, setKycFilter] = useState('pending');
  const [kycs, setKycs] = useState<KycSubmission[]>([]);
  const [kycRejectId, setKycRejectId] = useState<number | null>(null);
  const [kycRejectReason, setKycRejectReason] = useState('');

  // withdrawals
  const [wFilter, setWFilter] = useState('pending');
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [wApproveId, setWApproveId] = useState<number | null>(null);
  const [wTxHash, setWTxHash] = useState('');
  const [wRejectId, setWRejectId] = useState<number | null>(null);
  const [wRejectNote, setWRejectNote] = useState('');

  // orders
  const [orders, setOrders] = useState<Order[]>([]);

  // pairs
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pairEdits, setPairEdits] = useState<Record<number, Partial<Pair>>>({});

  // audit
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditPage, setAuditPage] = useState(1);

  // access check
  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    const allowed = user.is_admin || ['admin', 'superadmin', 'compliance', 'finance', 'support'].includes((user as unknown as { role: string }).role);
    if (!allowed) { navigate('/'); return; }
    loadStats();
  }, [user]);

  // load on tab change
  useEffect(() => {
    if (tab === 'users') loadUsers();
    if (tab === 'kyc') loadKyc();
    if (tab === 'withdrawals') loadWithdrawals();
    if (tab === 'orders') loadOrders();
    if (tab === 'pairs') loadPairs();
    if (tab === 'audit') loadAudit();
  }, [tab, kycFilter, wFilter, userPage, auditPage]);

  const showMsg = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  };

  // loaders
  const loadStats = async () => {
    const { ok, data } = await api.admin.stats();
    if (ok) setStats(data as Stats);
  };

  const loadUsers = async () => {
    const { ok, data } = await api.admin.users(userSearch || undefined, userPage);
    if (ok) {
      const d = data as { users: AdminUser[]; total: number };
      setUsers(d.users ?? []);
      setUsersTotal(d.total ?? 0);
    }
  };

  const loadKyc = async () => {
    const { ok, data } = await api.kyc.adminList(kycFilter);
    if (ok) setKycs((data as { submissions: KycSubmission[] }).submissions ?? []);
  };

  const loadWithdrawals = async () => {
    const { ok, data } = await api.admin.withdrawals(wFilter);
    if (ok) setWithdrawals((data as { withdrawals: Withdrawal[] }).withdrawals ?? []);
  };

  const loadOrders = async () => {
    const { ok, data } = await api.admin.orders();
    if (ok) setOrders((data as { orders: Order[] }).orders ?? []);
  };

  const loadPairs = async () => {
    const { ok, data } = await api.admin.pairs();
    if (ok) setPairs((data as { pairs: Pair[] }).pairs ?? []);
  };

  const loadAudit = async () => {
    const { ok, data } = await api.admin.auditLog(auditPage);
    if (ok) setAudit((data as { log: AuditEntry[] }).log ?? []);
  };

  // kyc actions
  const approveKyc = async (id: number) => {
    const { ok } = await api.kyc.approve(id);
    if (ok) { showMsg('KYC одобрен'); loadKyc(); } else showMsg('Ошибка', 'err');
  };

  const rejectKyc = async () => {
    if (!kycRejectId || !kycRejectReason) return;
    const { ok } = await api.kyc.reject(kycRejectId, kycRejectReason);
    if (ok) { showMsg('KYC отклонён'); setKycRejectId(null); setKycRejectReason(''); loadKyc(); } else showMsg('Ошибка', 'err');
  };

  // withdrawal actions
  const approveWithdrawal = async () => {
    if (!wApproveId || !wTxHash) return;
    const { ok } = await api.admin.approveWithdrawal(wApproveId, wTxHash);
    if (ok) { showMsg('Вывод подтверждён'); setWApproveId(null); setWTxHash(''); loadWithdrawals(); } else showMsg('Ошибка', 'err');
  };

  const rejectWithdrawal = async () => {
    if (!wRejectId || !wRejectNote) return;
    const { ok } = await api.admin.rejectWithdrawal(wRejectId, wRejectNote);
    if (ok) { showMsg('Вывод отклонён'); setWRejectId(null); setWRejectNote(''); loadWithdrawals(); } else showMsg('Ошибка', 'err');
  };

  // pair inline edit
  const setPairEdit = (pairId: number, field: keyof Pair, val: unknown) => {
    setPairEdits(prev => ({ ...prev, [pairId]: { ...prev[pairId], [field]: val } }));
  };

  const savePair = async (pairId: number) => {
    const edits = pairEdits[pairId];
    if (!edits) return;
    const { ok } = await api.admin.updatePair(pairId, edits as Record<string, unknown>);
    if (ok) {
      showMsg('Пара обновлена');
      setPairEdits(prev => { const c = { ...prev }; delete c[pairId]; return c; });
      loadPairs();
    } else showMsg('Ошибка', 'err');
  };

  const accessOk = user && (user.is_admin || ['admin', 'superadmin', 'compliance', 'finance', 'support'].includes((user as unknown as { role: string }).role));
  if (!accessOk) return null;

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'stats', label: 'Статистика', icon: 'BarChart2' },
    { id: 'users', label: 'Пользователи', icon: 'Users' },
    { id: 'kyc', label: 'KYC', icon: 'ShieldCheck' },
    { id: 'withdrawals', label: 'Выводы', icon: 'ArrowUpFromLine' },
    { id: 'orders', label: 'Ордера', icon: 'ListOrdered' },
    { id: 'pairs', label: 'Пары', icon: 'CandlestickChart' },
    { id: 'audit', label: 'Аудит', icon: 'ScrollText' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center px-4 gap-4 bg-card">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <Icon name="Hexagon" size={18} className="text-background" />
          </div>
          <span className="font-display text-lg font-bold">NEXUS</span>
        </Link>
        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-medium uppercase tracking-wide">Admin</span>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
            <Icon name="LayoutDashboard" size={15} />
            Кабинет
          </Link>
        </div>
      </header>

      {/* Message */}
      {msg && (
        <div className={`mx-4 mt-4 border rounded-lg px-4 py-3 text-sm flex items-center justify-between ${msgType === 'ok' ? 'bg-buy/10 border-buy/30 text-buy' : 'bg-sell/10 border-sell/30 text-sell'}`}>
          <span className="flex items-center gap-2">
            <Icon name={msgType === 'ok' ? 'CheckCircle2' : 'XCircle'} size={15} />
            {msg}
          </span>
          <button onClick={() => setMsg('')}><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1 overflow-x-auto scrollbar-thin">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── STATS ─────────────────────────────────────────────────────────── */}
        {tab === 'stats' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Пользователей" value={stats?.total_users?.toLocaleString() ?? '—'} icon="Users" color="text-primary" />
              <StatCard label="Новых за 24ч" value={stats?.new_users_24h?.toLocaleString() ?? '—'} icon="UserPlus" color="text-buy" />
              <StatCard label="Объём 24ч (USDT)" value={stats ? fmt(stats.volume_24h) : '—'} icon="TrendingUp" color="text-primary" />
              <StatCard label="Баланс платформы (USDT)" value={stats ? fmt(stats.total_usdt) : '—'} icon="Wallet" color="text-buy" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Pending KYC" value={stats?.pending_kyc?.toLocaleString() ?? '—'} icon="ShieldAlert" color="text-yellow-400" />
              <StatCard label="Pending выводов" value={stats?.pending_withdrawals?.toLocaleString() ?? '—'} icon="ArrowUpFromLine" color="text-sell" />
              <StatCard label="Pending депозитов" value={stats?.pending_deposits?.toLocaleString() ?? '—'} icon="ArrowDownToLine" color="text-yellow-400" />
              <StatCard label="Открытых ордеров" value={stats?.open_orders?.toLocaleString() ?? '—'} icon="ListOrdered" color="text-primary" />
            </div>
            <button
              onClick={() => { loadStats(); showMsg('Статистика обновлена'); }}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="RefreshCw" size={14} />
              Обновить
            </button>
          </div>
        )}

        {/* ── USERS ─────────────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Поиск по email, username..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setUserPage(1); loadUsers(); } }}
                className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <button
                onClick={() => { setUserPage(1); loadUsers(); }}
                className="px-4 py-2 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Icon name="Search" size={15} />
                Найти
              </button>
              <button
                onClick={() => { setUserSearch(''); setUserPage(1); loadUsers(); }}
                className="px-3 py-2 bg-secondary hover:bg-secondary/70 rounded-lg text-sm transition-colors"
              >
                <Icon name="X" size={15} />
              </button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold">Пользователи <span className="text-muted-foreground font-normal">({usersTotal.toLocaleString()})</span></span>
                <button onClick={loadUsers} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">ID</th>
                      <th className="text-left px-4 py-3 font-medium">Email</th>
                      <th className="text-left px-4 py-3 font-medium">Username</th>
                      <th className="text-left px-4 py-3 font-medium">Роль</th>
                      <th className="text-left px-4 py-3 font-medium">KYC</th>
                      <th className="text-right px-4 py-3 font-medium">Баланс USDT</th>
                      <th className="text-center px-4 py-3 font-medium">Заморожен</th>
                      <th className="text-left px-4 py-3 font-medium">Дата</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map(u => (
                      <tr
                        key={u.id}
                        onClick={() => setSelectedUserId(u.id)}
                        className="hover:bg-secondary/50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-muted-foreground">#{u.id}</td>
                        <td className="px-4 py-3 max-w-[180px] truncate">{u.email}</td>
                        <td className="px-4 py-3 font-medium">{u.username}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${u.role === 'admin' || u.role === 'superadmin' ? 'bg-primary/15 text-primary' : 'bg-secondary text-foreground'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">{kycBadge(u.kyc_status)}</td>
                        <td className="px-4 py-3 text-right font-mono-num">{fmt(u.usdt_balance)}</td>
                        <td className="px-4 py-3 text-center">
                          {u.is_frozen
                            ? <span className="text-sell"><Icon name="Lock" size={14} /></span>
                            : <span className="text-muted-foreground"><Icon name="Unlock" size={14} /></span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(u.created_at)}</td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Нет пользователей</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* pagination */}
              {usersTotal > 50 && (
                <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Страница {userPage}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setUserPage(p => Math.max(1, p - 1))}
                      disabled={userPage === 1}
                      className="px-3 py-1.5 bg-secondary rounded-lg hover:bg-secondary/70 disabled:opacity-40 transition-colors"
                    >
                      <Icon name="ChevronLeft" size={15} />
                    </button>
                    <button
                      onClick={() => setUserPage(p => p + 1)}
                      disabled={users.length < 50}
                      className="px-3 py-1.5 bg-secondary rounded-lg hover:bg-secondary/70 disabled:opacity-40 transition-colors"
                    >
                      <Icon name="ChevronRight" size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── KYC ───────────────────────────────────────────────────────────── */}
        {tab === 'kyc' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              {['pending', 'approved', 'rejected'].map(s => (
                <button
                  key={s}
                  onClick={() => setKycFilter(s)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${kycFilter === s ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s}
                </button>
              ))}
              <button onClick={loadKyc} className="ml-auto text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {kycs.map(k => (
                <div key={k.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{k.full_name}</p>
                      <p className="text-xs text-muted-foreground">{k.email} · @{k.username}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs bg-secondary px-2 py-0.5 rounded">Level {k.level}</span>
                      {statusBadge(k.status)}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-secondary/40 rounded-lg px-3 py-2">
                      <p className="text-muted-foreground mb-0.5">Паспорт</p>
                      <p className="font-mono-num font-medium">{k.passport_number || '—'}</p>
                    </div>
                    <div className="bg-secondary/40 rounded-lg px-3 py-2">
                      <p className="text-muted-foreground mb-0.5">Дата рождения</p>
                      <p className="font-medium">{k.birth_date || '—'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 text-xs">
                    {k.doc_passport_url && (
                      <a
                        href={k.doc_passport_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-secondary/70 rounded-lg transition-colors"
                      >
                        <Icon name="FileImage" size={13} />
                        Паспорт
                      </a>
                    )}
                    {k.doc_selfie_url && (
                      <a
                        href={k.doc_selfie_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-secondary/70 rounded-lg transition-colors"
                      >
                        <Icon name="Camera" size={13} />
                        Селфи
                      </a>
                    )}
                    <span className="ml-auto text-muted-foreground self-center">{fmtDate(k.created_at)}</span>
                  </div>

                  {k.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveKyc(k.id)}
                        className="flex-1 py-2 bg-buy/15 text-buy hover:bg-buy/25 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <Icon name="CheckCircle2" size={13} />
                        Одобрить
                      </button>
                      <button
                        onClick={() => { setKycRejectId(k.id); setKycRejectReason(''); }}
                        className="flex-1 py-2 bg-sell/15 text-sell hover:bg-sell/25 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <Icon name="XCircle" size={13} />
                        Отклонить
                      </button>
                    </div>
                  )}

                  {/* inline reject form */}
                  {kycRejectId === k.id && (
                    <div className="flex gap-2 mt-1">
                      <input
                        autoFocus
                        placeholder="Причина отказа..."
                        value={kycRejectReason}
                        onChange={e => setKycRejectReason(e.target.value)}
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sell"
                      />
                      <button
                        onClick={rejectKyc}
                        disabled={!kycRejectReason}
                        className="px-3 py-2 bg-sell/20 text-sell hover:bg-sell/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        Ок
                      </button>
                      <button
                        onClick={() => setKycRejectId(null)}
                        className="px-3 py-2 bg-secondary hover:bg-secondary/70 rounded-lg text-xs transition-colors"
                      >
                        <Icon name="X" size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {kycs.length === 0 && (
                <div className="col-span-2 py-12 text-center text-muted-foreground">
                  <Icon name="ShieldCheck" size={32} className="mx-auto mb-3 opacity-30" />
                  Нет заявок со статусом «{kycFilter}»
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── WITHDRAWALS ───────────────────────────────────────────────────── */}
        {tab === 'withdrawals' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {['pending', 'completed', 'rejected'].map(s => (
                <button
                  key={s}
                  onClick={() => setWFilter(s)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${wFilter === s ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s}
                </button>
              ))}
              <button onClick={loadWithdrawals} className="ml-auto text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">ID</th>
                      <th className="text-left px-4 py-3 font-medium">Пользователь</th>
                      <th className="text-left px-4 py-3 font-medium">Сеть / Валюта</th>
                      <th className="text-right px-4 py-3 font-medium">Сумма</th>
                      <th className="text-right px-4 py-3 font-medium">Комиссия</th>
                      <th className="text-left px-4 py-3 font-medium">Адрес</th>
                      <th className="text-left px-4 py-3 font-medium">Статус</th>
                      <th className="text-left px-4 py-3 font-medium">Дата</th>
                      {wFilter === 'pending' && <th className="text-center px-4 py-3 font-medium">Действия</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {withdrawals.map(w => (
                      <>
                        <tr key={w.id} className="hover:bg-secondary/50 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground">#{w.id}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{w.username}</p>
                            <p className="text-xs text-muted-foreground">KYC {w.kyc_level}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{w.currency}</p>
                            <p className="text-xs text-muted-foreground">{w.network}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono-num">{fmt(w.amount, 6)}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-muted-foreground">{fmt(w.fee, 6)}</td>
                          <td className="px-4 py-3 max-w-[140px] truncate font-mono-num text-xs text-muted-foreground">{w.to_address}</td>
                          <td className="px-4 py-3">{statusBadge(w.status)}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(w.created_at)}</td>
                          {wFilter === 'pending' && (
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => { setWApproveId(wApproveId === w.id ? null : w.id); setWRejectId(null); setWTxHash(''); }}
                                  className="px-2 py-1 bg-buy/15 text-buy hover:bg-buy/25 rounded-lg text-xs font-medium transition-colors"
                                >
                                  Подтвердить
                                </button>
                                <button
                                  onClick={() => { setWRejectId(wRejectId === w.id ? null : w.id); setWApproveId(null); setWRejectNote(''); }}
                                  className="px-2 py-1 bg-sell/15 text-sell hover:bg-sell/25 rounded-lg text-xs font-medium transition-colors"
                                >
                                  Отклонить
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                        {/* inline approve form */}
                        {wApproveId === w.id && (
                          <tr key={`approve-${w.id}`} className="bg-buy/5">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-buy font-medium whitespace-nowrap">TX Hash:</span>
                                <input
                                  autoFocus
                                  placeholder="0x..."
                                  value={wTxHash}
                                  onChange={e => setWTxHash(e.target.value)}
                                  className="flex-1 bg-background border border-buy/40 rounded-lg px-3 py-2 text-xs font-mono-num focus:outline-none focus:border-buy"
                                />
                                <button
                                  onClick={approveWithdrawal}
                                  disabled={!wTxHash}
                                  className="px-3 py-2 bg-buy/20 text-buy hover:bg-buy/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                                >
                                  Подтвердить
                                </button>
                                <button onClick={() => setWApproveId(null)} className="text-muted-foreground hover:text-foreground">
                                  <Icon name="X" size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                        {/* inline reject form */}
                        {wRejectId === w.id && (
                          <tr key={`reject-${w.id}`} className="bg-sell/5">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-sell font-medium whitespace-nowrap">Причина:</span>
                                <input
                                  autoFocus
                                  placeholder="Укажите причину..."
                                  value={wRejectNote}
                                  onChange={e => setWRejectNote(e.target.value)}
                                  className="flex-1 bg-background border border-sell/40 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sell"
                                />
                                <button
                                  onClick={rejectWithdrawal}
                                  disabled={!wRejectNote}
                                  className="px-3 py-2 bg-sell/20 text-sell hover:bg-sell/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                                >
                                  Отклонить
                                </button>
                                <button onClick={() => setWRejectId(null)} className="text-muted-foreground hover:text-foreground">
                                  <Icon name="X" size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                    {withdrawals.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Нет заявок</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── ORDERS ────────────────────────────────────────────────────────── */}
        {tab === 'orders' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold">Открытые ордера <span className="text-muted-foreground font-normal">({orders.length})</span></span>
              <button onClick={loadOrders} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Пользователь</th>
                    <th className="text-left px-4 py-3 font-medium">Пара</th>
                    <th className="text-left px-4 py-3 font-medium">Сторона</th>
                    <th className="text-left px-4 py-3 font-medium">Тип</th>
                    <th className="text-right px-4 py-3 font-medium">Цена</th>
                    <th className="text-right px-4 py-3 font-medium">Кол-во</th>
                    <th className="text-right px-4 py-3 font-medium">Исполнено</th>
                    <th className="text-left px-4 py-3 font-medium">Статус</th>
                    <th className="text-left px-4 py-3 font-medium">Дата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map(o => (
                    <tr key={o.id} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">#{o.id}</td>
                      <td className="px-4 py-3 font-medium">{o.username}</td>
                      <td className="px-4 py-3 font-medium text-primary">{o.symbol}</td>
                      <td className={`px-4 py-3 font-medium ${o.side === 'buy' ? 'text-buy' : 'text-sell'}`}>
                        {o.side.toUpperCase()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{o.type}</td>
                      <td className="px-4 py-3 text-right font-mono-num">{fmt(o.price)}</td>
                      <td className="px-4 py-3 text-right font-mono-num">{fmt(o.qty, 6)}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-muted-foreground">{fmt(o.filled_qty, 6)}</td>
                      <td className="px-4 py-3">{statusBadge(o.status)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(o.created_at)}</td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Нет открытых ордеров</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PAIRS ─────────────────────────────────────────────────────────── */}
        {tab === 'pairs' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold">Торговые пары <span className="text-muted-foreground font-normal">({pairs.length})</span></span>
              <button onClick={loadPairs} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Пара</th>
                    <th className="text-center px-4 py-3 font-medium">Активна</th>
                    <th className="text-right px-4 py-3 font-medium">Последняя цена</th>
                    <th className="text-right px-4 py-3 font-medium">Объём 24ч</th>
                    <th className="text-right px-4 py-3 font-medium">Maker Fee</th>
                    <th className="text-right px-4 py-3 font-medium">Taker Fee</th>
                    <th className="text-center px-4 py-3 font-medium">Сохранить</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pairs.map(p => {
                    const e = pairEdits[p.id] ?? {};
                    const isActive = e.is_active !== undefined ? e.is_active : p.is_active;
                    const makerFee = e.maker_fee !== undefined ? e.maker_fee : p.maker_fee;
                    const takerFee = e.taker_fee !== undefined ? e.taker_fee : p.taker_fee;
                    const dirty = Object.keys(e).length > 0;
                    return (
                      <tr key={p.id} className="hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-primary">{p.symbol}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setPairEdit(p.id, 'is_active', !isActive)}
                            className={`w-10 h-5 rounded-full transition-colors relative ${isActive ? 'bg-buy' : 'bg-secondary'}`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num">{fmt(p.last_price)}</td>
                        <td className="px-4 py-3 text-right font-mono-num text-muted-foreground">{fmt(p.volume_24h)}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            value={makerFee}
                            step="0.0001"
                            onChange={e => setPairEdit(p.id, 'maker_fee', parseFloat(e.target.value))}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-right text-xs font-mono-num focus:outline-none focus:border-primary"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            value={takerFee}
                            step="0.0001"
                            onChange={e => setPairEdit(p.id, 'taker_fee', parseFloat(e.target.value))}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-right text-xs font-mono-num focus:outline-none focus:border-primary"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => savePair(p.id)}
                            disabled={!dirty}
                            className="px-3 py-1.5 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
                          >
                            <Icon name="Save" size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {pairs.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Нет пар</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── AUDIT ─────────────────────────────────────────────────────────── */}
        {tab === 'audit' && (
          <div className="space-y-3">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold">Журнал аудита</span>
                <button onClick={loadAudit} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Дата</th>
                      <th className="text-left px-4 py-3 font-medium">Админ</th>
                      <th className="text-left px-4 py-3 font-medium">Действие</th>
                      <th className="text-left px-4 py-3 font-medium">Сущность</th>
                      <th className="text-left px-4 py-3 font-medium">ID</th>
                      <th className="text-left px-4 py-3 font-medium">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {audit.map(a => (
                      <tr key={a.id} className="hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(a.created_at)}</td>
                        <td className="px-4 py-3 font-medium text-primary">{a.admin}</td>
                        <td className="px-4 py-3">{a.action}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.entity_type}</td>
                        <td className="px-4 py-3 text-muted-foreground">#{a.entity_id}</td>
                        <td className="px-4 py-3 font-mono-num text-xs text-muted-foreground">{a.ip}</td>
                      </tr>
                    ))}
                    {audit.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Журнал пуст</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* audit pagination */}
              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Страница {auditPage}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                    disabled={auditPage === 1}
                    className="px-3 py-1.5 bg-secondary rounded-lg hover:bg-secondary/70 disabled:opacity-40 transition-colors"
                  >
                    <Icon name="ChevronLeft" size={15} />
                  </button>
                  <button
                    onClick={() => setAuditPage(p => p + 1)}
                    disabled={audit.length < 50}
                    className="px-3 py-1.5 bg-secondary rounded-lg hover:bg-secondary/70 disabled:opacity-40 transition-colors"
                  >
                    <Icon name="ChevronRight" size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onMsg={(m) => showMsg(m)}
        />
      )}
    </div>
  );
}
