import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import App from './App';
import './index.css';

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
  headings: {
    fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
    fontWeight: '700',
  },
});

const root = document.getElementById('app');

if (!root) {
  throw new Error('找不到应用挂载节点');
}

createRoot(root).render(
  <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="light">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
