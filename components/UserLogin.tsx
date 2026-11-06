import React, { useState } from 'react';
import { userService } from '../services/userService';
import { AppSettings } from '../types';

interface UserLoginProps {
  onLogin: (user: Awaited<ReturnType<typeof userService.getCurrentUser>>) => void;
  appSettings: AppSettings | null;
}

export const UserLogin: React.FC<UserLoginProps> = ({ onLogin, appSettings }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    if (mode === 'signup' && (name.trim().length < 3 || phone.replace(/\D/g, '').length < 8)) {
      setMessage({ text: 'Informe seu nome e um telefone válido.', error: true });
      setIsLoading(false);
      return;
    }
    if (password.length < 8) {
      setMessage({ text: 'A senha precisa ter pelo menos 8 caracteres.', error: true });
      setIsLoading(false);
      return;
    }

    try {
      if (mode === 'signup') {
        const result = await userService.signUp({ name: name.trim(), phone, email: email.trim(), password });
        if (result.user) onLogin(result.user);
        else setMessage({ text: 'Cadastro criado. Confira seu e-mail para confirmar a conta e depois entre.' });
      } else {
        const user = await userService.signIn(email.trim(), password);
        onLogin(user);
      }
    } catch (err: any) {
      console.error(err);
      const description = String(err?.message || '');
      const friendly = /invalid login credentials/i.test(description)
        ? 'E-mail ou senha incorretos.'
        : /email not authorized/i.test(description)
          ? 'O envio de e-mail ainda não está liberado para este endereço no Supabase.'
          : /email not confirmed/i.test(description)
            ? 'Confirme seu e-mail antes de entrar.'
            : 'Não foi possível conectar ou autenticar. Confira os dados e tente novamente.';
      setMessage({ text: friendly, error: true });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#1D428A] p-4 overflow-y-auto">
      <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md w-full relative my-auto">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-user-circle text-4xl text-nba-blue"></i>
          </div>
          <h2 className="text-2xl font-black text-gray-800 uppercase italic tracking-tighter">
            {mode === 'login' ? 'Entrar' : 'Criar conta'}
          </h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-2">
            {appSettings?.companyName || 'ET Frota'}
          </p>
        </div>

        {message && (
          <div className={`${message.error ? 'bg-red-50 text-nba-red border-red-100' : 'bg-blue-50 text-blue-800 border-blue-100'} p-4 rounded-xl mb-6 text-sm font-bold border flex items-center gap-3`}>
            <i className={`fas ${message.error ? 'fa-exclamation-triangle' : 'fa-envelope'}`}></i>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === 'signup' && <>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
              Seu nome
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Carlos Silva" autoComplete="name" className="mt-2 w-full px-4 py-4 rounded-xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-nba-blue outline-none font-bold text-gray-800" required />
            </label>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
              Seu telefone
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(54) 99999-9999" autoComplete="tel" className="mt-2 w-full px-4 py-4 rounded-xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-nba-blue outline-none font-bold text-gray-800" required />
            </label>
          </>}
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
            E-mail
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" className="mt-2 w-full px-4 py-4 rounded-xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-nba-blue outline-none font-bold text-gray-800" required />
          </label>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
            Senha
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} className="mt-2 w-full px-4 py-4 rounded-xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-nba-blue outline-none font-bold text-gray-800" required />
          </label>
          <button type="submit" disabled={isLoading} className="w-full bg-nba-blue hover:bg-blue-800 text-white font-black py-4 rounded-xl shadow-lg transition-all active:scale-[0.98] uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
            {isLoading ? <i className="fas fa-circle-notch animate-spin"></i> : <><span>{mode === 'login' ? 'Acessar painel' : 'Criar conta'}</span><i className="fas fa-arrow-right"></i></>}
          </button>
        </form>
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(null); }} className="w-full mt-5 text-sm font-bold text-nba-blue hover:underline">
          {mode === 'login' ? 'Primeiro acesso? Criar conta de motorista' : 'Já tem conta? Entrar'}
        </button>
      </div>
    </div>
  );
};
