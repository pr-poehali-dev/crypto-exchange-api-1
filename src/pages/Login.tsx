import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import Icon from '@/components/ui/icon';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { ok, data } = await api.auth.login(form);
    setLoading(false);
    if (!ok) { setError((data as { error: string }).error); return; }
    const d = data as { token: string; user: { id: number; email: string; username: string; is_admin: boolean; kyc_status: string; created_at: string; balances: [] } };
    login(d.token, { ...d.user, balances: [] });
    navigate(d.user.is_admin ? '/admin' : '/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mx-auto mb-4">
            <Icon name="Hexagon" size={24} className="text-background" />
          </div>
          <h1 className="text-2xl font-bold font-display">NEXUS Exchange</h1>
          <p className="text-muted-foreground mt-1 text-sm">Войдите в свой аккаунт</p>
        </div>

        <form onSubmit={submit} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-sell/10 border border-sell/30 rounded-lg px-4 py-3 text-sell text-sm flex items-center gap-2">
              <Icon name="AlertCircle" size={16} />
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Email или Username</label>
            <input
              type="text"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
              placeholder="user@example.com"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Пароль</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-background py-2.5 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Входим...' : 'Войти'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-primary hover:underline">Зарегистрироваться</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
