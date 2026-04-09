import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { showToast } from '../../components/ui/Toast';
import styles from './AuthPage.module.css';

type Mode = 'signin' | 'signup' | 'forgot';

export default function AuthPage() {
  const navigate = useNavigate();
  const { signIn, signUp, signInWithGoogle, signInWithApple, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
      }
      showToast({ text: mode === 'signin' ? 'Welcome back!' : 'Account created!', type: 'success' });
      navigate('/');
    } catch (err: unknown) {
      showToast({ text: (err as Error).message || 'Authentication failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      showToast({ text: (err as Error).message || 'Google sign-in failed', type: 'error' });
    }
  };

  const handleApple = async () => {
    try {
      await signInWithApple();
    } catch (err: unknown) {
      showToast({ text: (err as Error).message || 'Apple sign-in failed', type: 'error' });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { showToast({ text: 'Enter your email first', type: 'error' }); return; }
    setLoading(true);
    try {
      await resetPassword(email);
      showToast({ text: 'Check your email for a reset link', type: 'success' });
      setMode('signin');
    } catch (err: unknown) {
      showToast({ text: (err as Error).message || 'Could not send reset email', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'forgot') {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Reset Password</h1>
          <p className={styles.sub}>Enter your email and we'll send you a reset link</p>
          <form className={styles.form} onSubmit={handleForgotPassword}>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <Button type="submit" fullWidth loading={loading}>
              Send Reset Link
            </Button>
          </form>
          <p className={styles.switch}>
            <button className={styles.switchBtn} onClick={() => setMode('signin')}>
              Back to Sign In
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>
          {mode === 'signin' ? 'Welcome Back' : 'Join Spotd'}
        </h1>
        <p className={styles.sub}>
          {mode === 'signin'
            ? 'Sign in to your account'
            : 'Create an account to start discovering'}
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <Input
              label="Display Name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
            />
          )}
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
          />
          {mode === 'signin' && (
            <button type="button" className={styles.forgotBtn} onClick={() => setMode('forgot')}>
              Forgot password?
            </button>
          )}
          <Button type="submit" fullWidth loading={loading}>
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </Button>
        </form>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <Button variant="google" fullWidth onClick={handleGoogle}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </Button>

        <Button variant="apple" fullWidth onClick={handleApple}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M13.71 5.04c-.076.058-1.427.82-1.412 2.44.016 1.934 1.697 2.617 1.718 2.626-.015.044-.269.92-.888 1.82-.535.776-1.09 1.55-1.965 1.565-.86.016-1.136-.51-2.119-.51s-1.306.494-2.119.526c-.844.03-1.487-.838-2.028-1.612-1.105-1.585-1.95-4.477-.815-6.428.563-.965 1.57-1.577 2.664-1.593.83-.016 1.613.558 2.119.558s1.461-.69 2.463-.59c.42.018 1.597.17 2.353 1.276l.029-.076zm-2.77-2.49c.448-.543.75-1.3.668-2.053-.645.026-1.426.43-1.89.971-.415.48-.779 1.247-.681 1.983.72.056 1.455-.366 1.903-.901z"/>
          </svg>
          Continue with Apple
        </Button>

        <p className={styles.switch}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            className={styles.switchBtn}
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}
