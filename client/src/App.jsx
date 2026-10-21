import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store.jsx';
import Landing from './pages/Landing.jsx';
import Join from './pages/Join.jsx';
import Studio from './pages/Studio.jsx';
import Toasts from './components/Toasts.jsx';

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { state } = useStore();
  return (
    <div className="min-h-full">
      <Routes>
        <Route
          path="/"
          element={
            state.phase === 'loading' ? <Splash /> :
            state.phase === 'studio' ? <Studio /> :
            <Landing />
          }
        />
        <Route
          path="/join/:token?"
          element={<Join />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </div>
  );
}

function Splash() {
  return (
    <div className="min-h-screen grid place-items-center">
      <div className="flex items-center gap-3 text-dim">
        <Logo spin />
        <span className="text-sm">FileBridge</span>
      </div>
    </div>
  );
}

export function Logo({ spin = false, size = 26 }) {
  const style = { width: size, height: size };
  return (
    <svg viewBox="0 0 64 64" style={style} className={spin ? 'animate-spin' : ''} aria-hidden="true">
      <defs>
        <linearGradient id="fbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--fb-accent)" />
          <stop offset="1" stopColor="var(--fb-lav)" />
        </linearGradient>
      </defs>
      <rect x="9" y="20" width="12" height="24" rx="3.5" fill="none" stroke="url(#fbg)" strokeWidth="3.5" />
      <rect x="43" y="20" width="12" height="24" rx="3.5" fill="none" stroke="url(#fbg)" strokeWidth="3.5" />
      <path d="M26 27h12M26 37h12" stroke="url(#fbg)" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 32h4" stroke="var(--fb-ink)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
