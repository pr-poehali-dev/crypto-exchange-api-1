import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';

interface Pair {
  symbol: string;
  base: string;
  price: number;
  change: number;
  vol: string;
  livePrice?: number;
}

const PAIRS: Pair[] = [
  { symbol: 'BTC/USDT', base: 'Bitcoin', price: 67432.18, change: 0, vol: '—' },
  { symbol: 'ETH/USDT', base: 'Ethereum', price: 3521.74, change: 0, vol: '—' },
  { symbol: 'SOL/USDT', base: 'Solana', price: 178.92, change: 0, vol: '—' },
  { symbol: 'BNB/USDT', base: 'BNB', price: 612.45, change: 0, vol: '—' },
  { symbol: 'XRP/USDT', base: 'Ripple', price: 0.6184, change: 0, vol: '—' },
  { symbol: 'AVAX/USDT', base: 'Avalanche', price: 38.27, change: 0, vol: '—' },
  { symbol: 'LINK/USDT', base: 'Chainlink', price: 17.83, change: 0, vol: '—' },
  { symbol: 'ADA/USDT', base: 'Cardano', price: 0.4521, change: 0, vol: '—' },
  { symbol: 'RUB/USDT', base: 'Рубль', price: 0.0108, change: 0.23, vol: '88M' },
];

// Символы Binance (без RUB/USDT — её нет на бирже)
const BINANCE_SYMBOLS = PAIRS
  .filter(p => p.symbol !== 'RUB/USDT')
  .map(p => p.symbol.replace('/', '').toLowerCase());

interface TickerMap {
  [symbol: string]: { price: number; change: number; vol: string; dir: 'up' | 'down' };
}

function useBinanceTicker() {
  const [tickers, setTickers] = useState<TickerMap>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const streams = BINANCE_SYMBOLS.map(s => `${s}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const d = msg.data;
        if (!d || !d.s) return;
        const symbol = d.s.slice(0, -4) + '/' + d.s.slice(-4);
        const price = parseFloat(d.c);
        const change = parseFloat(d.P);
        const rawVol = parseFloat(d.q);
        const vol = rawVol >= 1e9
          ? (rawVol / 1e9).toFixed(2) + 'B'
          : rawVol >= 1e6
          ? (rawVol / 1e6).toFixed(0) + 'M'
          : rawVol.toFixed(0);

        setTickers(prev => ({
          ...prev,
          [symbol]: {
            price,
            change,
            vol,
            dir: price > (prev[symbol]?.price ?? price) ? 'up' : 'down',
          },
        }));
      } catch (_) { /* ignore malformed messages */ }
    };

    return () => ws.close();
  }, []);

  return { tickers, connected };
}

const NAV = [
  { id: 'trade', label: 'Терминал', icon: 'CandlestickChart' },
  { id: 'markets', label: 'Рынки', icon: 'LineChart' },
  { id: 'wallet', label: 'Баланс', icon: 'Wallet' },
  { id: 'api', label: 'API', icon: 'Code2' },
  { id: 'security', label: '2FA / Доступ', icon: 'ShieldCheck' },
  { id: 'support', label: 'Поддержка', icon: 'Headset' },
];

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: n < 1 ? 4 : 2,
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
}

function useLivePrice(base: number) {
  const [price, setPrice] = useState(base);
  const [dir, setDir] = useState<'up' | 'down'>('up');
  useEffect(() => {
    const t = setInterval(() => {
      setPrice((p) => {
        const delta = (Math.random() - 0.48) * base * 0.0008;
        const next = +(p + delta).toFixed(base < 1 ? 4 : 2);
        setDir(next >= p ? 'up' : 'down');
        return next;
      });
    }, 1400);
    return () => clearInterval(t);
  }, [base]);
  return { price, dir };
}

function CandleChart({ pair }: { pair: Pair }) {
  const candles = useMemo(() => {
    const arr: { o: number; c: number; h: number; l: number }[] = [];
    let last = pair.price;
    const volatility = pair.price * 0.006;
    for (let i = 0; i < 48; i++) {
      const o = last;
      const c = o + (Math.random() - 0.48) * volatility;
      const h = Math.max(o, c) + Math.random() * volatility * 0.4;
      const l = Math.min(o, c) - Math.random() * volatility * 0.4;
      arr.push({ o, c, h, l });
      last = c;
    }
    return arr;
  }, [pair.symbol]);
  const all = candles.flatMap((candle) => [candle.h, candle.l]);
  const max = all.length ? Math.max(...all) : 1;
  const min = all.length ? Math.min(...all) : 0;
  const range = max - min || 1;
  const W = 760;
  const H = 320;
  const cw = candles.length ? W / candles.length : W;
  const y = (v: number) => H - ((v - min) / range) * H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {candles.map((candle, i) => {
        const up = candle.c >= candle.o;
        const color = up ? 'hsl(var(--buy))' : 'hsl(var(--sell))';
        const x = i * cw + cw / 2;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth={1} />
            <rect
              x={i * cw + cw * 0.18}
              width={cw * 0.64}
              y={y(Math.max(candle.o, candle.c))}
              height={Math.max(2, Math.abs(y(candle.o) - y(candle.c)))}
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}

function OrderBook() {
  const rows = useMemo(() => {
    const asks: { p: number; a: number }[] = [];
    const bids: { p: number; a: number }[] = [];
    const p = 67432;
    for (let i = 0; i < 9; i++) {
      asks.push({ p: +(p + (9 - i) * 6.4).toFixed(2), a: +(Math.random() * 2.4).toFixed(3) });
      bids.push({ p: +(p - (i + 1) * 6.4).toFixed(2), a: +(Math.random() * 2.4).toFixed(3) });
    }
    return { asks, bids };
  }, []);
  const maxA = Math.max(...[...rows.asks, ...rows.bids].map((r) => r.a));

  const Row = ({ p, a, side }: { p: number; a: number; side: 'buy' | 'sell' }) => (
    <div className="relative grid grid-cols-3 px-3 py-[3px] text-xs font-mono-num">
      <div
        className={`absolute inset-y-0 right-0 ${side === 'buy' ? 'bg-buy' : 'bg-sell'} opacity-[0.08]`}
        style={{ width: `${(a / maxA) * 100}%` }}
      />
      <span className={`relative ${side === 'buy' ? 'text-buy' : 'text-sell'}`}>{fmtPrice(p)}</span>
      <span className="relative text-right text-foreground/80">{a.toFixed(3)}</span>
      <span className="relative text-right text-muted-foreground">{(p * a).toFixed(0)}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-3 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
        <span>Цена USDT</span>
        <span className="text-right">Объём BTC</span>
        <span className="text-right">Сумма</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {rows.asks.map((r, i) => <Row key={i} {...r} side="sell" />)}
        <div className="px-3 py-2 my-1 border-y border-border flex items-center gap-2">
          <span className="text-buy font-mono-num text-base font-semibold">67,432.18</span>
          <Icon name="ArrowUp" size={14} className="text-buy" />
          <span className="text-[10px] text-muted-foreground ml-auto">≈ $67,432</span>
        </div>
        {rows.bids.map((r, i) => <Row key={i} {...r} side="buy" />)}
      </div>
    </div>
  );
}

function OrderForm({ pair }: { pair: Pair }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [leverage, setLeverage] = useState(10);
  const [amount, setAmount] = useState('');
  const base = pair.symbol.split('/')[0];

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-md">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`py-2 rounded text-sm font-semibold uppercase tracking-wide transition-colors ${
              side === s
                ? s === 'buy'
                  ? 'bg-buy text-background'
                  : 'bg-sell text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'buy' ? 'Купить' : 'Продать'}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Кредитное плечо</span>
        <span className="font-mono-num font-semibold text-primary">{leverage}x</span>
      </div>
      <input
        type="range"
        min={1}
        max={100}
        value={leverage}
        onChange={(e) => setLeverage(+e.target.value)}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono-num">
        {[1, 25, 50, 75, 100].map((l) => (
          <button key={l} onClick={() => setLeverage(l)} className="hover:text-primary">{l}x</button>
        ))}
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Цена</label>
        <div className="flex items-center bg-secondary rounded-md px-3">
          <input value={fmtPrice(pair.livePrice ?? pair.price)} readOnly className="flex-1 bg-transparent py-2.5 font-mono-num text-sm outline-none" />
          <span className="text-xs text-muted-foreground">USDT</span>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Объём</label>
        <div className="flex items-center bg-secondary rounded-md px-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            className="flex-1 bg-transparent py-2.5 font-mono-num text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <span className="text-xs text-muted-foreground">{base}</span>
        </div>
      </div>

      <div className="flex justify-between gap-1">
        {['25%', '50%', '75%', '100%'].map((p) => (
          <button key={p} className="flex-1 py-1.5 text-[11px] bg-secondary rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {p}
          </button>
        ))}
      </div>

      <div className="space-y-1.5 text-xs pt-1">
        <div className="flex justify-between"><span className="text-muted-foreground">Доступно</span><span className="font-mono-num">12,480.00 USDT</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Маржа</span><span className="font-mono-num">— USDT</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Цена ликвидации</span><span className="font-mono-num text-sell">—</span></div>
      </div>

      <button
        className={`w-full py-3 rounded-md font-semibold uppercase tracking-wide text-background transition-transform hover:scale-[1.01] ${
          side === 'buy' ? 'bg-buy' : 'bg-sell'
        }`}
      >
        {side === 'buy' ? 'Купить' : 'Продать'} {base} · {leverage}x
      </button>
    </div>
  );
}

function Panel({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-lg flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/90">{title}</h3>
        {action}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

const Index = () => {
  const [active, setActive] = useState('trade');
  const [selectedPair, setSelectedPair] = useState<Pair>(PAIRS[0]);
  const { tickers, connected } = useBinanceTicker();
  const { user } = useAuth();

  // Для RUB/USDT используем симуляцию, для остальных — Binance
  const rubSimulated = useLivePrice(0.0108);

  const getPairData = (pair: Pair) => {
    if (pair.symbol === 'RUB/USDT') {
      return { price: rubSimulated.price, change: pair.change, vol: pair.vol, dir: rubSimulated.dir };
    }
    return tickers[pair.symbol] ?? { price: pair.price, change: pair.change, vol: pair.vol, dir: 'up' as const };
  };

  const selectedLive = getPairData(selectedPair);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center px-4 gap-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center glow-primary">
            <Icon name="Hexagon" size={18} className="text-background" />
          </div>
          <span className="font-display text-xl font-bold tracking-wide">NEXUS</span>
        </div>
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setActive(n.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                active === n.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={n.icon} size={15} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-buy animate-pulse-live' : 'bg-sell'}`} />
            {connected ? 'Binance · LIVE' : 'Подключение...'}
          </span>
          {user ? (
            <div className="flex items-center gap-2">
              {user.is_admin && (
                <Link to="/admin" className="text-xs text-primary border border-primary/30 rounded px-2.5 py-1 hover:bg-primary/10 transition-colors hidden sm:block">
                  Админ
                </Link>
              )}
              <Link to="/dashboard" className="px-4 py-1.5 rounded bg-primary text-background text-sm font-semibold hover:scale-[1.02] transition-transform">
                @{user.username}
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground transition-colors">
                Войти
              </Link>
              <Link to="/register" className="px-4 py-1.5 rounded bg-primary text-background text-sm font-semibold hover:scale-[1.02] transition-transform">
                Регистрация
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Ticker bar */}
      <div className="h-10 border-b border-border flex items-center gap-6 px-4 overflow-x-auto scrollbar-thin shrink-0">
        <span className="flex items-center gap-1.5 text-[10px] shrink-0 text-muted-foreground">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-buy animate-pulse-live' : 'bg-sell'}`} />
          {connected ? 'LIVE' : 'ОФЛАЙН'}
        </span>
        {PAIRS.map((p) => {
          const live = getPairData(p);
          return (
            <button key={p.symbol} onClick={() => setSelectedPair(p)} className="flex items-center gap-2 shrink-0 text-xs hover:opacity-80 transition-opacity">
              <span className={`font-medium ${selectedPair.symbol === p.symbol ? 'text-primary' : 'text-muted-foreground'}`}>{p.symbol}</span>
              <span className="font-mono-num">{fmtPrice(live.price)}</span>
              <span className={`font-mono-num ${live.change >= 0 ? 'text-buy' : 'text-sell'}`}>
                {live.change >= 0 ? '+' : ''}{live.change.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* Main grid */}
      <main className="flex-1 p-3 grid gap-3 grid-cols-1 lg:grid-cols-[260px_1fr_300px] xl:grid-cols-[260px_1fr_320px]">
        {/* Left: markets list */}
        <Panel title="Рынки" action={<Icon name="Search" size={14} className="text-muted-foreground" />} className="order-2 lg:order-1 h-[360px] lg:h-auto">
          <div className="overflow-y-auto scrollbar-thin h-full">
            {PAIRS.map((p, i) => {
              const live = getPairData(p);
              return (
                <button
                  key={p.symbol}
                  onClick={() => setSelectedPair(p)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 transition-colors border-b border-border/50 animate-fade-in ${
                    selectedPair.symbol === p.symbol ? 'bg-secondary border-l-2 border-l-primary' : 'hover:bg-secondary/60'
                  }`}
                  style={{ animationDelay: `${i * 40}ms`, opacity: 0 }}
                >
                  <div className="text-left">
                    <div className="text-sm font-medium">{p.symbol}</div>
                    <div className="text-[10px] text-muted-foreground">Vol {live.vol}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-mono-num transition-colors ${live.dir === 'up' ? 'text-buy' : 'text-sell'}`}>
                      {fmtPrice(live.price)}
                    </div>
                    <div className={`text-[11px] font-mono-num ${live.change >= 0 ? 'text-buy' : 'text-sell'}`}>
                      {live.change >= 0 ? '+' : ''}{live.change.toFixed(2)}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Center: chart + orderbook */}
        <div className="order-1 lg:order-2 flex flex-col gap-3 min-h-0">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-bold">{selectedPair.symbol}</span>
                  <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground uppercase">Margin 100x</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono-num text-xl font-semibold transition-colors ${selectedLive.dir === 'up' ? 'text-buy' : 'text-sell'}`}>
                    {fmtPrice(selectedLive.price)}
                  </span>
                  <span className={`font-mono-num text-sm ${selectedLive.change >= 0 ? 'text-buy' : 'text-sell'}`}>
                    {selectedLive.change >= 0 ? '+' : ''}{selectedLive.change.toFixed(2)}%
                  </span>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-1">
                {['15m', '1H', '4H', '1D'].map((tf, i) => (
                  <button key={tf} className={`px-2.5 py-1 rounded text-xs font-mono-num ${i === 1 ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[280px] sm:h-[340px] grid-bg p-2">
              <CandleChart pair={selectedPair} />
            </div>
          </div>
          <Panel title="Стакан ордеров" className="flex-1 min-h-[300px]">
            <OrderBook />
          </Panel>
        </div>

        {/* Right: order form */}
        <Panel title="Маржинальный ордер" action={<Icon name="Settings2" size={14} className="text-muted-foreground" />} className="order-3">
          <OrderForm pair={{ ...selectedPair, livePrice: selectedLive.price }} />
        </Panel>
      </main>

      {/* Bottom: balance + open positions */}
      <section className="px-3 pb-3 grid gap-3 grid-cols-1 lg:grid-cols-[1fr_1fr]">
        <Panel title="Баланс · Кошелёк">
          <div className="grid grid-cols-3 divide-x divide-border">
            {[
              { l: 'Эквити', v: '12,480.00', s: 'USDT' },
              { l: 'В позициях', v: '4,120.50', s: 'USDT' },
              { l: 'PnL за сутки', v: '+318.74', s: 'USDT', pos: true },
            ].map((c) => (
              <div key={c.l} className="px-4 py-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.l}</div>
                <div className={`font-mono-num text-lg font-semibold mt-1 ${c.pos ? 'text-buy' : ''}`}>{c.v}</div>
                <div className="text-[10px] text-muted-foreground">{c.s}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Открытые позиции">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-4 py-2">Пара</th>
                  <th className="text-left font-medium px-2">Плечо</th>
                  <th className="text-right font-medium px-2">Вход</th>
                  <th className="text-right font-medium px-4">PnL</th>
                </tr>
              </thead>
              <tbody className="font-mono-num">
                <tr className="border-b border-border/50">
                  <td className="px-4 py-2.5"><span className="text-buy">LONG</span> BTC/USDT</td>
                  <td className="px-2 text-primary">20x</td>
                  <td className="px-2 text-right">66,810.00</td>
                  <td className="px-4 py-2.5 text-right text-buy">+248.30</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5"><span className="text-sell">SHORT</span> ETH/USDT</td>
                  <td className="px-2 text-primary">10x</td>
                  <td className="px-2 text-right">3,540.20</td>
                  <td className="px-4 py-2.5 text-right text-buy">+70.44</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <footer className="border-t border-border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-muted-foreground shrink-0">
        <span>© 2026 NEXUS Exchange</span>
        <span className="flex items-center gap-1.5"><Icon name="Plug" size={12} /> API котировок · WebSocket / REST</span>
        <span className="flex items-center gap-1.5"><Icon name="Droplets" size={12} /> Агрегация ликвидности 14 провайдеров</span>
        <span className="flex items-center gap-1.5 ml-auto"><Icon name="ShieldCheck" size={12} className="text-primary" /> 2FA активна</span>
      </footer>
    </div>
  );
};

export default Index;