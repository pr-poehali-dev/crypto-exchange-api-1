import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import Icon from '@/components/ui/icon';

interface Transaction {
  id: number; type: string; currency: string; amount: number;
  fee: number; status: string; note: string; created_at: string;
}
interface Wallet { network: string; address: string; }
interface ExchangeQuote {
  from: string; to: string; amount: number; rate: number;
  to_amount: number; fee_usdt: number; fee_pct: number;
}
interface FiatInfo {
  card_number: string; card_holder: string; bank_name: string;
  rub_per_usdt: number; min_amount_rub: number; fee_pct: number;
}

const CURRENCIES = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL'];
const NETWORK_INFO: Record<string, { color: string; icon: string; label: string }> = {
  TRON: { color: 'text-red-400',  icon: 'Zap',     label: 'TRON (TRC-20)'    },
  ETH:  { color: 'text-blue-400', icon: 'Layers',  label: 'Ethereum (ERC-20)' },
  TON:  { color: 'text-cyan-400', icon: 'Diamond', label: 'TON Network'       },
};
const TX_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  deposit:          { label: 'Пополнение',        icon: 'ArrowDownToLine',  color: 'text-buy'            },
  withdrawal:       { label: 'Вывод',             icon: 'ArrowUpFromLine',  color: 'text-sell'           },
  transfer_out:     { label: 'Перевод (исход.)',   icon: 'Send',             color: 'text-sell'           },
  transfer_in:      { label: 'Перевод (вход.)',    icon: 'Inbox',            color: 'text-buy'            },
  exchange:         { label: 'Обмен',             icon: 'ArrowLeftRight',   color: 'text-primary'        },
  admin_adjustment: { label: 'Корректировка',     icon: 'Settings',         color: 'text-muted-foreground'},
};

type Tab = 'overview' | 'deposit' | 'transfer' | 'exchange' | 'fiat' | 'history' | 'security';

export default function Dashboard() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [copied, setCopied] = useState('');

  // --- Deposit state ---
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [depNetwork, setDepNetwork] = useState('TRON');
  const [depAddress, setDepAddress] = useState('');
  const [depLoading, setDepLoading] = useState(false);

  // --- Transfer state ---
  const [trTo, setTrTo] = useState('');
  const [trCurrency, setTrCurrency] = useState('USDT');
  const [trAmount, setTrAmount] = useState('');
  const [trChecked, setTrChecked] = useState<null | boolean>(null);
  const [trLoading, setTrLoading] = useState(false);
  const [trResult, setTrResult] = useState<string>('');

  // --- Exchange state ---
  const [exFrom, setExFrom] = useState('USDT');
  const [exTo, setExTo] = useState('BTC');
  const [exAmount, setExAmount] = useState('');
  const [exQuote, setExQuote] = useState<ExchangeQuote | null>(null);
  const [exLoading, setExLoading] = useState(false);
  const [exResult, setExResult] = useState('');

  // --- Fiat state ---
  const [fiatInfo, setFiatInfo] = useState<FiatInfo | null>(null);
  const [fiatAmount, setFiatAmount] = useState('');
  const [fiatOrder, setFiatOrder] = useState<null | { order_id: string; usdt_amount: number; amount_rub: number; fee_rub: number; comment: string }>(null);
  const [fiatLoading, setFiatLoading] = useState(false);

  // --- History ---
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    refresh();
  }, []);

  useEffect(() => {
    if (tab === 'deposit' && wallets.length === 0) loadWallets();
    if (tab === 'history') loadTxs();
    if (tab === 'fiat' && !fiatInfo) loadFiatInfo();
  }, [tab]);

  const loadWallets = async () => {
    const { ok, data } = await api.wallets.list();
    if (ok) setWallets((data as { wallets: Wallet[] }).wallets);
  };
  const loadTxs = async () => {
    const { ok, data } = await api.transactions.list();
    if (ok) setTxs((data as { transactions: Transaction[] }).transactions);
  };
  const loadFiatInfo = async () => {
    const { ok, data } = await api.fiat.info();
    if (ok) setFiatInfo(data as FiatInfo);
  };

  const createDeposit = async () => {
    setDepLoading(true);
    const { ok, data } = await api.deposits.create(depNetwork);
    setDepLoading(false);
    if (ok) setDepAddress((data as { address: string }).address);
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  // Transfer: проверка юзера с дебаунсом
  const checkUser = useCallback(async (name: string) => {
    if (!name || name.length < 2) { setTrChecked(null); return; }
    const { ok, data } = await api.transfer.check(name);
    if (ok) setTrChecked((data as { found: boolean }).found);
  }, []);

  const sendTransfer = async () => {
    setTrLoading(true); setTrResult('');
    const { ok, data } = await api.transfer.send(trTo, trCurrency, parseFloat(trAmount));
    setTrLoading(false);
    if (ok) {
      const d = data as { amount: number; fee: number; currency: string; to: string };
      setTrResult(`✓ Отправлено ${d.amount} ${d.currency} → @${d.to} (комиссия ${d.fee} ${d.currency})`);
      setTrTo(''); setTrAmount(''); setTrChecked(null);
      refresh();
    } else {
      setTrResult('✗ ' + ((data as { error: string }).error || 'Ошибка'));
    }
  };

  // Exchange quote
  const fetchQuote = useCallback(async (from: string, to: string, amount: string) => {
    if (!amount || parseFloat(amount) <= 0 || from === to) { setExQuote(null); return; }
    const { ok, data } = await api.exchange.quote(from, to, parseFloat(amount));
    if (ok) setExQuote(data as ExchangeQuote);
  }, []);

  const doSwap = async () => {
    setExLoading(true); setExResult('');
    const { ok, data } = await api.exchange.swap(exFrom, exTo, parseFloat(exAmount));
    setExLoading(false);
    if (ok) {
      const d = data as { from_amount: number; from: string; to_amount: number; to: string };
      setExResult(`✓ Обменяно ${d.from_amount} ${d.from} → ${d.to_amount} ${d.to}`);
      setExAmount(''); setExQuote(null);
      refresh();
    } else {
      setExResult('✗ ' + ((data as { error: string }).error || 'Ошибка'));
    }
  };

  const createFiatOrder = async () => {
    setFiatLoading(true);
    const { ok, data } = await api.fiat.create(parseFloat(fiatAmount));
    setFiatLoading(false);
    if (ok) setFiatOrder(data as typeof fiatOrder);
  };

  const handleLogout = async () => { await logout(); navigate('/'); };

  if (!user) return null;
  const totalUSDT = user.balances.find(b => b.currency === 'USDT')?.available ?? 0;
  const getBalance = (cur: string) => user.balances.find(b => b.currency === cur)?.available ?? 0;

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview',  label: 'Обзор',      icon: 'LayoutDashboard' },
    { id: 'deposit',   label: 'Пополнение', icon: 'ArrowDownToLine' },
    { id: 'fiat',      label: 'Рубли',      icon: 'Banknote'        },
    { id: 'transfer',  label: 'Перевод',    icon: 'Send'            },
    { id: 'exchange',  label: 'Обмен',      icon: 'ArrowLeftRight'  },
    { id: 'history',   label: 'История',    icon: 'History'         },
    { id: 'security',  label: 'Безопасность', icon: 'Shield'        },
  ];

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
              Админ
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Общий баланс</p>
              <p className="text-3xl font-bold font-mono-num mt-1">
                {totalUSDT.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                <span className="text-muted-foreground text-lg ml-2">USDT</span>
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setTab('fiat')} className="bg-secondary text-foreground px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity">
                <Icon name="Banknote" size={15} />
                <span className="hidden sm:block">₽ Рубли</span>
              </button>
              <button onClick={() => setTab('deposit')} className="bg-primary text-background px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity">
                <Icon name="Plus" size={15} />
                <span className="hidden sm:block">Крипта</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
            {user.balances.map(b => (
              <div key={b.currency} className="bg-secondary rounded-lg px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.currency}</p>
                <p className="font-mono-num font-semibold text-sm mt-0.5">
                  {b.available.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon name={t.icon} size={14} />
              <span className="hidden sm:block">{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
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
              <h3 className="font-semibold flex items-center gap-2"><Icon name="Zap" size={16} className="text-primary" /> Быстрые действия</h3>
              <div className="space-y-2">
                {[
                  { id: 'deposit',  icon: 'ArrowDownToLine', color: 'text-buy',     title: 'Пополнить криптой',   sub: 'TRON, ETH, TON' },
                  { id: 'fiat',     icon: 'Banknote',        color: 'text-green-400', title: 'Пополнить рублями', sub: 'Карта · перевод' },
                  { id: 'transfer', icon: 'Send',            color: 'text-primary',  title: 'Перевести',          sub: 'Другому пользователю' },
                  { id: 'exchange', icon: 'ArrowLeftRight',  color: 'text-cyan-400', title: 'Быстрый обмен',      sub: 'BTC, ETH, USDT и др.' },
                ].map(a => (
                  <button key={a.id} onClick={() => setTab(a.id as Tab)} className="w-full flex items-center gap-3 px-4 py-3 bg-secondary rounded-lg hover:bg-muted transition-colors text-sm text-left">
                    <Icon name={a.icon} size={18} className={a.color} />
                    <div><p className="font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.sub}</p></div>
                  </button>
                ))}
                <Link to="/" className="w-full flex items-center gap-3 px-4 py-3 bg-secondary rounded-lg hover:bg-muted transition-colors text-sm">
                  <Icon name="CandlestickChart" size={18} className="text-primary" />
                  <div><p className="font-medium">Торговый терминал</p><p className="text-xs text-muted-foreground">Спот и маржинальная торговля</p></div>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ── DEPOSIT (крипта) ── */}
        {tab === 'deposit' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="font-semibold text-lg">Пополнение криптовалютой</h3>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Выберите сеть</label>
              <div className="grid grid-cols-3 gap-3">
                {['TRON', 'ETH', 'TON'].map(net => (
                  <button key={net} onClick={() => { setDepNetwork(net); setDepAddress(''); }}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${depNetwork === net ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-muted-foreground'}`}>
                    <Icon name={NETWORK_INFO[net].icon} size={24} className={NETWORK_INFO[net].color} />
                    <span className="text-sm font-semibold">{net}</span>
                    <span className="text-[10px] text-muted-foreground">{NETWORK_INFO[net].label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-lg px-4 py-3 text-sm flex gap-2">
              <Icon name="AlertTriangle" size={16} className="text-yellow-400 shrink-0 mt-0.5" />
              <span className="text-foreground/80">Отправляйте только <strong>USDT ({depNetwork === 'TRON' ? 'TRC-20' : depNetwork === 'ETH' ? 'ERC-20' : 'TON'})</strong>. Мин. 10 USDT. Зачисление после подтверждения оператором.</span>
            </div>
            {!depAddress ? (
              <button onClick={createDeposit} disabled={depLoading} className="w-full bg-primary text-background py-3 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50">
                {depLoading ? 'Генерируем адрес...' : 'Получить адрес для пополнения'}
              </button>
            ) : (
              <div className="space-y-3">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Ваш адрес ({depNetwork})</label>
                <div className="flex items-center gap-2 bg-secondary rounded-lg px-4 py-3">
                  <span className="flex-1 font-mono text-sm break-all">{depAddress}</span>
                  <button onClick={() => copy(depAddress, 'dep')} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <Icon name={copied === 'dep' ? 'Check' : 'Copy'} size={16} className={copied === 'dep' ? 'text-buy' : ''} />
                  </button>
                </div>
                <div className="bg-buy/10 border border-buy/30 rounded-lg px-4 py-3 text-sm text-buy flex gap-2">
                  <Icon name="Clock" size={15} className="shrink-0" />
                  Заявка создана. После отправки — ожидайте подтверждения оператора.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FIAT (рубли) ── */}
        {tab === 'fiat' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="font-semibold text-lg">Пополнение рублями</h3>
            {fiatInfo && !fiatOrder && (
              <>
                <div className="bg-secondary rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Курс</span><span className="font-mono-num">1 USDT = {fiatInfo.rub_per_usdt} ₽</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Комиссия</span><span>{fiatInfo.fee_pct}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Минимум</span><span>{fiatInfo.min_amount_rub} ₽</span></div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Сумма в рублях</label>
                  <div className="flex items-center bg-secondary border border-border rounded-lg px-4">
                    <input
                      type="number" value={fiatAmount}
                      onChange={e => setFiatAmount(e.target.value)}
                      placeholder="1000"
                      className="flex-1 bg-transparent py-3 font-mono-num text-sm outline-none"
                    />
                    <span className="text-muted-foreground text-sm">₽</span>
                  </div>
                  {fiatAmount && parseFloat(fiatAmount) >= 500 && (
                    <p className="text-xs text-muted-foreground">
                      Получите ≈ <span className="text-foreground font-semibold">{((parseFloat(fiatAmount) * 0.98) / fiatInfo.rub_per_usdt).toFixed(2)} USDT</span> (после комиссии {fiatInfo.fee_pct}%)
                    </p>
                  )}
                </div>
                <button onClick={createFiatOrder} disabled={fiatLoading || !fiatAmount || parseFloat(fiatAmount) < 500}
                  className="w-full bg-primary text-background py-3 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50">
                  {fiatLoading ? 'Создаём заявку...' : 'Создать заявку на пополнение'}
                </button>
              </>
            )}
            {fiatOrder && (
              <div className="space-y-4">
                <div className="bg-buy/10 border border-buy/30 rounded-xl p-4 text-sm space-y-1">
                  <p className="font-semibold text-buy flex items-center gap-2"><Icon name="CheckCircle" size={16} /> Заявка создана</p>
                  <p className="text-muted-foreground mt-2">Переведите <strong className="text-foreground">{fiatOrder.amount_rub} ₽</strong> на реквизиты ниже и получите <strong className="text-foreground">{fiatOrder.usdt_amount} USDT</strong></p>
                </div>
                {fiatInfo && (
                  <div className="space-y-3">
                    {[
                      { label: 'Банк',         value: fiatInfo.bank_name,   key: 'bank' },
                      { label: 'Номер карты',  value: fiatInfo.card_number, key: 'card' },
                      { label: 'Получатель',   value: fiatInfo.card_holder, key: 'holder' },
                      { label: 'Сумма',        value: fiatOrder.amount_rub + ' ₽', key: 'amt' },
                      { label: 'Комментарий', value: fiatOrder.comment,    key: 'comment' },
                    ].map(row => (
                      <div key={row.key} className="flex items-center justify-between bg-secondary rounded-lg px-4 py-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{row.label}</p>
                          <p className="text-sm font-mono mt-0.5">{row.value}</p>
                        </div>
                        <button onClick={() => copy(row.value, row.key)} className="text-muted-foreground hover:text-foreground ml-3">
                          <Icon name={copied === row.key ? 'Check' : 'Copy'} size={15} className={copied === row.key ? 'text-buy' : ''} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground text-center">Обязательно укажите комментарий к переводу. Зачисление в течение 15 минут в рабочее время.</p>
                <button onClick={() => { setFiatOrder(null); setFiatAmount(''); }} className="w-full py-2.5 bg-secondary rounded-lg text-sm">
                  Создать новую заявку
                </button>
              </div>
            )}
            {!fiatInfo && !fiatOrder && (
              <div className="py-8 text-center text-muted-foreground">
                <Icon name="Loader" size={24} className="mx-auto mb-2 animate-spin" />
                Загружаем реквизиты...
              </div>
            )}
          </div>
        )}

        {/* ── TRANSFER ── */}
        {tab === 'transfer' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <h3 className="font-semibold text-lg">Перевод пользователю</h3>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Username получателя</label>
              <div className="relative flex items-center bg-secondary border border-border rounded-lg px-4">
                <span className="text-muted-foreground mr-1">@</span>
                <input
                  type="text" value={trTo}
                  onChange={e => { setTrTo(e.target.value); setTrChecked(null); checkUser(e.target.value); }}
                  placeholder="username"
                  className="flex-1 bg-transparent py-3 text-sm outline-none"
                />
                {trChecked === true && <Icon name="CheckCircle" size={16} className="text-buy shrink-0" />}
                {trChecked === false && <Icon name="XCircle" size={16} className="text-sell shrink-0" />}
              </div>
              {trChecked === false && <p className="text-xs text-sell">Пользователь не найден</p>}
              {trChecked === true && <p className="text-xs text-buy">Пользователь найден</p>}
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Валюта</label>
              <div className="grid grid-cols-5 gap-2">
                {CURRENCIES.map(c => (
                  <button key={c} onClick={() => setTrCurrency(c)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${trCurrency === c ? 'bg-primary text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                    {c}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Доступно: <span className="text-foreground">{getBalance(trCurrency).toLocaleString('en-US', { maximumFractionDigits: 6 })} {trCurrency}</span></p>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Сумма</label>
              <div className="flex items-center bg-secondary border border-border rounded-lg px-4">
                <input type="number" value={trAmount} onChange={e => setTrAmount(e.target.value)}
                  placeholder="0.00" className="flex-1 bg-transparent py-3 font-mono-num text-sm outline-none" />
                <span className="text-muted-foreground text-sm">{trCurrency}</span>
              </div>
              {trAmount && <p className="text-xs text-muted-foreground">Комиссия сети: 0.1% ({(parseFloat(trAmount || '0') * 0.001).toFixed(6)} {trCurrency})</p>}
            </div>
            {trResult && (
              <div className={`rounded-lg px-4 py-3 text-sm ${trResult.startsWith('✓') ? 'bg-buy/10 border border-buy/30 text-buy' : 'bg-sell/10 border border-sell/30 text-sell'}`}>
                {trResult}
              </div>
            )}
            <button onClick={sendTransfer} disabled={trLoading || !trTo || !trAmount || trChecked !== true}
              className="w-full bg-primary text-background py-3 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              <Icon name="Send" size={16} />
              {trLoading ? 'Отправляем...' : 'Отправить'}
            </button>
          </div>
        )}

        {/* ── EXCHANGE ── */}
        {tab === 'exchange' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <h3 className="font-semibold text-lg">Быстрый обмен</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Отдаю</label>
                <select value={exFrom} onChange={e => { setExFrom(e.target.value); setExQuote(null); }}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Баланс: {getBalance(exFrom).toLocaleString('en-US', { maximumFractionDigits: 6 })}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Получаю</label>
                <select value={exTo} onChange={e => { setExTo(e.target.value); setExQuote(null); }}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {CURRENCIES.filter(c => c !== exFrom).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Сумма {exFrom}</label>
              <div className="flex items-center bg-secondary border border-border rounded-lg px-4">
                <input type="number" value={exAmount}
                  onChange={e => { setExAmount(e.target.value); fetchQuote(exFrom, exTo, e.target.value); setExQuote(null); }}
                  placeholder="0.00" className="flex-1 bg-transparent py-3 font-mono-num text-sm outline-none" />
                <button onClick={() => { const b = getBalance(exFrom).toString(); setExAmount(b); fetchQuote(exFrom, exTo, b); }} className="text-xs text-primary ml-2">MAX</button>
              </div>
            </div>
            {exQuote && (
              <div className="bg-secondary rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Курс</span><span className="font-mono-num">1 {exFrom} = {exQuote.rate.toFixed(6)} {exTo}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Получите</span><span className="font-mono-num font-semibold">{exQuote.to_amount} {exTo}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Комиссия</span><span className="font-mono-num text-muted-foreground">{exQuote.fee_usdt} USDT ({exQuote.fee_pct}%)</span></div>
              </div>
            )}
            {!exQuote && exAmount && (
              <button onClick={() => fetchQuote(exFrom, exTo, exAmount)} className="w-full py-2.5 bg-secondary rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
                Рассчитать курс
              </button>
            )}
            {exResult && (
              <div className={`rounded-lg px-4 py-3 text-sm ${exResult.startsWith('✓') ? 'bg-buy/10 border border-buy/30 text-buy' : 'bg-sell/10 border border-sell/30 text-sell'}`}>
                {exResult}
              </div>
            )}
            <button onClick={doSwap} disabled={exLoading || !exQuote}
              className="w-full bg-primary text-background py-3 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              <Icon name="ArrowLeftRight" size={16} />
              {exLoading ? 'Обмениваем...' : `Обменять ${exFrom} → ${exTo}`}
            </button>
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold">История транзакций</h3>
              <button onClick={loadTxs} className="text-muted-foreground hover:text-foreground"><Icon name="RefreshCw" size={15} /></button>
            </div>
            {txs.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Icon name="History" size={32} className="mx-auto mb-3 opacity-30" />
                <p>Транзакций пока нет</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {txs.map(tx => {
                  const info = TX_LABELS[tx.type] ?? { label: tx.type, icon: 'Circle', color: 'text-muted-foreground' };
                  return (
                    <div key={tx.id} className="flex items-center justify-between px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                          <Icon name={info.icon} size={15} className={info.color} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{info.label}</p>
                          <p className="text-xs text-muted-foreground">{tx.note || new Date(tx.created_at).toLocaleString('ru')}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-mono-num font-semibold text-sm ${info.color}`}>
                          {tx.type === 'transfer_out' || tx.type === 'exchange' ? '-' : '+'}{tx.amount} {tx.currency}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{new Date(tx.created_at).toLocaleDateString('ru')}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SECURITY ── */}
        {tab === 'security' && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-lg">Безопасность</h3>
            <div className="space-y-3">
              {[
                { icon: 'Lock',    title: '2FA аутентификация',  desc: 'Google Authenticator',  status: 'Не активна', color: 'text-sell' },
                { icon: 'Mail',    title: 'Email',               desc: user.email,              status: user.is_verified ? 'Подтверждён' : 'Не подтверждён', color: user.is_verified ? 'text-buy' : 'text-sell' },
                { icon: 'Key',     title: 'Смена пароля',        desc: 'Обратитесь в поддержку', status: '', color: '' },
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
          </div>
        )}
      </div>
    </div>
  );
}
