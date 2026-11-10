import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { bootstrapAccount } from './utils/account';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// Eerst kijken of iemand ingelogd is en zo ja de gegevens van het account ophalen,
// zodat de app direct met de juiste instellingen en het juiste weekmenu start.
bootstrapAccount().finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});