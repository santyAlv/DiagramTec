/** Barra superior del editor: título y descarga (PDF / PNG). */
import Icon from './Icon';

export default function EditorToolbar({ saveTitle, setSaveTitle, handleExport, handleExportPDF }) {
  return (
    <div className="editor-toolbar-fs figma-editor-toolbar">
      <div className="toolbar-left-fs">
        <input
          type="text"
          className="toolbar-title-input figma-toolbar-title"
          value={saveTitle}
          onChange={(e) => setSaveTitle(e.target.value)}
          placeholder="Mi diagrama"
          id="editor-title-input"
        />
      </div>

      <div className="toolbar-right-fs">
        <div className="toolbar-actions-group figma-toolbar-actions">
          <button type="button" className="btn btn-primary figma-btn-save figma-btn-pdf" onClick={handleExport} id="btn-export-png">
            <Icon name="download" size={18} /> PNG
          </button>
          <button type="button" className="btn btn-primary figma-btn-save figma-btn-pdf" onClick={handleExportPDF} id="btn-export-pdf">
            <Icon name="download" size={18} /> PDF
          </button>
        </div>
      </div>
    </div>
  );
}
