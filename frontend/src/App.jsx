/** Solo el editor de diagramas: sin cuentas, sin servidor, todo se descarga. */
import { ToastProvider } from './ToastContext.jsx';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  return (
    <ToastProvider>
      <main className="main-editor">
        <EditorPage />
      </main>
    </ToastProvider>
  );
}
