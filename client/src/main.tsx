import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './theme.css'

/*
 * `retry: false` because the engine is on localhost: a failure means it is not running,
 * and retrying three times only delays the banner that says so.
 *
 * `refetchOnWindowFocus` stays on, since coming back to the window is exactly when a
 * stale list is most annoying, and this is a local request.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 5_000 },
  },
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
