import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { LiveStatsProvider } from './api/useLiveStats.tsx';
import './i18n/index.ts';
import './styles/app.css';
// Legacy styles for pages not yet migrated to Tailwind utilities (removed once
// every page is converted).
import './styles/theme.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { refetchOnWindowFocus: false, staleTime: 30_000 }
    }
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

createRoot(rootEl).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <LiveStatsProvider>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </LiveStatsProvider>
        </QueryClientProvider>
    </StrictMode>
);
