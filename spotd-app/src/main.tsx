import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPush } from './lib/push';
import { initAnalytics } from './lib/analytics';
import './styles/tokens.css';
import './styles/global.css';

initPush();
initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
