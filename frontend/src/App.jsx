/** Inicio (con Sobre nosotros) y editor de diagramas. Sin cuentas ni servidor: todo se descarga. */
import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { ToastProvider } from './ToastContext.jsx';
import HomePage from './pages/HomePage.jsx';
import EditorPage from './pages/EditorPage.jsx';

function AppShell() {
  const isEditor = useLocation().pathname.startsWith('/editor');
  return (
    <div className="app-shell">
      <header className="app-header figma-header">
        <div className="figma-header-inner">
          <div className="figma-header-logo">
            <Link to="/" className="brand figma-brand" aria-label="DiagramTec — Inicio">
              <img src="/logo.png" alt="DiagramTec" className="brand-logo" />
            </Link>
          </div>
          <nav className="figma-nav" aria-label="Principal">
            <NavLink to="/" end>Inicio</NavLink>
            <span className="figma-nav-divider" aria-hidden />
            <NavLink to="/editor">Editor</NavLink>
          </nav>
        </div>
      </header>
      <main className={isEditor ? 'main-editor' : 'main-figma'}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="*" element={<EditorPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ToastProvider>
  );
}
