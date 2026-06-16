import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import Icon from '@/components/ui/icon';

interface Stats {
  total_users: number;
  pending_deposits: number;
  total_deposited: number;
  total_balance: number;
}

interface AdminUser {
  id: number;
  email: string;
  username: string;
  is_admin: boolean;
  is_verified: boolean;
  kyc_status: string;
  created_at: string;
  last_login: string | null;
  total_usdt: number;
}

interface Deposit {
  id: number;
  username: string;
  email: string;
  network: string;
  address: string;
  tx_hash: string | null;
  amount: number | null;
  currency: string;
  status: string;
  created_at: string;
}

interface AdminTx {
  id: number;
  username: string;
  type: string;
  currency: string;
  amount: number;
  fee: number;
  status: string;
  note: string;
  created_at: string;
}

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'stats' | 'users' | 'deposits' | 'txs'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [txs, setTxs] = useState<AdminTx[]>([]);
  const [confirmModal, setConfirmModal] = useState<Deposit | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirmTxHash, setConfirmTxHash] = useState('');
  const [balanceModal, setBalanceModal] = useState<AdminUser | null>(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceCurrency, setBalanceCurrency] = useState('USDT');
  const [balanceOp, setBalanceOp] = useState<'add' | 'set'>('add');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (!user.is_admin) { navigate('/dashboard'); return; }
    loadStats();
  }, [user]);

  useEffect(() => {
    if (tab === 'users' && users.length === 0) loadUsers();
    if (tab === 'deposits') loadDeposits();
    if (tab === 'txs' && txs.length === 0) loadTxs();
  }, [tab]);

  const loadStats = async () => {
    const { ok, data } = await api.admin.stats();
    if (ok) setStats(data as Stats);
  };

  const loadUsers = async () => {
    const { ok, data } = await api.admin.users();
    if (ok) setUsers((data as { users: AdminUser[] }).users);
  };

  const loadDeposits = async () => {
    const { ok, data } = await api.deposits.all();
    if (ok) setDeposits((data as { deposits: Deposit[] }).deposits);
  };

  const loadTxs = async () => {
    const { ok, data } = await api.admin.transactions();
    if (ok) setTxs((data as { transactions: AdminTx[] }).transactions);
  };

  const confirmDeposit = async () => {
    if (!confirmModal) return;
    const { ok } = await api.deposits.confirm(confirmModal.id, parseFloat(confirmAmount), confirmTxHash);
    if (ok) {
      setMsg('Депозит подтверждён');
      setConfirmModal(null);
      loadDeposits();
      loadStats();
    }
  };

  const saveBalance = async () => {
    if (!balanceModal) return;
    const { ok } = await api.admin.setBalance(balanceModal.id, balanceCurrency, parseFloat(balanceAmount), balanceOp);
    if (ok) {
      setMsg('Баланс обновлён');
      setBalanceModal(null);
      loadUsers();
    }
  };

  const toggleAdmin = async (uid: number) => {
    await api.admin.toggleAdmin(uid);
    loadUsers();
  };

  if (!user?.is_admin) return null;

  const TABS = [
    { id: 'stats', label: 'Статистика', icon: 'BarChart2' },
    { id: 'users', label: 'Пользователи', icon: 'Users' },
    { id: 'deposits', label: 'Депозиты', icon: 'ArrowDownToLine' },
    { id: 'txs', label: 'Транзакции', icon: 'History' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <Icon name="Hexagon" size={18} className="text-background" />
          </div>
          <span className="font-display text-lg font-bold">NEXUS</span>
        </Link>
        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-medium">ADMIN</span>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
            <Icon name="User" size={15} />
            Кабинет
          </Link>
        </div>
      </header>

      {msg && (
        <div className="mx-4 mt-4 bg-buy/15 border border-buy/30 text-buy rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          {msg}
          <button onClick={() => setMsg('')}><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        {tab === 'stats' && stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Пользователей', value: stats.total_users, icon: 'Users', color: 'text-primary' },
              { label: 'Ждут подтверждения', value: stats.pending_deposits, icon: 'Clock', color: 'text-yellow-400' },
              { label: 'Всего внесено USDT', value: stats.total_deposited.toFixed(2), icon: 'TrendingUp', color: 'text-buy' },
              { label: 'Баланс платформы USDT', value: stats.total_balance.toFixed(2), icon: 'DollarSign', color: 'text-cyan-400' },
            ].map((s, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</span>
                  <Icon name={s.icon} size={18} className={s.color} />
                </div>
                <p className="text-2xl font-bold font-mono-num">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Users */}
        {tab === 'users' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Пользователи ({users.length})</h3>
              <button onClick={loadUsers} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={16} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Username</th>
                    <th className="text-left px-4 py-3 font-medium">Email</th>
                    <th className="text-right px-4 py-3 font-medium">USDT</th>
                    <th className="text-center px-4 py-3 font-medium">Admin</th>
                    <th className="text-left px-4 py-3 font-medium">Регистрация</th>
                    <th className="text-center px-4 py-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">#{u.id}</td>
                      <td className="px-4 py-3 font-medium">@{u.username}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{u.email}</td>
                      <td className="px-4 py-3 text-right font-mono-num">{u.total_usdt.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleAdmin(u.id)} className={`text-xs px-2 py-0.5 rounded-full transition-colors ${u.is_admin ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:bg-primary/10'}`}>
                          {u.is_admin ? 'Да' : 'Нет'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString('ru')}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => { setBalanceModal(u); setBalanceAmount(''); }} className="text-xs text-primary hover:underline">
                          Баланс
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Deposits */}
        {tab === 'deposits' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Депозиты</h3>
              <button onClick={loadDeposits} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={16} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Пользователь</th>
                    <th className="text-left px-4 py-3 font-medium">Сеть</th>
                    <th className="text-left px-4 py-3 font-medium">Адрес</th>
                    <th className="text-right px-4 py-3 font-medium">Сумма</th>
                    <th className="text-center px-4 py-3 font-medium">Статус</th>
                    <th className="text-left px-4 py-3 font-medium">Дата</th>
                    <th className="text-center px-4 py-3 font-medium">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deposits.map(d => (
                    <tr key={d.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">#{d.id}</td>
                      <td className="px-4 py-3 font-medium">@{d.username}</td>
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full bg-secondary`}>{d.network}</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono max-w-[140px] truncate">{d.address}</td>
                      <td className="px-4 py-3 text-right font-mono-num">{d.amount ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${d.status === 'confirmed' ? 'bg-buy/20 text-buy' : 'bg-yellow-400/15 text-yellow-400'}`}>
                          {d.status === 'confirmed' ? 'Подтверждён' : 'Ожидает'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString('ru')}</td>
                      <td className="px-4 py-3 text-center">
                        {d.status === 'pending' && (
                          <button onClick={() => { setConfirmModal(d); setConfirmAmount(''); setConfirmTxHash(''); }} className="text-xs text-buy hover:underline">
                            Подтвердить
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transactions */}
        {tab === 'txs' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Транзакции</h3>
              <button onClick={loadTxs} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={16} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Пользователь</th>
                    <th className="text-left px-4 py-3 font-medium">Тип</th>
                    <th className="text-right px-4 py-3 font-medium">Сумма</th>
                    <th className="text-left px-4 py-3 font-medium">Примечание</th>
                    <th className="text-left px-4 py-3 font-medium">Дата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {txs.map(t => (
                    <tr key={t.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">#{t.id}</td>
                      <td className="px-4 py-3">@{t.username}</td>
                      <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-secondary">{t.type}</span></td>
                      <td className="px-4 py-3 text-right font-mono-num">{t.amount} {t.currency}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{t.note}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString('ru')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Confirm deposit modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-lg">Подтвердить депозит #{confirmModal.id}</h3>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Пользователь: <span className="text-foreground">@{confirmModal.username}</span></p>
              <p>Сеть: <span className="text-foreground">{confirmModal.network}</span></p>
              <p>Адрес: <span className="text-foreground font-mono text-xs">{confirmModal.address}</span></p>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Сумма USDT</label>
              <input type="number" value={confirmAmount} onChange={e => setConfirmAmount(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary" placeholder="100.00" />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">TX Hash (необязательно)</label>
              <input type="text" value={confirmTxHash} onChange={e => setConfirmTxHash(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary font-mono" placeholder="0x..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)} className="flex-1 py-2.5 rounded-lg bg-secondary text-sm font-medium hover:bg-muted transition-colors">Отмена</button>
              <button onClick={confirmDeposit} disabled={!confirmAmount} className="flex-1 py-2.5 rounded-lg bg-buy text-background text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">Подтвердить</button>
            </div>
          </div>
        </div>
      )}

      {/* Balance modal */}
      {balanceModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-lg">Изменить баланс @{balanceModal.username}</h3>
            <div className="grid grid-cols-2 gap-2">
              {['USDT', 'BTC', 'ETH', 'BNB', 'SOL'].map(c => (
                <button key={c} onClick={() => setBalanceCurrency(c)} className={`py-2 rounded-lg text-sm font-medium transition-colors ${balanceCurrency === c ? 'bg-primary text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>{c}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['add', 'set'] as const).map(op => (
                <button key={op} onClick={() => setBalanceOp(op)} className={`py-2 rounded-lg text-sm font-medium transition-colors ${balanceOp === op ? 'bg-secondary text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}>
                  {op === 'add' ? 'Добавить' : 'Установить'}
                </button>
              ))}
            </div>
            <input type="number" value={balanceAmount} onChange={e => setBalanceAmount(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary" placeholder="Сумма" />
            <div className="flex gap-3">
              <button onClick={() => setBalanceModal(null)} className="flex-1 py-2.5 rounded-lg bg-secondary text-sm font-medium">Отмена</button>
              <button onClick={saveBalance} disabled={!balanceAmount} className="flex-1 py-2.5 rounded-lg bg-primary text-background text-sm font-semibold disabled:opacity-50">Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
