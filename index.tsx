import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Notices } from './components/Shared';
import { bootstrapAccount } from './utils/account';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// Eerst kijken of iemand ingelogd is en zo ja de gegevens van het account ophalen,
// zodat de app direct met de juiste instellingen en het juiste weekmenu start.
// Installeerbaar maken (op het beginscherm zetten). Mislukt dit, dan werkt de app gewoon verder.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

bootstrapAccount().finally(() => {
  root.render(
    <React.StrictMode>
      <App />
      <Notices />
    </React.StrictMode>
  );
});