import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import Icon from '@/components/ui/icon';

interface Transaction {
  id: number;
  type: string;
  currency: string;
  amount: number;
  fee: number;
  status: string;
  note: string;
  created_at: string;
}

interface Wallet {
  network: string;
  address: string;
}

const NETWORK_INFO: Record<string, { color: string; icon: string; label: string }> = {
  TRON: { color: 'text-red-400', icon: 'Zap', label: 'TRON (TRC-20)' },
  ETH:  { color: 'text-blue-400', icon: 'Layers', label: 'Ethereum (ERC-20)' },
  TON:  { color: 'text-cyan-400', icon: 'Diamond', label: 'TON Network' },
};

const TX_LABELS: Record<string, string> = {
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  trade: 'Сделка',
  admin_adjustment: 'Корректировка',
};

export default function Dashboard() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'deposit' | 'history' | 'security'>('overview');
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [depNetwork, setDepNetwork] = useState('TRON');
  const [depAddress, setDepAddress] = useState('');
  const [depLoading, setDepLoading] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    refresh();
  }, []);

  useEffect(() => {
    if (tab === 'deposit' && wallets.length === 0) loadWallets();
    if (tab === 'history') loadTxs();
  }, [tab]);

  const loadWallets = async () => {
    const { ok, data } = await api.wallets.list();
    if (ok) setWallets((data as { wallets: Wallet[] }).wallets);
  };

  const loadTxs = async () => {
    const { ok, data } = await api.transactions.list();
    if (ok) setTxs((data as { transactions: Transaction[] }).transactions);
  };

  const createDeposit = async () => {
    setDepLoading(true);
    const { ok, data } = await api.deposits.create(depNetwork);
    setDepLoading(false);
    if (ok) {
      const d = data as { address: string };
      setDepAddress(d.address);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  if (!user) return null;

  const totalUSDT = user.balances.find(b => b.currency === 'USDT')?.available ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <Icon name="Hexagon" size={18} className="text-background" />
          </div>
          <span className="font-display text-lg font-bold">NEXUS</span>
        </Link>
        <span className="text-muted-foreground text-sm hidden sm:block">Личный кабинет</span>
        <div className="ml-auto flex items-center gap-3">
          {user.is_admin && (
            <Link to="/admin" className="text-xs text-primary border border-primary/30 rounded px-2.5 py-1 hover:bg-primary/10 transition-colors">
              Админ-панель
            </Link>
          )}
          <span className="text-sm text-muted-foreground hidden sm:block">@{user.username}</span>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Icon name="LogOut" size={16} />
            <span className="hidden sm:block">Выйти</span>
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Balance card */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Общий баланс</p>
              <p className="text-3xl font-bold font-mono-num mt-1">{totalUSDT.toLocaleString('en-US', { minimumFractionDigits: 2 })} <span className="text-muted-foreground text-lg">USDT</span></p>
            </div>
            <button onClick={() => setTab('deposit')} className="bg-primary text-background px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity">
              <Icon name="Plus" size={16} />
              Пополнить
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
            {user.balances.map(b => (
              <div key={b.currency} className="bg-secondary rounded-lg px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.currency}</p>
                <p className="font-mono-num font-semibold text-sm mt-0.5">{b.available.toLocaleString('en-US', { maximumFractionDigits: 6 })}</p>
                {b.locked > 0 && <p className="text-[10px] text-muted-foreground mt-0.5">В ордерах: {b.locked}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
          {[
            { id: 'overview', label: 'Обзор', icon: 'LayoutDashboard' },
            { id: 'deposit', label: 'Пополнение', icon: 'ArrowDownToLine' },
            { id: 'history', label: 'История', icon: 'ClockHistory' },
            { id: 'security', label: 'Безопасность', icon: 'Shield' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon name={t.icon} size={15} />
              <span className="hidden sm:block">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <h3 className="font-semibold flex items-center gap-2"><Icon name="User" size={16} className="text-primary" /> Профиль</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span>@{user.username}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="truncate max-w-[180px]">{user.email}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">KYC</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${user.kyc_status === 'verified' ? 'bg-buy/20 text-buy' : 'bg-secondary text-muted-foreground'}`}>
                    {user.kyc_status === 'verified' ? 'Подтверждён' : 'Не пройден'}
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Регистрация</span><span>{new Date(user.created_at).toLocaleDateString('ru')}</span></div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <h3 className="font-semibold flex items-center gap-2"><Icon name="TrendingUp" size={16} className="text-primary" /> Быстрые действия</h3>
              <div className="space-y-2">
                <button onClick={() => setTab('deposit')} className="w-full flex items-center gap-3 px-4 py-3 bg-secondary rounded-lg hover:bg-muted transition-colors text-sm text-left">
                  <Icon name="ArrowDownToLine" size={18} className="text-buy" />
                  <div><p className="font-medium">Пополнить баланс</p><p className="text-xs text-muted-foreground">TRON, ETH, TON</p></div>
                </button>
                <Link to="/" className="w-full flex items-center gap-3 px-4 py-3 bg-secondary rounded-lg hover:bg-muted transition-colors text-sm">
                  <Icon name="CandlestickChart" size={18} className="text-primary" />
                  <div><p className="font-medium">Торговый терминал</p><p className="text-xs text-muted-foreground">Спот и маржинальная торговля</p></div>
                </Link>
                <button onClick={() => setTab('history')} className="w-full flex items-center gap-3 px-4 py-3 bg-secondary rounded-lg hover:bg-muted transition-colors text-sm text-left">
                  <Icon name="History" size={18} className="text-muted-foreground" />
                  <div><p className="font-medium">История транзакций</p><p className="text-xs text-muted-foreground">Все операции по счёту</p></div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Deposit */}
        {tab === 'deposit' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="font-semibold text-lg">Пополнение баланса</h3>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Выберите сеть</label>
              <div className="grid grid-cols-3 gap-2">
                {['TRON', 'ETH', 'TON'].map(net => (
                  <button
                    key={net}
                    onClick={() => { setDepNetwork(net); setDepAddress(''); }}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${depNetwork === net ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-border/80'}`}
                  >
                    <Icon name={NETWORK_INFO[net].icon} size={24} className={NETWORK_INFO[net].color} />
                    <span className="text-sm font-medium">{net}</span>
                    <span className="text-[10px] text-muted-foreground">{NETWORK_INFO[net].label.split('(')[1]?.replace(')', '') || ''}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-secondary/50 border border-border rounded-lg p-4 space-y-2 text-sm">
              <div className="flex items-start gap-2 text-yellow-400">
                <Icon name="AlertTriangle" size={16} className="shrink-0 mt-0.5" />
                <div className="space-y-1 text-foreground/80">
                  <p>Отправляйте только <strong>USDT ({depNetwork === 'TRON' ? 'TRC-20' : depNetwork === 'ETH' ? 'ERC-20' : 'TON'})</strong> на этот адрес.</p>
                  <p>Минимальная сумма: <strong>10 USDT</strong>. Зачисление после подтверждения оператором.</p>
                </div>
              </div>
            </div>

            {!depAddress ? (
              <button
                onClick={createDeposit}
                disabled={depLoading}
                className="w-full bg-primary text-background py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {depLoading ? 'Генерируем адрес...' : 'Получить адрес для пополнения'}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Ваш адрес ({depNetwork})</label>
                  <div className="flex items-center gap-2 bg-secondary rounded-lg px-4 py-3">
                    <span className="flex-1 font-mono text-sm break-all">{depAddress}</span>
                    <button onClick={() => copyToClipboard(depAddress, 'addr')} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      <Icon name={copied === 'addr' ? 'Check' : 'Copy'} size={16} className={copied === 'addr' ? 'text-buy' : ''} />
                    </button>
                  </div>
                </div>

                <div className="bg-buy/10 border border-buy/30 rounded-lg px-4 py-3 text-sm text-buy flex items-center gap-2">
                  <Icon name="Clock" size={16} />
                  Заявка создана. После отправки средств — ожидайте подтверждения оператора.
                </div>
              </div>
            )}
          </div>
        )}

        {/* History */}
        {tab === 'history' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="font-semibold">История транзакций</h3>
            </div>
            {txs.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Icon name="History" size={32} className="mx-auto mb-3 opacity-30" />
                <p>Транзакций пока нет</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {txs.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${tx.type === 'deposit' ? 'bg-buy/15' : 'bg-secondary'}`}>
                        <Icon name={tx.type === 'deposit' ? 'ArrowDownToLine' : tx.type === 'withdrawal' ? 'ArrowUpFromLine' : 'ArrowLeftRight'} size={16} className={tx.type === 'deposit' ? 'text-buy' : 'text-muted-foreground'} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{TX_LABELS[tx.type] || tx.type}</p>
                        <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString('ru')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono-num font-semibold text-sm ${tx.type === 'deposit' ? 'text-buy' : ''}`}>
                        {tx.type === 'deposit' ? '+' : ''}{tx.amount} {tx.currency}
                      </p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tx.status === 'completed' ? 'bg-buy/15 text-buy' : 'bg-secondary text-muted-foreground'}`}>
                        {tx.status === 'completed' ? 'Выполнено' : tx.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Security */}
        {tab === 'security' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-lg">Безопасность</h3>
            <div className="space-y-3">
              {[
                { icon: 'Lock', title: 'Двухфакторная аутентификация (2FA)', desc: 'Защитите аккаунт с помощью Google Authenticator', status: 'Не активна', color: 'text-sell' },
                { icon: 'Mail', title: 'Email-верификация', desc: user.email, status: user.is_verified ? 'Подтверждён' : 'Не подтверждён', color: user.is_verified ? 'text-buy' : 'text-sell' },
                { icon: 'Key', title: 'Смена пароля', desc: 'Последнее изменение: при регистрации', status: '', color: '' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-secondary rounded-xl">
                  <div className="flex items-center gap-3">
                    <Icon name={item.icon} size={20} className="text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                  {item.status && <span className={`text-xs font-medium ${item.color}`}>{item.status}</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">Для изменения настроек безопасности обратитесь в поддержку</p>
          </div>
        )}
      </div>
    </div>
  );
}
