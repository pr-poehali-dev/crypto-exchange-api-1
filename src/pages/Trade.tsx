import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import Icon from '@/components/ui/icon';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Pair {
  id: number; symbol: string; base: string; quote: string;
  last_price: number; volume_24h: number; high_24h: number; low_24h: number;
  maker_fee: number; taker_fee: number; min_qty: number;
}
interface OBEntry { price: number; qty: number; }
interface Trade    { price: number; qty: number; total: number; time: string; }
interface Candle   { t: number; o: number; h: number; l: number; c: number; v: number; }
interface Order {
  id: number; symbol: string; side: string; type: string; status: string;
  price: number | null; qty: number; filled_qty: number; avg_price: number;
  fee: number; created_at: string;
}

const INTERVALS = ['1m','5m','15m','1h','4h','1d'];
const ORDER_TYPES = [
  { value: 'limit',      label: 'Лимит' },
  { value: 'market',     label: 'Рынок' },
  { value: 'stop_loss',  label: 'Стоп' },
  { value: 'take_profit',label: 'Тейк' },
];

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ─── Mini candle chart ────────────────────────────────────────────────────────
function CandleChart({ candles, height = 200 }: { candles: Candle[]; height?: number }) {
  if (!candles.length) return (
    <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
      <Icon name="BarChart2" size={20} className="mr-2 opacity-30" /> Нет данных
    </div>
  );
  const W = 800, H = height;
  const maxH = Math.max(...candles.map(c => c.h));
  const minL = Math.min(...candles.map(c => c.l));
  const range = maxH - minL || 1;
  const cw = W / candles.length;
  const py = (v: number) => H - ((v - minL) / range) * (H - 20) - 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {candles.map((c, i) => {
        const x = i * cw + cw * 0.1;
        const w = cw * 0.8;
        const isUp = c.c >= c.o;
        const color = isUp ? '#22c55e' : '#ef4444';
        const bodyTop = py(Math.max(c.o, c.c));
        const bodyH = Math.abs(py(c.o) - py(c.c)) || 1;
        const mid = x + w / 2;
        return (
          <g key={i}>
            <line x1={mid} y1={py(c.h)} x2={mid} y2={py(c.l)} stroke={color} strokeWidth={1} />
            <rect x={x} y={bodyTop} width={w} height={bodyH} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Orderbook ────────────────────────────────────────────────────────────────
function Orderbook({ bids, asks, lastPrice, onPriceClick }: {
  bids: OBEntry[]; asks: OBEntry[]; lastPrice: number;
  onPriceClick: (p: number) => void;
}) {
  const maxVol = Math.max(...[...bids, ...asks].map(e => e.qty), 0.001);
  const renderRow = (e: OBEntry, side: 'buy' | 'sell') => {
    const pct = (e.qty / maxVol) * 100;
    return (
      <button key={e.price} onClick={() => onPriceClick(e.price)}
        className="relative w-full flex justify-between text-xs px-2 py-0.5 hover:bg-white/5 font-mono group">
        <div className={`absolute inset-y-0 right-0 ${side === 'buy' ? 'bg-buy/10' : 'bg-sell/10'}`}
             style={{ width: `${pct}%` }} />
        <span className={side === 'buy' ? 'text-buy' : 'text-sell'}>{fmt(e.price, 4)}</span>
        <span className="text-foreground/70">{fmt(e.qty, 4)}</span>
        <span className="text-muted-foreground">{fmt(e.price * e.qty, 2)}</span>
      </button>
    );
  };
  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex justify-between text-muted-foreground px-2 py-1 border-b border-border text-[10px] uppercase tracking-wide">
        <span>Цена</span><span>Кол-во</span><span>Объём</span>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto flex flex-col-reverse">
          {asks.slice(0, 12).map(e => renderRow(e, 'sell'))}
        </div>
        <div className="border-y border-border py-1.5 px-2 text-center">
          <span className={`font-bold font-mono text-sm ${lastPrice > 0 ? 'text-buy' : 'text-muted-foreground'}`}>
            {fmt(lastPrice, 4)}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {bids.slice(0, 12).map(e => renderRow(e, 'buy'))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Trade() {
  const { symbol: paramSymbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  const [pairs, setPairs]       = useState<Pair[]>([]);
  const [symbol, setSymbol]     = useState(paramSymbol?.replace('-', '/') || 'BTC/USDT');
  const [pair, setPair]         = useState<Pair | null>(null);
  const [bids, setBids]         = useState<OBEntry[]>([]);
  const [asks, setAsks]         = useState<OBEntry[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [candles, setCandles]   = useState<Candle[]>([]);
  const [interval, setInterval] = useState('1h');
  const [myOrders, setMyOrders] = useState<Order[]>([]);

  // Form state
  const [side, setSide]         = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState('limit');
  const [price, setPrice]       = useState('');
  const [qty, setQty]           = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [pctBtn, setPctBtn]     = useState(0);
  const [placing, setPlacing]   = useState(false);
  const [orderMsg, setOrderMsg] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPairs = useCallback(async () => {
    const { ok, data } = await api.orders.pairs();
    if (ok) {
      const p = (data as { pairs: Pair[] }).pairs;
      setPairs(p);
      const cur = p.find(x => x.symbol === symbol) || p[0];
      if (cur) { setPair(cur); setSymbol(cur.symbol); }
    }
  }, [symbol]);

  const loadMarket = useCallback(async (sym: string) => {
    const [ob, tr, cd] = await Promise.all([
      api.orders.orderbook(sym),
      api.orders.trades(sym),
      api.orders.candles(sym, interval, 80),
    ]);
    if (ob.ok) {
      const d = ob.data as { bids: OBEntry[]; asks: OBEntry[] };
      setBids(d.bids); setAsks(d.asks);
    }
    if (tr.ok) setRecentTrades((tr.data as { trades: Trade[] }).trades);
    if (cd.ok) setCandles((cd.data as { candles: Candle[] }).candles);
  }, [interval]);

  const loadMyOrders = useCallback(async () => {
    if (!user) return;
    const { ok, data } = await api.orders.myOrders(symbol);
    if (ok) setMyOrders((data as { orders: Order[] }).orders);
  }, [user, symbol]);

  useEffect(() => {
    loadPairs();
  }, []);

  useEffect(() => {
    loadMarket(symbol);
    loadMyOrders();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMarket(symbol), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [symbol, interval]);

  const selectSymbol = (sym: string) => {
    setSymbol(sym);
    setPair(pairs.find(p => p.symbol === sym) || null);
    navigate(`/trade/${sym.replace('/', '-')}`, { replace: true });
    setOrderMsg('');
    setQty(''); setPrice('');
  };

  const getBalance = (cur: string) =>
    user?.balances.find(b => b.currency === cur)?.available ?? 0;

  const calcQtyFromPct = (pct: number) => {
    if (!pair) return;
    if (side === 'buy') {
      const bal = getBalance(pair.quote);
      const p   = parseFloat(price) || pair.last_price;
      if (p > 0) setQty(((bal * pct / 100) / p).toFixed(6));
    } else {
      const bal = getBalance(pair.base);
      setQty(((bal * pct / 100)).toFixed(6));
    }
    setPctBtn(pct);
  };

  const placeOrder = async () => {
    if (!pair) return;
    setPlacing(true); setOrderMsg('');
    const { ok, data } = await api.orders.create({
      symbol,
      side,
      type: orderType,
      qty: parseFloat(qty),
      price: orderType !== 'market' ? parseFloat(price) : undefined,
      stop_price: stopPrice ? parseFloat(stopPrice) : undefined,
    });
    setPlacing(false);
    if (ok) {
      const d = data as { status: string; filled_qty: number; avg_price: number };
      setOrderMsg(d.status === 'filled'
        ? `✓ Исполнен: ${d.filled_qty} ${pair.base} @ ${fmt(d.avg_price, 4)}`
        : `✓ Ордер размещён (${d.status})`);
      setQty(''); setPctBtn(0);
      refresh(); loadMyOrders(); loadMarket(symbol);
    } else {
      setOrderMsg('✗ ' + ((data as { error: string }).error || 'Ошибка'));
    }
  };

  const cancelOrder = async (id: number) => {
    await api.orders.cancel(id);
    loadMyOrders(); refresh();
  };

  const base  = pair?.base  || 'BTC';
  const quote = pair?.quote || 'USDT';
  const baseBal  = getBalance(base);
  const quoteBal = getBalance(quote);

  const priceChange = pair ? ((pair.last_price - pair.low_24h) / (pair.high_24h - pair.low_24h || 1) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      {/* ── Top Bar ── */}
      <header className="h-12 border-b border-border flex items-center px-3 gap-3 shrink-0">
        <Link to="/" className="flex items-center gap-1.5 mr-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <Icon name="Hexagon" size={13} className="text-background" />
          </div>
          <span className="font-bold text-sm">NEXUS</span>
        </Link>

        {/* Пары */}
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {pairs.map(p => (
            <button key={p.symbol} onClick={() => selectSymbol(p.symbol)}
              className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${p.symbol === symbol ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {p.symbol}
            </button>
          ))}
        </div>

        {/* Ticker */}
        {pair && (
          <div className="ml-auto flex items-center gap-4 text-xs shrink-0">
            <span className="text-buy font-mono font-bold text-base">{fmt(pair.last_price, 4)}</span>
            <div className="hidden sm:flex gap-4 text-muted-foreground">
              <span>H: <span className="text-foreground">{fmt(pair.high_24h, 4)}</span></span>
              <span>L: <span className="text-foreground">{fmt(pair.low_24h, 4)}</span></span>
              <span>Vol: <span className="text-foreground">{fmt(pair.volume_24h, 2)}</span></span>
            </div>
          </div>
        )}

        {/* Nav */}
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Icon name="LayoutDashboard" size={14} />
            <span className="hidden sm:block">ЛК</span>
          </Link>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Chart + Recent trades (left) ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Interval selector */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
            {INTERVALS.map(iv => (
              <button key={iv} onClick={() => setInterval(iv)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${interval === iv ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {iv}
              </button>
            ))}
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 p-2 border-b border-border overflow-hidden">
            <CandleChart candles={candles} height={220} />
          </div>

          {/* Recent trades */}
          <div className="h-40 overflow-hidden border-b border-border">
            <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wide px-3 py-1.5 border-b border-border">
              <span>Цена ({quote})</span><span>Кол-во ({base})</span><span>Время</span>
            </div>
            <div className="overflow-y-auto h-[calc(100%-28px)]">
              {recentTrades.map((t, i) => {
                const prev = recentTrades[i + 1];
                const up   = !prev || t.price >= prev.price;
                return (
                  <div key={i} className="flex justify-between text-xs font-mono px-3 py-0.5 hover:bg-secondary/40">
                    <span className={up ? 'text-buy' : 'text-sell'}>{fmt(t.price, 4)}</span>
                    <span className="text-foreground/70">{fmt(t.qty, 4)}</span>
                    <span className="text-muted-foreground">
                      {new Date(t.time).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* My Orders */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
              <span className="text-xs font-medium">Мои ордера</span>
              <button onClick={loadMyOrders} className="text-muted-foreground hover:text-foreground">
                <Icon name="RefreshCw" size={12} />
              </button>
            </div>
            {!user ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <Link to="/login" className="text-primary hover:underline">Войдите</Link> для торговли
              </div>
            ) : myOrders.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">Нет открытых ордеров</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-[10px] uppercase border-b border-border">
                      <th className="px-2 py-1 text-left">Пара</th>
                      <th className="px-2 py-1">Тип</th>
                      <th className="px-2 py-1">Сторона</th>
                      <th className="px-2 py-1">Цена</th>
                      <th className="px-2 py-1">Кол-во</th>
                      <th className="px-2 py-1">Исполн.</th>
                      <th className="px-2 py-1">Статус</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOrders.map(o => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="px-2 py-1 font-medium">{o.symbol}</td>
                        <td className="px-2 py-1 text-center capitalize">{o.type}</td>
                        <td className={`px-2 py-1 text-center font-medium ${o.side === 'buy' ? 'text-buy' : 'text-sell'}`}>
                          {o.side === 'buy' ? 'Покупка' : 'Продажа'}
                        </td>
                        <td className="px-2 py-1 text-center font-mono">{o.price ? fmt(o.price, 4) : 'Рынок'}</td>
                        <td className="px-2 py-1 text-center font-mono">{fmt(o.qty, 6)}</td>
                        <td className="px-2 py-1 text-center font-mono text-muted-foreground">{fmt(o.filled_qty, 6)}</td>
                        <td className="px-2 py-1 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                            o.status === 'filled' ? 'bg-buy/20 text-buy' :
                            o.status === 'partial' ? 'bg-primary/20 text-primary' :
                            o.status === 'cancelled' ? 'bg-muted text-muted-foreground' :
                            'bg-yellow-400/20 text-yellow-400'
                          }`}>{o.status}</span>
                        </td>
                        <td className="px-2 py-1">
                          {o.status === 'open' || o.status === 'partial' ? (
                            <button onClick={() => cancelOrder(o.id)}
                              className="text-sell text-[10px] hover:underline">Отмена</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Orderbook (center) ── */}
        <div className="w-52 border-x border-border flex flex-col shrink-0 hidden md:flex">
          <div className="px-3 py-1.5 border-b border-border text-xs font-medium">Стакан</div>
          <div className="flex-1 overflow-hidden">
            <Orderbook
              bids={bids} asks={asks}
              lastPrice={pair?.last_price || 0}
              onPriceClick={p => setPrice(String(p))}
            />
          </div>
        </div>

        {/* ── Order Form (right) ── */}
        <div className="w-64 border-l border-border flex flex-col shrink-0">
          {/* Buy/Sell toggle */}
          <div className="flex border-b border-border">
            <button onClick={() => setSide('buy')}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${side === 'buy' ? 'bg-buy/20 text-buy' : 'text-muted-foreground hover:text-foreground'}`}>
              Покупка
            </button>
            <button onClick={() => setSide('sell')}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${side === 'sell' ? 'bg-sell/20 text-sell' : 'text-muted-foreground hover:text-foreground'}`}>
              Продажа
            </button>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {/* Order type */}
            <div className="grid grid-cols-2 gap-1">
              {ORDER_TYPES.map(ot => (
                <button key={ot.value} onClick={() => setOrderType(ot.value)}
                  className={`py-1.5 rounded text-xs font-medium transition-colors ${orderType === ot.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {ot.label}
                </button>
              ))}
            </div>

            {/* Balance */}
            {user && (
              <div className="bg-secondary/60 rounded-lg px-3 py-2 text-xs flex justify-between">
                <span className="text-muted-foreground">Доступно</span>
                <span className="font-mono font-medium">
                  {side === 'buy' ? `${fmt(quoteBal, 4)} ${quote}` : `${fmt(baseBal, 6)} ${base}`}
                </span>
              </div>
            )}

            {/* Price (not for market) */}
            {orderType !== 'market' && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Цена ({quote})</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                  placeholder={fmt(pair?.last_price || 0, 4)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
              </div>
            )}

            {/* Stop price */}
            {(orderType === 'stop_loss' || orderType === 'take_profit') && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Стоп-цена ({quote})</label>
                <input type="number" value={stopPrice} onChange={e => setStopPrice(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
              </div>
            )}

            {/* Qty */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Кол-во ({base})</label>
              <input type="number" value={qty} onChange={e => { setQty(e.target.value); setPctBtn(0); }}
                placeholder={pair ? `Мин. ${pair.min_qty}` : '0'}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
            </div>

            {/* % buttons */}
            <div className="grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => calcQtyFromPct(p)}
                  className={`py-1 rounded text-xs transition-colors ${pctBtn === p ? 'bg-primary/30 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                  {p}%
                </button>
              ))}
            </div>

            {/* Total */}
            {qty && price && (
              <div className="bg-secondary/60 rounded-lg px-3 py-2 text-xs flex justify-between">
                <span className="text-muted-foreground">Итого</span>
                <span className="font-mono">{fmt(parseFloat(qty) * parseFloat(price), 4)} {quote}</span>
              </div>
            )}

            {/* Fee */}
            {pair && (
              <div className="text-[10px] text-muted-foreground text-center">
                Taker fee: {(pair.taker_fee * 100).toFixed(2)}% · Maker: {(pair.maker_fee * 100).toFixed(2)}%
              </div>
            )}

            {/* Result message */}
            {orderMsg && (
              <div className={`rounded-lg px-3 py-2 text-xs ${orderMsg.startsWith('✓') ? 'bg-buy/10 text-buy' : 'bg-sell/10 text-sell'}`}>
                {orderMsg}
              </div>
            )}

            {/* Submit */}
            {user ? (
              <button onClick={placeOrder}
                disabled={placing || !qty || (orderType !== 'market' && !price)}
                className={`w-full py-3 rounded-lg text-sm font-bold transition-all disabled:opacity-40 ${
                  side === 'buy'
                    ? 'bg-buy text-white hover:bg-buy/90'
                    : 'bg-sell text-white hover:bg-sell/90'
                }`}>
                {placing ? 'Размещаем...' : side === 'buy' ? `Купить ${base}` : `Продать ${base}`}
              </button>
            ) : (
              <div className="text-center space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">Для торговли необходима авторизация</p>
                <Link to="/login" className="block w-full py-2.5 bg-primary text-background text-sm font-semibold rounded-lg text-center hover:opacity-90">
                  Войти
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
