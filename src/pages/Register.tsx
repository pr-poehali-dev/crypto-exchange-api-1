import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import Icon from '@/components/ui/icon';
import FortexLogo from '@/components/FortexLogo';

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Пароли не совпадают'); return; }
    setLoading(true);
    const { ok, data } = await api.auth.register({ email: form.email, username: form.username, password: form.password });
    setLoading(false);
    if (!ok) { setError((data as { error: string }).error); return; }
    const d = data as { token: string; user: { id: number; email: string; username: string; is_admin: boolean; kyc_status: string; created_at: string } };
    login(d.token, { ...d.user, balances: [] });
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <FortexLogo size="lg" />
          </div>
          <p className="text-muted-foreground mt-2 text-sm">Создайте аккаунт</p>
        </div>

        <form onSubmit={submit} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-sell/10 border border-sell/30 rounded-lg px-4 py-3 text-sell text-sm flex items-center gap-2">
              <Icon name="AlertCircle" size={16} />
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
              placeholder="user@example.com"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Username</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
              placeholder="trader123"
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
              placeholder="Минимум 8 символов"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Подтвердите пароль</label>
            <input
              type="password"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
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
            {loading ? 'Создаём аккаунт...' : 'Зарегистрироваться'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-primary hover:underline">Войти</Link>
          </p>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Регистрируясь, вы соглашаетесь с условиями использования сервиса
        </p>
      </div>
    </div>
  );
}