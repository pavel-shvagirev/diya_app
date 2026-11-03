import React from 'react';
import ReactDOM from 'react-dom/client';

import { LogView } from '../components/LogView';
import { initTheme } from '../store/themeStore';
import '../styles/themes.css';
import '../styles/app.css';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LogView />
  </React.StrictMode>
);
