import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SystemStatusPage } from './features/system-status/SystemStatusPage';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SystemStatusPage />
  </StrictMode>,
);
