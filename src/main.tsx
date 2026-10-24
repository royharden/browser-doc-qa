import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppController } from './browser/controller.ts';
import { productionServices } from './browser/wire.ts';
import { App } from './ui/App.tsx';
import './styles.css';

const controller = new AppController(productionServices(null));
void controller.init();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');
createRoot(root).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);

window.addEventListener('pagehide', () => controller.dispose(), { once: true });
