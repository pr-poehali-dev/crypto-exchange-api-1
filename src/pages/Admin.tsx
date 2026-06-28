import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { hasRole, ROLE_LEVELS } from '@/lib/roles';
import type { UserRole } from '@/lib/roles';
import { api } from '@/lib/api';
import Icon from '@/components/ui/icon';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'stats' | 'users' | 'kyc' | 'withdrawals' | 'transactions' | 'orders' | 'pairs' | 'audit' | 'circuit' | 'hot-pool' | 'sweep' | 'aml' | 'vault';
type UserDetailTab = 'profile' | 'balances' | 'transactions' | 'sessions';

interface Stats {
  total_users: number; new_users_24h: number; pending_deposits: number;
  pending_withdrawals: number; total_usdt: number; pending_kyc: number;
  open_orders: number; volume_24h: number;
}

interface AdminUser {
  id: number; email: string; username: string; role: string;
  kyc_status: string; kyc_level: number; is_frozen: boolean;
  created_at: string; usdt_balance: number;
}

interface KycSubmission {
  id: number; user_id: number; email: string; username: string;
  level: number; status: string; full_name: string; birth_date: string | null;
  passport_number: string; doc_passport_url: string; doc_selfie_url: string; created_at: string;
}

interface Withdrawal {
  id: number; username: string; email: string; kyc_level: number;
  network: string; currency: string; amount: number; fee: number;
  to_address: string; status: string; tx_hash: string | null; created_at: string;
}

interface Order {
  id: number; username: string; symbol: string; side: string;
  type: string; status: string; price: number | null; qty: number;
  filled_qty: number; created_at: string;
}

interface Pair {
  id: number; symbol: string; base: string; quote: string;
  is_active: boolean; maker_fee: number; taker_fee: number;
  last_price: number; volume_24h: number;
}

interface AuditEntry {
  id: number; admin: string; action: string; entity_type: string;
  entity_id: string; old: unknown; new: unknown; ip: string; created_at: string;
}

interface AdminTx {
  id: number; username: string; type: string; currency: string;
  amount: number; fee: number; status: string; note: string; created_at: string;
}

interface UserDetail {
  user: {
    id: number; email: string; username: string; role: string;
    kyc_status: string; kyc_level: number; is_frozen: boolean;
    freeze_reason: string | null; full_name: string | null; birth_date: string | null;
    created_at: string;
    sessions: { id: number; ip: string; user_agent: string; created_at: string }[];
  };
  balances: { currency: string; available: number; locked: number }[];
  transactions: { id: number; type: string; currency: string; amount: number; fee: number; status: string; note: string; created_at: string }[];
}

interface HotPool {
  id: number; network: string; currency: string; address: string;
  is_active: boolean; balance_onchain: number; target_pct: number;
  target_amount: number; pending_withdrawals: number; is_low_balance: boolean;
  last_synced: string | null; note: string | null;
}
interface ColdVault {
  id: number; network: string; currency: string; address: string;
  multisig: string; balance_onchain: number; is_active: boolean;
}
interface SweepEntry {
  id: number; user_id: number; username: string; network: string; currency: string;
  from_address: string; to_address: string; amount: number; fee: number;
  tx_hash: string | null; status: string; confirmations: number;
  triggered_by: string; created_at: string;
}
interface AmlDashboard {
  blacklisted_addresses: number; watchlisted_addresses: number;
  blocked_withdrawals: number; flagged_withdrawals: number;
  pending_aml_review: number; frozen_users: number; pending_whitelist: number;
  recent_flagged: { id: number; username: string; currency: string; amount: number; to_address: string; aml_status: string; risk_score: number; created_at: string }[];
}
interface AddressFlag {
  id: number; address: string; network: string; flag_type: string;
  risk_score: number; reason: string; source: string; created_at: string;
}
interface VaultRequest {
  id: number; network: string; currency: string; amount: number; status: string;
  requested_by: string;
  sigs: { finance: boolean; compliance: boolean; superadmin: boolean; required: number; collected: number };
  tx_hash: string | null; note: string | null; created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, dec = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtDate = (s: string) =>
  new Date(s).toLocaleString('ru', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const ROLE_COLORS: Record<string, string> = {
  superadmin: 'text-purple-400 bg-purple-400/10',
  admin: 'text-primary bg-primary/10',
  finance: 'text-yellow-400 bg-yellow-400/10',
  compliance: 'text-blue-400 bg-blue-400/10',
  devops: 'text-muted-foreground bg-secondary',
  support: 'text-green-400 bg-green-400/10',
  user: 'text-muted-foreground bg-secondary',
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', finance: 'Finance',
  compliance: 'Compliance', devops: 'Devops', support: 'Support', user: 'User',
};

function getAvailableTabs(role: string): Tab[] {
  switch (role) {
    case 'superadmin': return ['stats', 'users', 'kyc', 'aml', 'withdrawals', 'hot-pool', 'sweep', 'vault', 'transactions', 'orders', 'pairs', 'audit', 'circuit'];
    case 'admin':      return ['stats', 'users', 'orders', 'pairs', 'audit'];
    case 'finance':    return ['stats', 'users', 'withdrawals', 'hot-pool', 'sweep', 'vault', 'transactions'];
    case 'compliance': return ['stats', 'users', 'kyc', 'aml', 'sweep'];
    case 'devops':     return ['stats'];
    case 'support':    return ['stats', 'users'];
    default:           return ['stats'];
  }
}

const TAB_ICONS: Record<Tab, string> = {
  stats: 'BarChart2', users: 'Users', kyc: 'ShieldCheck', withdrawals: 'ArrowUpFromLine',
  transactions: 'Receipt', orders: 'ListOrdered', pairs: 'CandlestickChart',
  audit: 'ScrollText', circuit: 'AlertTriangle',
  'hot-pool': 'Flame', sweep: 'ArrowRightLeft', aml: 'ScanSearch', vault: 'Database',
};

const TAB_LABELS: Record<Tab, string> = {
  stats: 'Статистика', users: 'Пользователи', kyc: 'KYC', withdrawals: 'Выводы',
  transactions: 'Транзакции', orders: 'Ордера', pairs: 'Пары',
  audit: 'Аудит', circuit: 'Circuit Breaker',
  'hot-pool': 'Hot Pool', sweep: 'Sweep Лог', aml: 'AML', vault: 'Vault Transfer',
};

function kycBadge(status: string) {
  const map: Record<string, string> = {
    none: 'text-muted-foreground', pending: 'text-yellow-400',
    approved: 'text-buy', rejected: 'text-sell',
  };
  return <span className={`text-xs font-medium ${map[status] ?? 'text-muted-foreground'}`}>{status}</span>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'text-yellow-400', completed: 'text-buy', approved: 'text-buy',
    rejected: 'text-sell', cancelled: 'text-sell', open: 'text-primary',
    filled: 'text-buy', partially_filled: 'text-yellow-400',
  };
  return <span className={`text-xs font-medium ${map[status] ?? 'text-muted-foreground'}`}>{status}</span>;
}

// ─── StatCard ────────────────────────────────────────────────────────────────

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

// ─── SoD Banner ──────────────────────────────────────────────────────────────

function SodBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 mb-4">
      <Icon name="AlertTriangle" size={18} className="text-yellow-400 mt-0.5 shrink-0" />
      <p className="text-sm text-yellow-400">{message}</p>
    </div>
  );
}

// ─── UserDetailModal ──────────────────────────────────────────────────────────

function UserDetailModal({
  userId,
  viewerRole,
  onClose,
  onMsg,
}: {
  userId: number;
  viewerRole: string;
  onClose: () => void;
  onMsg: (m: string) => void;
}) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [dtab, setDtab] = useState<UserDetailTab>('profile');
  const [roleVal, setRoleVal] = useState('');
  const [freezeReason, setFreezeReason] = useState('');
  const [loading, setLoading] = useState(false);

  const viewerLevel = ROLE_LEVELS[viewerRole as UserRole] ?? 0;
  const isCompliance = viewerLevel >= ROLE_LEVELS['compliance'];
  const isFinance    = viewerLevel >= ROLE_LEVELS['finance'];
  const isSuperadmin = viewerRole === 'superadmin';
  const isSupport    = viewerRole === 'support';

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

  const availableDtabs: { id: UserDetailTab; label: string }[] = [
    { id: 'profile', label: 'Профиль' },
    ...(isFinance ? [{ id: 'balances' as UserDetailTab, label: 'Балансы' }] : []),
    { id: 'transactions', label: 'Транзакции' },
    { id: 'sessions', label: 'Сессии' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold">{u.username}</p>
            <p className="text-xs text-muted-foreground">{u.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {u.is_frozen && (
              <span className="text-xs bg-sell/15 text-sell px-2 py-0.5 rounded font-medium">ЗАМОРОЖЕН</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_COLORS[u.role] ?? 'text-muted-foreground bg-secondary'}`}>
              {ROLE_LABELS[u.role] ?? u.role}
            </span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2">
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>

        <div className="flex gap-1 px-5 pt-3 shrink-0">
          {availableDtabs.map(t => (
            <button
              key={t.id}
              onClick={() => setDtab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dtab === t.id ? 'bg-primary text-background' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ПРОФИЛЬ */}
          {dtab === 'profile' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="text-sm font-mono">{u.email}</p>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Username</p>
                  <p className="text-sm font-mono">{u.username}</p>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Роль</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${ROLE_COLORS[u.role] ?? ''}`}>
                    {ROLE_LABELS[u.role] ?? u.role}
                  </span>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">KYC статус</p>
                  {kycBadge(u.kyc_status)}
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Дата регистрации</p>
                  <p className="text-sm">{fmtDate(u.created_at)}</p>
                </div>
                {isCompliance && u.full_name && (
                  <div className="bg-secondary rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">ФИО</p>
                    <p className="text-sm">{u.full_name}</p>
                  </div>
                )}
                {isCompliance && u.birth_date && (
                  <div className="bg-secondary rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Дата рождения</p>
                    <p className="text-sm">{u.birth_date}</p>
                  </div>
                )}
              </div>

              {/* Заморозить — compliance+ */}
              {isCompliance && (
                <div className="border border-border rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium">Управление доступом</p>
                  {!u.is_frozen && (
                    <input
                      type="text"
                      placeholder="Причина заморозки"
                      value={freezeReason}
                      onChange={e => setFreezeReason(e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
                    />
                  )}
                  <button
                    onClick={handleFreeze}
                    disabled={loading || (!u.is_frozen && !freezeReason.trim())}
                    className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${u.is_frozen ? 'bg-buy/20 text-buy hover:bg-buy/30' : 'bg-sell/20 text-sell hover:bg-sell/30'}`}
                  >
                    {loading ? 'Обработка...' : u.is_frozen ? 'Разморозить' : 'Заморозить'}
                  </button>
                  {u.is_frozen && u.freeze_reason && (
                    <p className="text-xs text-muted-foreground">Причина: {u.freeze_reason}</p>
                  )}
                </div>
              )}

              {/* Изменить роль — superadmin only */}
              {isSuperadmin && (
                <div className="border border-purple-400/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Icon name="AlertTriangle" size={16} className="text-yellow-400" />
                    <p className="text-sm font-medium text-yellow-400">Изменить роль пользователя</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Действие записывается в аудит-лог. Убедитесь в правомерности назначения.
                  </p>
                  <div className="flex gap-2">
                    <select
                      value={roleVal}
                      onChange={e => setRoleVal(e.target.value)}
                      className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
                    >
                      {['user', 'support', 'compliance', 'finance', 'devops', 'admin', 'superadmin'].map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleRole}
                      disabled={loading || roleVal === u.role}
                      className="px-4 py-2 bg-purple-400/20 text-purple-400 hover:bg-purple-400/30 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      Применить
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* БАЛАНСЫ — finance+ */}
          {dtab === 'balances' && isFinance && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-xs text-muted-foreground font-medium">Валюта</th>
                      <th className="text-right py-2 text-xs text-muted-foreground font-medium">Доступно</th>
                      <th className="text-right py-2 text-xs text-muted-foreground font-medium">Заблокировано</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.balances.map(b => (
                      <tr key={b.currency} className="border-b border-border/50">
                        <td className="py-2 font-medium">{b.currency}</td>
                        <td className="py-2 text-right font-mono-num text-buy">{fmt(b.available)}</td>
                        <td className="py-2 text-right font-mono-num text-muted-foreground">{fmt(b.locked)}</td>
                      </tr>
                    ))}
                    {data.balances.length === 0 && (
                      <tr><td colSpan={3} className="py-6 text-center text-muted-foreground text-xs">Нет данных</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ТРАНЗАКЦИИ */}
          {dtab === 'transactions' && (
            <div className="space-y-2">
              {data.transactions.map(tx => (
                <div key={tx.id} className="bg-secondary rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div>
                      <p className="text-xs font-medium">{tx.type}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(tx.created_at)}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {!isSupport ? (
                      <p className="text-sm font-mono-num">{fmt(tx.amount)} <span className="text-muted-foreground">{tx.currency}</span></p>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                    {statusBadge(tx.status)}
                  </div>
                </div>
              ))}
              {data.transactions.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-6">Нет транзакций</p>
              )}
            </div>
          )}

          {/* СЕССИИ */}
          {dtab === 'sessions' && (
            <div className="space-y-2">
              {isSupport ? (
                <div className="bg-secondary rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold mb-1">{u.sessions.length}</p>
                  <p className="text-xs text-muted-foreground">активных сессий</p>
                </div>
              ) : (
                u.sessions.map(s => (
                  <div key={s.id} className="bg-secondary rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-mono text-primary">{s.ip}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(s.created_at)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{s.user_agent}</p>
                  </div>
                ))
              )}
              {!isSupport && u.sessions.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-6">Нет активных сессий</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TabStats ─────────────────────────────────────────────────────────────────

function TabStats({ stats, role }: { stats: Stats | null; role: string }) {
  if (!stats) return <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>;

  const isDevops = role === 'devops';

  const cards = isDevops ? [
    { label: 'Открытых ордеров', value: stats.open_orders.toLocaleString(), icon: 'ListOrdered', color: 'text-primary' },
    { label: 'Объём 24h (USDT)', value: fmt(stats.volume_24h, 0), icon: 'BarChart2', color: 'text-primary' },
    { label: 'Ожид. депозитов', value: stats.pending_deposits.toLocaleString(), icon: 'ArrowDownFromLine', color: 'text-yellow-400' },
    { label: 'Ожид. выводов', value: stats.pending_withdrawals.toLocaleString(), icon: 'ArrowUpFromLine', color: 'text-yellow-400' },
  ] : [
    { label: 'Всего пользователей', value: stats.total_users.toLocaleString(), icon: 'Users', color: 'text-primary' },
    { label: 'Новых за 24h', value: stats.new_users_24h.toLocaleString(), icon: 'UserPlus', color: 'text-buy' },
    { label: 'Ожид. депозитов', value: stats.pending_deposits.toLocaleString(), icon: 'ArrowDownFromLine', color: 'text-yellow-400' },
    { label: 'Ожид. выводов', value: stats.pending_withdrawals.toLocaleString(), icon: 'ArrowUpFromLine', color: 'text-yellow-400' },
    { label: 'Всего USDT', value: fmt(stats.total_usdt, 0), icon: 'DollarSign', color: 'text-buy' },
    { label: 'KYC на проверке', value: stats.pending_kyc.toLocaleString(), icon: 'ShieldCheck', color: 'text-blue-400' },
    { label: 'Открытых ордеров', value: stats.open_orders.toLocaleString(), icon: 'ListOrdered', color: 'text-primary' },
    { label: 'Объём 24h (USDT)', value: fmt(stats.volume_24h, 0), icon: 'BarChart2', color: 'text-primary' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => <StatCard key={c.label} {...c} />)}
    </div>
  );
}

// ─── TabUsers ─────────────────────────────────────────────────────────────────

function TabUsers({ role }: { role: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const isSupport = role === 'support';

  const load = async (q: string) => {
    setLoading(true);
    const { ok, data } = await api.admin.users(q || undefined);
    if (ok) setUsers((data as { users: AdminUser[] }).users ?? []);
    setLoading(false);
  };

  useEffect(() => { load(''); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(search);
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className="bg-buy/10 border border-buy/30 rounded-xl px-4 py-3 text-sm text-buy flex items-center justify-between">
          {msg}
          <button onClick={() => setMsg('')}><Icon name="X" size={14} /></button>
        </div>
      )}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по email или username..."
          className="flex-1 bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground"
        />
        <button type="submit" className="px-4 py-2.5 bg-primary text-background rounded-xl text-sm font-medium">
          <Icon name="Search" size={16} />
        </button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">ID</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Email</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Username</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Роль</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">KYC</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Баланс USDT</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Заморожен</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Регистрация</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className="border-t border-border hover:bg-secondary/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground">{u.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${ROLE_COLORS[u.role] ?? 'text-muted-foreground bg-secondary'}`}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">{kycBadge(u.kyc_status)}</td>
                  <td className="px-4 py-3 text-right font-mono-num">
                    {isSupport ? '—' : fmt(u.usdt_balance)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.is_frozen
                      ? <Icon name="Lock" size={14} className="text-sell mx-auto" />
                      : <Icon name="Unlock" size={14} className="text-muted-foreground mx-auto" />}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Пользователи не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedId !== null && (
        <UserDetailModal
          userId={selectedId}
          viewerRole={role}
          onClose={() => { setSelectedId(null); load(search); }}
          onMsg={m => { setMsg(m); setTimeout(() => setMsg(''), 4000); }}
        />
      )}
    </div>
  );
}

// ─── TabKyc ───────────────────────────────────────────────────────────────────

function TabKyc() {
  const [list, setList] = useState<KycSubmission[]>([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [rejectIds, setRejectIds] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');

  const load = async (s: string) => {
    setLoading(true);
    const { ok, data } = await api.kyc.adminList(s);
    if (ok) setList((data as { submissions: KycSubmission[] }).submissions ?? []);
    setLoading(false);
  };

  useEffect(() => { load(filter); }, [filter]);

  const handleApprove = async (id: number) => {
    const { ok } = await api.kyc.approve(id);
    if (ok) { setMsg('KYC одобрен'); load(filter); setTimeout(() => setMsg(''), 3000); }
  };

  const handleReject = async (id: number) => {
    const reason = rejectIds[id];
    if (!reason?.trim()) return;
    const { ok } = await api.kyc.reject(id, reason);
    if (ok) { setMsg('KYC отклонён'); load(filter); setTimeout(() => setMsg(''), 3000); }
  };

  return (
    <div className="space-y-4">
      <SodBanner message="Finance и Admin не имеют доступа к документам KYC согласно политике разделения обязанностей (SoD)." />

      {msg && (
        <div className="bg-buy/10 border border-buy/30 rounded-xl px-4 py-3 text-sm text-buy">{msg}</div>
      )}

      <div className="flex gap-2">
        {['pending', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === s ? 'bg-primary text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            {s === 'pending' ? 'На проверке' : s === 'approved' ? 'Одобрены' : 'Отклонены'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-4">
          {list.map(k => (
            <div key={k.id} className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{k.full_name}</p>
                  <p className="text-xs text-muted-foreground">{k.email} · @{k.username}</p>
                </div>
                <div className="text-right">
                  {kycBadge(k.status)}
                  <p className="text-xs text-muted-foreground mt-1">{fmtDate(k.created_at)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Паспорт</p>
                  <p className="font-mono">{k.passport_number}</p>
                </div>
                {k.birth_date && (
                  <div className="bg-secondary rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Дата рождения</p>
                    <p>{k.birth_date}</p>
                  </div>
                )}
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Уровень KYC</p>
                  <p>{k.level}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {k.doc_passport_url && (
                  <a
                    href={k.doc_passport_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-border rounded-lg text-xs font-medium transition-colors"
                  >
                    <Icon name="FileText" size={14} />
                    Паспорт
                  </a>
                )}
                {k.doc_selfie_url && (
                  <a
                    href={k.doc_selfie_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-border rounded-lg text-xs font-medium transition-colors"
                  >
                    <Icon name="Camera" size={14} />
                    Селфи
                  </a>
                )}
              </div>
              {k.status === 'pending' && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => handleApprove(k.id)}
                    className="px-4 py-2 bg-buy/20 text-buy hover:bg-buy/30 rounded-lg text-sm font-medium transition-colors"
                  >
                    Одобрить
                  </button>
                  <input
                    type="text"
                    placeholder="Причина отклонения..."
                    value={rejectIds[k.id] ?? ''}
                    onChange={e => setRejectIds(prev => ({ ...prev, [k.id]: e.target.value }))}
                    className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => handleReject(k.id)}
                    disabled={!rejectIds[k.id]?.trim()}
                    className="px-4 py-2 bg-sell/20 text-sell hover:bg-sell/30 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Отклонить
                  </button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && (
            <p className="text-center text-muted-foreground py-12">Нет заявок в статусе «{filter}»</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TabWithdrawals ───────────────────────────────────────────────────────────

function TabWithdrawals({ role }: { role: string }) {
  const isCompliance = role === 'compliance';

  const [list, setList] = useState<Withdrawal[]>([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [txHashMap, setTxHashMap] = useState<Record<number, string>>({});
  const [noteMap, setNoteMap] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');

  const load = async (s: string) => {
    setLoading(true);
    const { ok, data } = await api.admin.withdrawals(s);
    if (ok) setList((data as { withdrawals: Withdrawal[] }).withdrawals ?? []);
    setLoading(false);
  };

  useEffect(() => { if (!isCompliance) load(filter); }, [filter]);

  if (isCompliance) {
    return (
      <SodBanner message="Compliance не может подтверждать выводы средств. Функция подтверждения выводов закреплена за Finance согласно политике разделения обязанностей (SoD)." />
    );
  }

  const handleApprove = async (id: number) => {
    const hash = txHashMap[id];
    if (!hash?.trim()) return;
    const { ok } = await api.admin.approveWithdrawal(id, hash);
    if (ok) { setMsg('Вывод подтверждён'); load(filter); setTimeout(() => setMsg(''), 3000); }
  };

  const handleReject = async (id: number) => {
    const note = noteMap[id];
    if (!note?.trim()) return;
    const { ok } = await api.admin.rejectWithdrawal(id, note);
    if (ok) { setMsg('Вывод отклонён'); load(filter); setTimeout(() => setMsg(''), 3000); }
  };

  return (
    <div className="space-y-4">
      <SodBanner message="Compliance не может подтверждать выводы средств согласно политике разделения обязанностей (SoD)." />

      {msg && (
        <div className="bg-buy/10 border border-buy/30 rounded-xl px-4 py-3 text-sm text-buy">{msg}</div>
      )}

      <div className="flex gap-2">
        {['pending', 'completed', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === s ? 'bg-primary text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            {s === 'pending' ? 'Ожидающие' : s === 'completed' ? 'Выполненные' : 'Отклонённые'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">ID</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Пользователь</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Сеть</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Сумма</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Комиссия</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Адрес</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Статус</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Дата</th>
                {filter === 'pending' && <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {list.map(w => (
                <tr key={w.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground">{w.id}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{w.username}</p>
                    <p className="text-xs text-muted-foreground">{w.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{w.network}</p>
                    <p className="text-xs text-muted-foreground">{w.currency}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-sell">{fmt(w.amount)}</td>
                  <td className="px-4 py-3 text-right font-mono-num text-muted-foreground">{fmt(w.fee)}</td>
                  <td className="px-4 py-3 font-mono text-xs max-w-[140px] truncate">{w.to_address}</td>
                  <td className="px-4 py-3">{statusBadge(w.status)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(w.created_at)}</td>
                  {filter === 'pending' && (
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5 min-w-[280px]">
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="TX Hash"
                            value={txHashMap[w.id] ?? ''}
                            onChange={e => setTxHashMap(prev => ({ ...prev, [w.id]: e.target.value }))}
                            className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => handleApprove(w.id)}
                            disabled={!txHashMap[w.id]?.trim()}
                            className="px-2 py-1 bg-buy/20 text-buy hover:bg-buy/30 rounded text-xs font-medium disabled:opacity-50"
                          >
                            OK
                          </button>
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="Причина отклонения"
                            value={noteMap[w.id] ?? ''}
                            onChange={e => setNoteMap(prev => ({ ...prev, [w.id]: e.target.value }))}
                            className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => handleReject(w.id)}
                            disabled={!noteMap[w.id]?.trim()}
                            className="px-2 py-1 bg-sell/20 text-sell hover:bg-sell/30 rounded text-xs font-medium disabled:opacity-50"
                          >
                            X
                          </button>
                        </div>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={filter === 'pending' ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Нет выводов в статусе «{filter}»
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── TabTransactions ──────────────────────────────────────────────────────────

function TabTransactions() {
  const [list, setList] = useState<AdminTx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { ok, data } = await api.admin.transactions();
      if (ok) setList((data as { transactions: AdminTx[] }).transactions ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary">
          <tr>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">ID</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Пользователь</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Тип</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Валюта</th>
            <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Сумма</th>
            <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Комиссия</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Статус</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Дата</th>
          </tr>
        </thead>
        <tbody>
          {list.map(tx => (
            <tr key={tx.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
              <td className="px-4 py-3 text-muted-foreground">{tx.id}</td>
              <td className="px-4 py-3 font-medium">{tx.username}</td>
              <td className="px-4 py-3 capitalize">{tx.type}</td>
              <td className="px-4 py-3">{tx.currency}</td>
              <td className="px-4 py-3 text-right font-mono-num">{fmt(tx.amount)}</td>
              <td className="px-4 py-3 text-right font-mono-num text-muted-foreground">{fmt(tx.fee)}</td>
              <td className="px-4 py-3">{statusBadge(tx.status)}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(tx.created_at)}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">Нет транзакций</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── TabOrders ────────────────────────────────────────────────────────────────

function TabOrders() {
  const [list, setList] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { ok, data } = await api.admin.orders();
      if (ok) setList((data as { orders: Order[] }).orders ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary">
          <tr>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">ID</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Пользователь</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Пара</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Сторона</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Тип</th>
            <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Цена</th>
            <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Кол-во</th>
            <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Исполнено</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Статус</th>
            <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Дата</th>
          </tr>
        </thead>
        <tbody>
          {list.map(o => (
            <tr key={o.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
              <td className="px-4 py-3 text-muted-foreground">{o.id}</td>
              <td className="px-4 py-3 font-medium">{o.username}</td>
              <td className="px-4 py-3 font-mono text-xs">{o.symbol}</td>
              <td className={`px-4 py-3 font-medium uppercase text-xs ${o.side === 'buy' ? 'text-buy' : 'text-sell'}`}>{o.side}</td>
              <td className="px-4 py-3 capitalize text-xs">{o.type}</td>
              <td className="px-4 py-3 text-right font-mono-num">{o.price != null ? fmt(o.price) : '—'}</td>
              <td className="px-4 py-3 text-right font-mono-num">{fmt(o.qty)}</td>
              <td className="px-4 py-3 text-right font-mono-num">{fmt(o.filled_qty)}</td>
              <td className="px-4 py-3">{statusBadge(o.status)}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(o.created_at)}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">Нет ордеров</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── TabPairs ─────────────────────────────────────────────────────────────────

function TabPairs() {
  const [list, setList] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<number, Partial<Pair>>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const { ok, data } = await api.admin.pairs();
      if (ok) setList((data as { pairs: Pair[] }).pairs ?? []);
      setLoading(false);
    })();
  }, []);

  const setEdit = (id: number, field: keyof Pair, value: unknown) => {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSave = async (pair: Pair) => {
    const changes = editing[pair.id];
    if (!changes) return;
    setSaving(pair.id);
    const { ok } = await api.admin.updatePair(pair.id, changes as Record<string, unknown>);
    if (ok) {
      setMsg(`Пара ${pair.symbol} обновлена`);
      setList(prev => prev.map(p => p.id === pair.id ? { ...p, ...changes } : p));
      setEditing(prev => { const n = { ...prev }; delete n[pair.id]; return n; });
      setTimeout(() => setMsg(''), 3000);
    }
    setSaving(null);
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      {msg && (
        <div className="bg-buy/10 border border-buy/30 rounded-xl px-4 py-3 text-sm text-buy">{msg}</div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Символ</th>
              <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Активна</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Maker fee</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Taker fee</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Последняя цена</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Объём 24h</th>
              <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Сохранить</th>
            </tr>
          </thead>
          <tbody>
            {list.map(p => {
              const e = editing[p.id] ?? {};
              const isActive = e.is_active !== undefined ? e.is_active : p.is_active;
              const makerFee = e.maker_fee !== undefined ? e.maker_fee : p.maker_fee;
              const takerFee = e.taker_fee !== undefined ? e.taker_fee : p.taker_fee;
              const isDirty = !!editing[p.id];
              return (
                <tr key={p.id} className="border-t border-border hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium">{p.symbol}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setEdit(p.id, 'is_active', !isActive)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${isActive ? 'bg-buy' : 'bg-secondary border border-border'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      step="0.0001"
                      value={makerFee}
                      onChange={e => setEdit(p.id, 'maker_fee', parseFloat(e.target.value))}
                      className="w-24 bg-secondary border border-border rounded px-2 py-1 text-xs text-right font-mono-num"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      step="0.0001"
                      value={takerFee}
                      onChange={e => setEdit(p.id, 'taker_fee', parseFloat(e.target.value))}
                      className="w-24 bg-secondary border border-border rounded px-2 py-1 text-xs text-right font-mono-num"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num">{fmt(p.last_price)}</td>
                  <td className="px-4 py-3 text-right font-mono-num">{fmt(p.volume_24h, 0)}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleSave(p)}
                      disabled={!isDirty || saving === p.id}
                      className="px-3 py-1.5 bg-primary/20 text-primary hover:bg-primary/30 rounded text-xs font-medium disabled:opacity-30 transition-colors"
                    >
                      {saving === p.id ? <Icon name="Loader2" size={12} className="animate-spin" /> : 'Сохранить'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Нет торговых пар</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TabAudit ─────────────────────────────────────────────────────────────────

function TabAudit() {
  const [list, setList] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = async (p: number) => {
    setLoading(true);
    const { ok, data } = await api.admin.auditLog(p);
    if (ok) {
      const d = data as { entries: AuditEntry[]; has_more: boolean };
      setList(d.entries ?? []);
      setHasMore(d.has_more ?? false);
    }
    setLoading(false);
  };

  useEffect(() => { load(page); }, [page]);

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Дата</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Администратор</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Действие</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Сущность</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">ID</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {list.map(e => (
                  <tr key={e.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(e.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-primary">{e.admin}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
                    <td className="px-4 py-3 text-xs">{e.entity_type}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.entity_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.ip}</td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Лог аудита пуст</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-secondary text-muted-foreground hover:text-foreground rounded-lg text-sm disabled:opacity-40 transition-colors"
            >
              Назад
            </button>
            <span className="text-sm text-muted-foreground">Страница {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              className="px-4 py-2 bg-secondary text-muted-foreground hover:text-foreground rounded-lg text-sm disabled:opacity-40 transition-colors"
            >
              Вперёд
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── TabCircuit ───────────────────────────────────────────────────────────────

function TabCircuit() {
  const [status, setStatus] = useState<{ active_pairs: number; total_pairs: number; halted: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const { ok, data } = await api.admin.circuitBreakerStatus();
    if (ok) setStatus(data as { active_pairs: number; total_pairs: number; halted: boolean });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAction = async (action: 'halt' | 'resume') => {
    if (!reason.trim()) return;
    setActing(true);
    const { ok } = await api.admin.circuitBreaker(action, 'all', reason);
    if (ok) {
      setMsg(action === 'halt' ? 'Торговля остановлена. Записано в аудит-лог.' : 'Торговля возобновлена. Записано в аудит-лог.');
      setReason('');
      load();
      setTimeout(() => setMsg(''), 5000);
    }
    setActing(false);
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start gap-3 bg-sell/10 border border-sell/30 rounded-xl p-4">
        <Icon name="AlertTriangle" size={18} className="text-sell mt-0.5 shrink-0" />
        <p className="text-sm text-sell">
          Действие необратимо в краткосрочной перспективе. Запишется в аудит-лог. Убедитесь в правомерности операции.
        </p>
      </div>

      {msg && (
        <div className="bg-primary/10 border border-primary/30 rounded-xl px-4 py-3 text-sm text-primary">{msg}</div>
      )}

      {status && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <p className="text-2xl font-bold">{status.active_pairs}</p>
            <p className="text-xs text-muted-foreground mt-1">Активных пар</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <p className="text-2xl font-bold">{status.total_pairs}</p>
            <p className="text-xs text-muted-foreground mt-1">Всего пар</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <p className={`text-lg font-bold ${status.halted ? 'text-sell' : 'text-buy'}`}>
              {status.halted ? 'ОСТАНОВЛЕНО' : 'РАБОТАЕТ'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Статус торговли</p>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <p className="text-sm font-medium">Причина (обязательно)</p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Укажите причину действия..."
          rows={3}
          className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground resize-none"
        />
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleAction('halt')}
            disabled={acting || !reason.trim()}
            className="flex items-center justify-center gap-2 py-4 bg-sell/20 text-sell hover:bg-sell/30 border border-sell/30 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors"
          >
            <Icon name="OctagonX" size={18} />
            HALT TRADING
          </button>
          <button
            onClick={() => handleAction('resume')}
            disabled={acting || !reason.trim()}
            className="flex items-center justify-center gap-2 py-4 bg-buy/20 text-buy hover:bg-buy/30 border border-buy/30 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors"
          >
            <Icon name="Play" size={18} />
            RESUME TRADING
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin ───────────────────────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!hasRole(user, 'support')) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user && hasRole(user, 'support')) {
      api.admin.stats().then(({ ok, data }) => {
        if (ok) setStats(data as Stats);
      });
    }
  }, [user]);

  if (!user || !hasRole(user, 'support')) return null;

  const role = user.role as string;
  const tabs = getAvailableTabs(role);

  if (!tabs.includes(activeTab)) {
    const first = tabs[0];
    if (first && first !== activeTab) setActiveTab(first);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-screen-xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold">Панель администратора</h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[role] ?? 'text-muted-foreground bg-secondary'}`}>
                {ROLE_LABELS[role] ?? role}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{user.username} · {user.email}</p>
          </div>
          <Icon name="ShieldCheck" size={32} className="text-primary opacity-60" />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 mb-6 bg-secondary rounded-xl p-1">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={TAB_ICONS[tab]} size={15} />
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'stats'     && <TabStats stats={stats} role={role} />}
          {activeTab === 'users'     && <TabUsers role={role} />}
          {activeTab === 'kyc'       && <TabKyc />}
          {activeTab === 'withdrawals' && <TabWithdrawals role={role} />}
          {activeTab === 'transactions' && <TabTransactions />}
          {activeTab === 'orders'    && <TabOrders />}
          {activeTab === 'pairs'     && <TabPairs />}
          {activeTab === 'audit'     && <TabAudit />}
          {activeTab === 'circuit'   && <TabCircuit />}
          {activeTab === 'hot-pool'  && <TabHotPool />}
          {activeTab === 'sweep'     && <TabSweepLog />}
          {activeTab === 'aml'       && <TabAml />}
          {activeTab === 'vault'     && <TabVaultTransfer />}
        </div>
      </div>
    </div>
  );
}

// ─── TabHotPool ───────────────────────────────────────────────────────────────
function TabHotPool() {
  const [data, setData] = useState<{hot_pools: HotPool[]; cold_vaults: ColdVault[]} | null>(null);
  const [form, setForm] = useState({ network: '', currency: '', address: '', target_pct: '15', note: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { ok, data: d } = await api.hotWallet.pools();
    if (ok) setData(d as typeof data);
  };

  const save = async () => {
    const { ok, data: d } = await api.hotWallet.upsertPool({
      ...form, target_pct: parseFloat(form.target_pct),
    });
    if (ok) { setMsg('Сохранено'); load(); }
    else setMsg((d as {error:string}).error || 'Ошибка');
  };

  return (
    <div className="space-y-6">
      {/* Hot Pools */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Icon name="Flame" size={16} className="text-orange-400" /> Hot Pool кошельки
          </h3>
          <button onClick={load} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
        </div>
        {!data ? (
          <div className="py-10 text-center"><Icon name="Loader2" size={20} className="animate-spin text-primary mx-auto" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
                <th className="px-4 py-3 text-left">Сеть</th>
                <th className="px-4 py-3 text-left">Валюта</th>
                <th className="px-4 py-3 text-left">Адрес</th>
                <th className="px-4 py-3 text-right">Баланс On-Chain</th>
                <th className="px-4 py-3 text-right">Target %</th>
                <th className="px-4 py-3 text-right">Target USDT</th>
                <th className="px-4 py-3 text-right">Pending Вывод</th>
                <th className="px-4 py-3 text-center">Статус</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data.hot_pools.map(p => (
                  <tr key={p.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium">{p.network}</td>
                    <td className="px-4 py-3">{p.currency}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {p.address.slice(0,10)}...{p.address.slice(-6)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(p.balance_onchain, 4)}</td>
                    <td className="px-4 py-3 text-right">{p.target_pct}%</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(p.target_amount, 2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sell">{fmt(p.pending_withdrawals, 4)}</td>
                    <td className="px-4 py-3 text-center">
                      {p.is_low_balance
                        ? <span className="text-xs bg-sell/20 text-sell px-2 py-1 rounded-full">Низкий</span>
                        : <span className="text-xs bg-buy/20 text-buy px-2 py-1 rounded-full">OK</span>}
                    </td>
                  </tr>
                ))}
                {data.hot_pools.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Нет настроенных Hot Pool</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cold Vaults */}
      {data && data.cold_vaults.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="font-semibold flex items-center gap-2">
              <Icon name="Lock" size={16} className="text-primary" /> Cold Vault (Мультиподпись)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
                <th className="px-4 py-3 text-left">Сеть</th>
                <th className="px-4 py-3 text-left">Адрес</th>
                <th className="px-4 py-3 text-center">Мультиподпись</th>
                <th className="px-4 py-3 text-right">Баланс</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data.cold_vaults.map(v => (
                  <tr key={v.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium">{v.network} / {v.currency}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.address.slice(0,14)}...{v.address.slice(-6)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-purple-400/20 text-purple-400 px-2 py-1 rounded-full">{v.multisig}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(v.balance_onchain, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Добавить/обновить Hot Pool */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h4 className="font-semibold text-sm">Настроить Hot Pool адрес</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(['network','currency','address'] as const).map(f => (
            <div key={f} className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase">{f}</label>
              <input value={form[f]} onChange={e => setForm(p => ({...p, [f]: e.target.value}))}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase">Target %</label>
            <input type="number" value={form.target_pct} onChange={e => setForm(p => ({...p, target_pct: e.target.value}))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div className="space-y-1 col-span-2">
            <label className="text-xs text-muted-foreground uppercase">Примечание</label>
            <input value={form.note} onChange={e => setForm(p => ({...p, note: e.target.value}))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
        </div>
        {msg && <p className={`text-sm ${msg === 'Сохранено' ? 'text-buy' : 'text-sell'}`}>{msg}</p>}
        <button onClick={save}
          className="bg-primary text-background px-6 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90">
          Сохранить
        </button>
      </div>
    </div>
  );
}

// ─── TabSweepLog ──────────────────────────────────────────────────────────────
function TabSweepLog() {
  const [sweeps, setSweeps] = useState<SweepEntry[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => { load(); }, [page]);

  const load = async () => {
    setLoading(true);
    const { ok, data } = await api.hotWallet.sweepLog(page);
    if (ok) setSweeps((data as {sweeps: SweepEntry[]}).sweeps ?? []);
    setLoading(false);
  };

  const STATUS_COLOR: Record<string, string> = {
    completed: 'text-buy bg-buy/10',
    pending:   'text-yellow-400 bg-yellow-400/10',
    failed:    'text-sell bg-sell/10',
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Icon name="ArrowRightLeft" size={16} className="text-primary" />
          Sweep: Deposit Address → Hot Pool
        </h3>
        <button onClick={load} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
      </div>
      {loading ? (
        <div className="py-10 text-center"><Icon name="Loader2" size={20} className="animate-spin text-primary mx-auto" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">Пользователь</th>
              <th className="px-4 py-3 text-left">Сеть</th>
              <th className="px-4 py-3 text-left">От</th>
              <th className="px-4 py-3 text-left">Куда (Hot Pool)</th>
              <th className="px-4 py-3 text-right">Сумма</th>
              <th className="px-4 py-3 text-right">Комиссия</th>
              <th className="px-4 py-3 text-center">Статус</th>
              <th className="px-4 py-3 text-left">TX Hash</th>
              <th className="px-4 py-3 text-left">Дата</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {sweeps.map(s => (
                <tr key={s.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-2.5 text-muted-foreground">#{s.id}</td>
                  <td className="px-4 py-2.5 font-medium">{s.username}</td>
                  <td className="px-4 py-2.5">{s.network} · {s.currency}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.from_address.slice(0,10)}...</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-primary">{s.to_address.slice(0,10)}...</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmt(s.amount, 6)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground text-xs">{fmt(s.fee, 6)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[s.status] ?? 'text-muted-foreground bg-secondary'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {s.tx_hash ? s.tx_hash.slice(0,10) + '...' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(s.created_at)}</td>
                </tr>
              ))}
              {sweeps.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Нет записей</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-6 py-3 border-t border-border flex justify-between items-center">
        <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
          className="px-3 py-1.5 bg-secondary rounded-lg text-sm hover:bg-secondary/70 disabled:opacity-40">
          <Icon name="ChevronLeft" size={15} />
        </button>
        <span className="text-xs text-muted-foreground">Страница {page}</span>
        <button onClick={() => setPage(p => p+1)} disabled={sweeps.length < 100}
          className="px-3 py-1.5 bg-secondary rounded-lg text-sm hover:bg-secondary/70 disabled:opacity-40">
          <Icon name="ChevronRight" size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── TabAml ───────────────────────────────────────────────────────────────────
function TabAml() {
  const [dashboard, setDashboard] = useState<AmlDashboard | null>(null);
  const [flags, setFlags] = useState<AddressFlag[]>([]);
  const [flagFilter, setFlagFilter] = useState('blacklist');
  const [form, setForm] = useState({ address: '', network: 'ETH', flag_type: 'blacklist', risk_score: '80', reason: '', source: 'manual' });
  const [msg, setMsg] = useState('');
  const [wdId, setWdId] = useState('');
  const [wdAml, setWdAml] = useState('blocked');
  const [wdNote, setWdNote] = useState('');

  useEffect(() => { loadDashboard(); loadFlags(); }, []);
  useEffect(() => { loadFlags(); }, [flagFilter]);

  const loadDashboard = async () => {
    const { ok, data } = await api.compliance.amlDashboard();
    if (ok) setDashboard(data as AmlDashboard);
  };
  const loadFlags = async () => {
    const { ok, data } = await api.compliance.addressFlags(flagFilter);
    if (ok) setFlags((data as {flags: AddressFlag[]}).flags ?? []);
  };
  const flagAddress = async () => {
    const { ok, data } = await api.compliance.flagAddress({...form, risk_score: parseFloat(form.risk_score)});
    if (ok) { setMsg('Флаг установлен'); loadFlags(); loadDashboard(); }
    else setMsg((data as {error:string}).error || 'Ошибка');
  };
  const reviewWd = async () => {
    if (!wdId) return;
    const { ok } = await api.compliance.reviewWithdrawal(parseInt(wdId), wdAml, wdNote);
    if (ok) { setMsg(`Вывод #${wdId} → ${wdAml}`); setWdId(''); setWdNote(''); }
  };

  const DASH_CARDS = dashboard ? [
    { label: 'Blacklist адресов', value: dashboard.blacklisted_addresses, color: 'text-sell', icon: 'Ban' },
    { label: 'Watchlist',         value: dashboard.watchlisted_addresses, color: 'text-yellow-400', icon: 'Eye' },
    { label: 'Блокир. выводов',   value: dashboard.blocked_withdrawals,   color: 'text-sell', icon: 'Lock' },
    { label: 'Flagged выводов',   value: dashboard.flagged_withdrawals,   color: 'text-orange-400', icon: 'Flag' },
    { label: 'Ожид. AML-проверки',value: dashboard.pending_aml_review,   color: 'text-yellow-400', icon: 'Clock' },
    { label: 'Заморожено аккаунтов', value: dashboard.frozen_users,      color: 'text-sell', icon: 'UserX' },
    { label: 'Whitelist на проверке', value: dashboard.pending_whitelist, color: 'text-primary', icon: 'CheckSquare' },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Anti-tipping-off banner */}
      <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-5 py-4 flex items-start gap-3">
        <Icon name="AlertTriangle" size={18} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-yellow-400">Anti-Tipping-Off Policy</p>
          <p className="text-foreground/70 mt-1">Информация о AML-расследованиях конфиденциальна. Не сообщайте пользователям причины блокировки, связанные с подозрением в отмывании.</p>
        </div>
      </div>

      {/* Dashboard карточки */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {DASH_CARDS.map(c => (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon name={c.icon} size={14} className={c.color} />
                <span className="text-xs text-muted-foreground">{c.label}</span>
              </div>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Последние flagged выводы */}
      {dashboard && dashboard.recent_flagged.length > 0 && (
        <div className="bg-card border border-sell/30 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h4 className="font-semibold text-sell flex items-center gap-2"><Icon name="AlertOctagon" size={15} /> Последние риск-транзакции</h4>
          </div>
          <div className="divide-y divide-border">
            {dashboard.recent_flagged.map(w => (
              <div key={w.id} className="px-6 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{w.username}</span>
                  <span className="text-muted-foreground ml-2">{w.currency} · {w.to_address}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold">{fmt(w.amount, 4)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${w.aml_status === 'blocked' ? 'bg-sell/20 text-sell' : 'bg-orange-400/20 text-orange-400'}`}>
                    {w.aml_status} · risk {w.risk_score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Установить флаг на адрес */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h4 className="font-semibold flex items-center gap-2"><Icon name="Ban" size={15} className="text-sell" /> Установить AML-флаг на адрес</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1 col-span-2">
            <label className="text-xs text-muted-foreground uppercase">Адрес</label>
            <input value={form.address} onChange={e => setForm(p=>({...p, address: e.target.value}))}
              placeholder="0x... или T..." className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase">Сеть</label>
            <select value={form.network} onChange={e => setForm(p=>({...p, network: e.target.value}))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary">
              {['ETH','TRON','BTC','BSC','SOL'].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase">Тип флага</label>
            <select value={form.flag_type} onChange={e => setForm(p=>({...p, flag_type: e.target.value}))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary">
              <option value="blacklist">Blacklist</option>
              <option value="watchlist">Watchlist</option>
              <option value="whitelist">Whitelist</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase">Risk Score (0-100)</label>
            <input type="number" min={0} max={100} value={form.risk_score}
              onChange={e => setForm(p=>({...p, risk_score: e.target.value}))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase">Источник</label>
            <select value={form.source} onChange={e => setForm(p=>({...p, source: e.target.value}))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary">
              {['manual','chainalysis','elliptic','ofac','fatf','rosfinmonitoring'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-3">
            <label className="text-xs text-muted-foreground uppercase">Причина (конфиденциально)</label>
            <input value={form.reason} onChange={e => setForm(p=>({...p, reason: e.target.value}))}
              placeholder="Связь с миксером / санкционным адресом / etc."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.includes('Ошибка') ? 'text-sell' : 'text-buy'}`}>{msg}</p>}
        <button onClick={flagAddress}
          className="bg-sell text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90">
          Установить флаг
        </button>
      </div>

      {/* AML Review вывода */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h4 className="font-semibold flex items-center gap-2"><Icon name="ScanSearch" size={15} className="text-primary" /> AML-проверка вывода</h4>
        <p className="text-xs text-muted-foreground">Finance не может подписать вывод со статусом <span className="text-sell font-medium">blocked</span>. Это принудительный SoD-барьер.</p>
        <div className="flex gap-3 flex-wrap">
          <input value={wdId} onChange={e => setWdId(e.target.value)} placeholder="ID вывода"
            className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary w-32" />
          <select value={wdAml} onChange={e => setWdAml(e.target.value)}
            className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary">
            <option value="clear">Clear</option>
            <option value="flagged">Flagged</option>
            <option value="blocked">Blocked</option>
          </select>
          <input value={wdNote} onChange={e => setWdNote(e.target.value)} placeholder="Примечание (конфиденциально)"
            className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary flex-1 min-w-48" />
          <button onClick={reviewWd}
            className="bg-primary text-background px-5 py-2 rounded-lg text-sm font-semibold hover:opacity-90">
            Применить
          </button>
        </div>
      </div>

      {/* Список флагов */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <h4 className="font-semibold">Список AML флагов</h4>
          <div className="flex gap-1 ml-auto">
            {['blacklist','watchlist','whitelist'].map(f => (
              <button key={f} onClick={() => setFlagFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${flagFilter === f ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
              <th className="px-4 py-3 text-left">Адрес</th>
              <th className="px-4 py-3 text-left">Сеть</th>
              <th className="px-4 py-3 text-right">Risk Score</th>
              <th className="px-4 py-3 text-left">Источник</th>
              <th className="px-4 py-3 text-left">Дата</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {flags.map(f => (
                <tr key={f.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-2.5 font-mono text-xs">{f.address.slice(0,16)}...{f.address.slice(-6)}</td>
                  <td className="px-4 py-2.5">{f.network}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`font-mono font-semibold ${f.risk_score >= 70 ? 'text-sell' : f.risk_score >= 40 ? 'text-yellow-400' : 'text-buy'}`}>
                      {f.risk_score}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{f.source}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(f.created_at)}</td>
                </tr>
              ))}
              {flags.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Нет записей</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TabVaultTransfer ─────────────────────────────────────────────────────────
function TabVaultTransfer() {
  const [requests, setRequests] = useState<VaultRequest[]>([]);
  const [form, setForm] = useState({ network: 'ETH', currency: 'ETH', amount: '', note: '' });
  const [msg, setMsg] = useState('');
  const { user } = useAuth();
  const role = (user as unknown as {role: string})?.role ?? 'user';

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { ok, data } = await api.hotWallet.vaultTransfers();
    if (ok) setRequests((data as {requests: VaultRequest[]}).requests ?? []);
  };

  const createRequest = async () => {
    const { ok, data } = await api.hotWallet.vaultTransferRequest({
      ...form, amount: parseFloat(form.amount),
    });
    if (ok) { setMsg((data as {message: string}).message || 'Запрос создан'); load(); }
    else setMsg((data as {error: string}).error || 'Ошибка');
  };

  const sign = async (request_id: number) => {
    const { ok } = await api.hotWallet.signVaultTransfer(request_id, 'approved');
    if (ok) { setMsg('Подпись добавлена'); load(); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-5 py-4 flex gap-3">
        <Icon name="ShieldAlert" size={18} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-yellow-400">Мультиподпись Cold Vault → Hot Pool</p>
          <p className="text-foreground/70 mt-1">Требуется {role === 'superadmin' ? '2' : '...'} подписи: Finance + Superadmin или Compliance. Все операции записываются в Audit Log.</p>
        </div>
      </div>

      {/* Создать запрос (только Finance) */}
      {(role === 'finance' || role === 'superadmin') && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h4 className="font-semibold">Запрос на подпитку Hot Pool из Cold Vault</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['network','currency'] as const).map(f => (
              <div key={f} className="space-y-1">
                <label className="text-xs text-muted-foreground uppercase">{f}</label>
                <input value={form[f]} onChange={e => setForm(p=>({...p, [f]: e.target.value}))}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase">Сумма</label>
              <input type="number" value={form.amount} onChange={e => setForm(p=>({...p, amount: e.target.value}))}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase">Причина</label>
              <input value={form.note} onChange={e => setForm(p=>({...p, note: e.target.value}))}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          {msg && <p className={`text-sm ${msg.includes('Ошибка') ? 'text-sell' : 'text-buy'}`}>{msg}</p>}
          <button onClick={createRequest}
            className="bg-primary text-background px-6 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90">
            Создать запрос
          </button>
        </div>
      )}

      {/* Список запросов */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h4 className="font-semibold flex items-center gap-2"><Icon name="Database" size={15} className="text-primary" /> История переводов</h4>
          <button onClick={load} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">Сеть</th>
              <th className="px-4 py-3 text-right">Сумма</th>
              <th className="px-4 py-3 text-center">Подписи</th>
              <th className="px-4 py-3 text-center">Статус</th>
              <th className="px-4 py-3 text-left">Инициатор</th>
              <th className="px-4 py-3 text-left">Дата</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {requests.map(r => (
                <tr key={r.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 text-muted-foreground">#{r.id}</td>
                  <td className="px-4 py-3">{r.network} / {r.currency}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(r.amount, 4)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className={`w-2.5 h-2.5 rounded-full ${r.sigs.finance ? 'bg-buy' : 'bg-muted-foreground/30'}`} title="Finance" />
                      <span className={`w-2.5 h-2.5 rounded-full ${r.sigs.compliance ? 'bg-blue-400' : 'bg-muted-foreground/30'}`} title="Compliance" />
                      <span className={`w-2.5 h-2.5 rounded-full ${r.sigs.superadmin ? 'bg-purple-400' : 'bg-muted-foreground/30'}`} title="Superadmin" />
                      <span className="text-xs text-muted-foreground ml-1">{r.sigs.collected}/{r.sigs.required}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.status === 'approved' ? 'bg-buy/20 text-buy' :
                      r.status === 'completed' ? 'bg-primary/20 text-primary' :
                      r.status === 'rejected' ? 'bg-sell/20 text-sell' :
                      'bg-yellow-400/20 text-yellow-400'
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.requested_by}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' && (role === 'superadmin' || role === 'compliance') && !r.sigs[role as keyof typeof r.sigs] && (
                      <button onClick={() => sign(r.id)}
                        className="text-xs bg-primary/20 text-primary px-3 py-1.5 rounded-lg hover:bg-primary/30 font-medium">
                        Подписать
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Нет запросов</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}