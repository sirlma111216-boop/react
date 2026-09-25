import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadAssetIndex } from './lib/assets';
import { audio } from './lib/audio';
import './styles.css';

Promise.all([loadAssetIndex(), audio.init()]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
