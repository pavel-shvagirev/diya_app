import React from 'react';
import ReactDOM from 'react-dom/client';

import { initTheme } from '../store/themeStore';
import App from './App';
import '../styles/themes.css';
import '../styles/app.css';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
