/**
 * Editor de diagramas de flujo .
 * Gestiona formas, conexiones, zoom/pan, historial, exportación PDF/PNG.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';

import Icon from '../components/Icon.jsx';
import EditorSidebar from '../components/EditorSidebar';
import { useToast } from '../ToastContext.jsx';
import EditorToolbar from '../components/EditorToolbar';
import EditorSubToolbar from '../components/EditorSubToolbar';
import RenderShape from '../components/RenderShape';

import {
  CANVAS_SIZE,
  DROP_OFFSET,
  SHAPE_SIZE_LIMITS,
  SHAPE_TYPES,
  PALETTE_DRAG_TYPE_KEY,
  createShape,
  duplicateShape,
  bringShapesToFront,
  shapesToMap,
  fitShapeToTextContent,
  parseDiagramContent,
  serializeDiagram,
  emptyDiagramState,
  nextShapeIdFromList,
  initHistoryWithState,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  deleteShapeFromDiagram,
  addShapeToDiagram,
  handleConnectClick,
  removeConnection,
  getConnectionLineFromMap,
  screenToCanvas,
  computeCenterPan,
  computePanForZoomChange,
  clientDeltaToCanvas,
  stepZoomIn,
  stepZoomOut,
  captureDiagramPreview,
  captureDiagramHighRes,
  canvasToPngDataUrl,
  buildInlinePdfDataUrl,
  downloadDiagramPdf,
  getDiagramBounds,
  ShapePreview,
} from '../design';

export default function EditorPage() {
  const { showError, showMessage } = useToast();

  const [shapes, setShapes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [nextId, setNextId] = useState(1);
  const [connectSource, setConnectSource] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const [saveTitle, setSaveTitle] = useState('Mi diagrama');
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [historyStack, setHistoryStack] = useState({ entries: [], index: -1 });
  const [paletteTouchDrag, setPaletteTouchDrag] = useState(null);
  const [paletteDragOverCanvas, setPaletteDragOverCanvas] = useState(false);
  const [draggingShapeIds, setDraggingShapeIds] = useState([]);
  const [connectionDraft, setConnectionDraft] = useState(null);
  const [connectionHandleSides, setConnectionHandleSides] = useState({});

  const canvasRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const paletteDragSessionRef = useRef(null);
  const interactionInProgressRef = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const shapesRef = useRef(shapes);
  const connectionsRef = useRef(connections);
  shapesRef.current = shapes;
  connectionsRef.current = connections;
  const [clipboardShapes, setClipboardShapes] = useState([]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const draggingShapeIdSet = useMemo(() => new Set(draggingShapeIds), [draggingShapeIds]);
  const hasShapeSelection = selectedIds.length > 0;

  const diagramState = useMemo(
    () => ({ shapes, connections }),
    [shapes, connections]
  );

  const shapesById = useMemo(() => shapesToMap(shapes), [shapes]);

  const historyIndex = historyStack.index;

  const isShapeInsideContainer = useCallback((shape) => {
    const containerTypes = new Set([SHAPE_TYPES.WHILE, SHAPE_TYPES.IF, SHAPE_TYPES.FOR]);

    return shapes.some((candidate) => {
      if (candidate.id === shape.id || !containerTypes.has(candidate.type)) return false;

      let content = {
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
      };
      if (candidate.type === SHAPE_TYPES.WHILE) {
        const headerHeight = Math.min(38, candidate.height / 2);
        content = {
          x: candidate.x,
          y: candidate.y + headerHeight,
          width: candidate.width,
          height: Math.max(0, candidate.height - headerHeight),
        };
      } else if (candidate.type === SHAPE_TYPES.IF) {
        const bodyStart = candidate.height * 0.45 + 30;
        content = {
          x: candidate.x,
          y: candidate.y + bodyStart,
          width: candidate.width,
          height: Math.max(0, candidate.height - bodyStart),
        };
      } else if (candidate.type === SHAPE_TYPES.FOR) {
        const armWidth = 65;
        const mainWidth = Math.max(candidate.width - armWidth, candidate.width * 0.72);
        content = {
          x: candidate.x,
          y: candidate.y,
          width: mainWidth,
          height: candidate.height,
        };
      }

      const shapeCenterX = shape.x + shape.width / 2;
      const shapeCenterY = shape.y + shape.height / 2;
      const centerInside = (
        shapeCenterX >= content.x
        && shapeCenterX <= content.x + content.width
        && shapeCenterY >= content.y
        && shapeCenterY <= content.y + content.height
      );

      const overlapX = Math.max(
        0,
        Math.min(content.x + content.width, shape.x + shape.width) - Math.max(content.x, shape.x),
      );
      const overlapY = Math.max(
        0,
        Math.min(content.y + content.height, shape.y + shape.height) - Math.max(content.y, shape.y),
      );
      const overlapArea = overlapX * overlapY;
      const shapeArea = shape.width * shape.height;

      return centerInside && shapeArea > 0 && overlapArea / shapeArea >= 0.35;
    });
  }, [shapes]);

  const getTopConnectionAnchor = useCallback((shape) => {
    if (shape.type === SHAPE_TYPES.FOR) {
      const armWidth = 65;
      const mainWidth = Math.max(shape.width - armWidth, shape.width * 0.72);
      return { x: mainWidth / 2, y: 0 };
    }
    return { x: shape.width / 2, y: 0 };
  }, []);

  const getConnectionAnchor = useCallback((shape, side) => {
    if (side === 'top') {
      return getTopConnectionAnchor(shape);
    }
    if (side === 'left') {
      return { x: 0, y: shape.height / 2 };
    }
    if (side === 'right') {
      return { x: shape.width, y: shape.height / 2 };
    }
    if (shape.type === SHAPE_TYPES.FOR) {
      const armWidth = 65;
      const mainWidth = Math.max(shape.width - armWidth, shape.width * 0.72);
      return { x: mainWidth / 2, y: shape.height };
    }
    return { x: shape.width / 2, y: shape.height };
  }, [getTopConnectionAnchor]);

  const getConnectionHandleSide = useCallback((shape) => {
    return connectionHandleSides[shape.id] || 'bottom';
  }, [connectionHandleSides]);

  const getConnectionHandleStyle = useCallback((shape) => {
    const anchor = getConnectionAnchor(shape, getConnectionHandleSide(shape));
    return {
      '--connection-handle-x': `${anchor.x}px`,
      '--connection-handle-y': `${anchor.y}px`,
    };
  }, [getConnectionAnchor, getConnectionHandleSide]);

  const connectionDraftLine = useMemo(() => {
    if (!connectionDraft) return null;
    const fromShape = shapesById.get(connectionDraft.fromId);
    if (!fromShape) return null;
    const anchor = getConnectionAnchor(fromShape, connectionDraft.fromSide || getConnectionHandleSide(fromShape));
    return {
      x1: fromShape.x + anchor.x,
      y1: fromShape.y + anchor.y,
      x2: connectionDraft.x,
      y2: connectionDraft.y,
    };
  }, [connectionDraft, getConnectionAnchor, getConnectionHandleSide, shapesById]);

  const commitHistory = useCallback((newShapes, newConnections) => {
    const next = pushHistory(
      historyStack,
      { shapes: newShapes, connections: newConnections }
    );
    setHistoryStack(next);
  }, [historyStack]);

  const applyDiagram = useCallback((state) => {
    setShapes(state.shapes);
    setConnections(state.connections);
  }, []);

  const undo = () => {
    const { stack, state } = undoHistory(historyStack);
    if (!state) return;
    setHistoryStack(stack);
    applyDiagram(state);
  };

  const redo = () => {
    const { stack, state } = redoHistory(historyStack);
    if (!state) return;
    setHistoryStack(stack);
    applyDiagram(state);
  };

  const centerView = useCallback(() => {
    if (!canvasWrapperRef.current) return;
    const { clientWidth, clientHeight } = canvasWrapperRef.current;
    if (clientWidth === 0 || clientHeight === 0) {
      setTimeout(centerView, 50);
      return;
    }
    setPan(computeCenterPan(clientWidth, clientHeight, zoomRef.current));
  }, []);


  const applyZoom = useCallback((getNextZoom, focalX, focalY) => {
    setZoom((currentZoom) => {
      const nextZoom = getNextZoom(currentZoom);
      setPan((currentPan) =>
        computePanForZoomChange(currentPan, currentZoom, nextZoom, focalX, focalY)
      );
      return nextZoom;
    });
  }, []);

  const getZoomFocalPoint = () => {
    if (!canvasWrapperRef.current) return { x: 0, y: 0 };
    const { clientWidth, clientHeight } = canvasWrapperRef.current;
    return { x: clientWidth / 2, y: clientHeight / 2 };
  };

  const zoomIn = () => {
    const { x, y } = getZoomFocalPoint();
    applyZoom(stepZoomIn, x, y);
  };

  const zoomOut = () => {
    const { x, y } = getZoomFocalPoint();
    applyZoom(stepZoomOut, x, y);
  };

  const zoomReset = () => {
    if (!canvasWrapperRef.current) {
      setZoom(1);
      return;
    }
    const { clientWidth, clientHeight } = canvasWrapperRef.current;
    setZoom(1);
    setPan(computeCenterPan(clientWidth, clientHeight, 1));
  };

  useEffect(() => {
    centerView();
    const t1 = setTimeout(centerView, 100);
    const t2 = setTimeout(centerView, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [centerView, sidebarOpen]);

  useEffect(() => {
    setHistoryStack(initHistoryWithState(emptyDiagramState()));
  }, []);

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = wrapper.getBoundingClientRect();
        const focalX = e.clientX - rect.left;
        const focalY = e.clientY - rect.top;
        const step = e.deltaY < 0 ? stepZoomIn : stepZoomOut;
        setZoom((z) => {
          const next = step(z);
          setPan((p) => computePanForZoomChange(p, z, next, focalX, focalY));
          return next;
        });
        return;
      }
      e.preventDefault();
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    };
    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement?.contentEditable === 'true') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
        if (e.key === 'c') { e.preventDefault(); handleCopySelected(); }
        if (e.key === 'v') { e.preventDefault(); handlePasteClipboard(); }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedConnectionId) {
          handleDeleteConnection(selectedConnectionId);
        } else if (selectedIds.length > 0) {
          handleDeleteSelectedShapes();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, selectedConnectionId, historyStack, shapes, connections]);

  const handleDeleteSelectedShapes = () => {
    if (selectedIds.length === 0) return;
    let nextState = diagramState;
    for (const shapeId of selectedIds) {
      nextState = deleteShapeFromDiagram(nextState, shapeId);
    }
    setShapes(nextState.shapes);
    setConnections(nextState.connections);
    commitHistory(nextState.shapes, nextState.connections);
    setSelectedIds([]);
  };

  const handleCopySelected = () => {
    if (selectedIds.length === 0) return;
    const copied = selectedIds
      .map((id) => shapesById.get(id))
      .filter(Boolean)
      .map((shape) => ({ ...shape }));
    if (copied.length > 0) setClipboardShapes(copied);
  };

  const handlePasteClipboard = () => {
    if (clipboardShapes.length === 0) return;
    let idCounter = nextId;
    const pasted = clipboardShapes.map((shape) =>
      duplicateShape(shape, { x: 24, y: 24 }, idCounter++),
    );
    const nextShapes = [...shapes, ...pasted];
    setShapes(nextShapes);
    commitHistory(nextShapes, connections);
    setSelectedIds(pasted.map((shape) => shape.id));
    setNextId((v) => Math.max(v, idCounter));
  };

  /** Copia las formas seleccionadas y las pega desplazadas; si hay portapapeles, pega ese. */
  const handleCopyPaste = () => {
    if (selectedIds.length > 0) {
      let idCounter = nextId;
      const pasted = selectedIds
        .map((id) => shapesById.get(id))
        .filter(Boolean)
        .map((original) => duplicateShape(original, { x: 24, y: 24 }, idCounter++));
      if (pasted.length === 0) return;
      setClipboardShapes(
        selectedIds.map((id) => shapesById.get(id)).filter(Boolean).map((shape) => ({ ...shape })),
      );
      const nextShapes = [...shapes, ...pasted];
      setShapes(nextShapes);
      commitHistory(nextShapes, connections);
      setSelectedIds(pasted.map((shape) => shape.id));
      setNextId((v) => Math.max(v, idCounter));
      return;
    }
    handlePasteClipboard();
  };

  const handleDeleteConnection = (connectionId) => {
    const nextConnections = removeConnection(connections, connectionId);
    setConnections(nextConnections);
    commitHistory(shapes, nextConnections);
    if (selectedConnectionId === connectionId) setSelectedConnectionId(null);
  };

  const handleDeleteSelected = () => {
    if (selectedConnectionId) {
      handleDeleteConnection(selectedConnectionId);
    } else if (selectedIds.length > 0) {
      handleDeleteSelectedShapes();
    }
  };

  const selectConnection = (event, connectionId) => {
    event.stopPropagation();
    setSelectedConnectionId(connectionId);
    setSelectedIds([]);
    setConnectSource(null);
  };

  const handleBringToFront = () => {
    if (selectedIds.length === 0) return;
    const nextShapes = bringShapesToFront(shapes, selectedIds);
    if (nextShapes === shapes) return;
    setShapes(nextShapes);
    commitHistory(nextShapes, connections);
  };

  const handleShapeTextChange = useCallback((shapeId, title, textElement) => {
    setShapes((current) =>
      current.map((item) => {
        if (item.id !== shapeId) return item;
        const size = fitShapeToTextContent(item, textElement);
        return {
          ...item,
          title,
          width: size.width,
          height: size.height,
        };
      }),
    );
  }, []);

  const handleShapeTextCommit = useCallback(() => {
    commitHistory(shapesRef.current, connectionsRef.current);
  }, [commitHistory]);

  const placeShapeAt = (type, clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = screenToCanvas(clientX, clientY, rect, zoom, DROP_OFFSET);
    const newShape = createShape(type, x, y, nextId);
    const next = addShapeToDiagram(diagramState, newShape);
    setShapes(next.shapes);
    commitHistory(next.shapes, next.connections);
    setNextId((v) => v + 1);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(PALETTE_DRAG_TYPE_KEY);
    if (!type || type === SHAPE_TYPES.CONNECT) return;
    placeShapeAt(type, event.clientX, event.clientY);
  };

  const PALETTE_DRAG_THRESHOLD = 6;

  const endPaletteDragSession = useCallback(() => {
    const session = paletteDragSessionRef.current;
    if (!session) return;
    window.removeEventListener('touchmove', session.onMove);
    window.removeEventListener('touchend', session.onEnd);
    window.removeEventListener('touchcancel', session.onEnd);
    window.removeEventListener('mousemove', session.onMove);
    window.removeEventListener('mouseup', session.onEnd);
    paletteDragSessionRef.current = null;
    setPaletteTouchDrag(null);
    setPaletteDragOverCanvas(false);
  }, []);

  useEffect(() => () => endPaletteDragSession(), [endPaletteDragSession]);

  const handlePaletteDragStart = (event, type, onPlaced) => {
    if (type === SHAPE_TYPES.CONNECT) return;

    const isTouch = event.type === 'touchstart';
    const startPoint = isTouch ? event.touches?.[0] : event;
    if (!startPoint) return;

    if (!isTouch && event.button !== 0) return;

    event.stopPropagation();
    if (!isTouch) event.preventDefault();

    endPaletteDragSession();

    const startX = startPoint.clientX;
    const startY = startPoint.clientY;
    let dragging = false;

    const isOverCanvas = (clientX, clientY) => {
      const canvas = canvasWrapperRef.current;
      if (!canvas) return false;
      const target = document.elementFromPoint(clientX, clientY);
      return target && (canvas === target || canvas.contains(target));
    };

    const onMove = (moveEvent) => {
      if (!paletteDragSessionRef.current) return;

      const point = isTouch
        ? moveEvent.touches[0]
        : moveEvent;
      if (!point) return;

      if (isTouch && moveEvent.cancelable) moveEvent.preventDefault();

      const dx = point.clientX - startX;
      const dy = point.clientY - startY;

      if (!dragging) {
        if (Math.hypot(dx, dy) < PALETTE_DRAG_THRESHOLD) return;
        dragging = true;
      }

      setPaletteTouchDrag({ type, x: point.clientX, y: point.clientY });
      setPaletteDragOverCanvas(isOverCanvas(point.clientX, point.clientY));
    };

    const onEnd = (endEvent) => {
      const placedType = paletteDragSessionRef.current?.type;
      const wasDragging = dragging;
      endPaletteDragSession();

      if (!wasDragging || !placedType) return;

      const endPoint = isTouch ? endEvent.changedTouches[0] : endEvent;
      if (!endPoint) return;

      if (isOverCanvas(endPoint.clientX, endPoint.clientY)) {
        placeShapeAt(placedType, endPoint.clientX, endPoint.clientY);
        onPlaced?.();
      }
    };

    paletteDragSessionRef.current = { type, onMove, onEnd };
    if (isTouch) {
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('touchcancel', onEnd);
    } else {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
    }
  };

  const handlePaletteTapPlace = (type) => {
    placeShapeAt(type, window.innerWidth / 2, window.innerHeight / 2);
  };

  const getCanvasPoint = (clientX, clientY) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return screenToCanvas(clientX, clientY, rect, zoom, { x: 0, y: 0 });
  };

  const findShapeElementAtPoint = (clientX, clientY) => {
    const target = document.elementFromPoint(clientX, clientY);
    return target?.closest('.shape-element') ?? null;
  };

  const findShapeIdAtPoint = (clientX, clientY) => {
    return findShapeElementAtPoint(clientX, clientY)?.dataset.shapeId ?? null;
  };

  const getNearestHandleSide = (shape, clientX, clientY, element) => {
    const rect = element.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const distances = [
      ['top', y],
      ['right', rect.width - x],
      ['bottom', rect.height - y],
      ['left', x],
    ];

    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  };

  const handleShapeMouseMove = (event, shape) => {
    const side = getNearestHandleSide(shape, event.clientX, event.clientY, event.currentTarget);
    setConnectionHandleSides((current) => (
      current[shape.id] === side ? current : { ...current, [shape.id]: side }
    ));
  };

  const handleConnectionDragStart = (event, shape) => {
    const isTouch = event.type === 'touchstart';
    const point = isTouch ? event.touches?.[0] : event;
    if (!point) return;
    if (!isTouch && event.button !== 0) return;

    event.stopPropagation();
    if (event.cancelable) event.preventDefault();

    const startPoint = getCanvasPoint(point.clientX, point.clientY);
    const fromSide = getConnectionHandleSide(shape);
    setSelectedIds([shape.id]);
    setSelectedConnectionId(null);
    setConnectSource(shape.id);
    setConnectionDraft(startPoint ? { fromId: shape.id, fromSide, ...startPoint } : null);

    const onMove = (moveEvent) => {
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const movePoint = isTouch ? moveEvent.touches?.[0] : moveEvent;
      if (!movePoint) return;
      const canvasPoint = getCanvasPoint(movePoint.clientX, movePoint.clientY);
      if (canvasPoint) setConnectionDraft({ fromId: shape.id, fromSide, ...canvasPoint });
    };

    const onEnd = (endEvent) => {
      const endPoint = isTouch ? endEvent.changedTouches?.[0] : endEvent;
      setConnectionDraft(null);
      setConnectSource(null);

      if (endPoint) {
        const targetElement = findShapeElementAtPoint(endPoint.clientX, endPoint.clientY);
        const targetId = targetElement?.dataset.shapeId ?? null;
        if (targetId && String(targetId) !== String(shape.id)) {
          const parsedTargetId = Number(targetId);
          const targetShapeId = Number.isNaN(parsedTargetId) ? targetId : parsedTargetId;
          const targetShape = shapesById.get(targetShapeId) || shapesById.get(String(targetShapeId));
          const toSide = targetShape && targetElement
            ? getNearestHandleSide(targetShape, endPoint.clientX, endPoint.clientY, targetElement)
            : undefined;
          const result = handleConnectClick(connections, shape.id, targetShapeId, { fromSide, toSide });
          setConnections(result.connections);
          if (result.message) showMessage(result.message);
          if (result.created || result.removed) {
            commitHistory(shapes, result.connections);
          }
        }
      }

      if (isTouch) {
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
      } else {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
      }
    };

    if (isTouch) {
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('touchcancel', onEnd);
    } else {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
    }
  };

  const handleShapeTouchStart = (event, shape) => {
    handleTouchStartShape(event, shape);
  };

  const handleMouseDown = (event, shape) => {
    if (event.target.closest('.resize-handle') || event.target.closest('.connection-handle')) return;
    event.stopPropagation();
    interactionInProgressRef.current = true;

    const isMultiToggle = event.ctrlKey || event.metaKey;

    if (isMultiToggle) {
      setSelectedIds((prev) =>
        prev.includes(shape.id) ? prev.filter((id) => id !== shape.id) : [...prev, shape.id],
      );
      setSelectedConnectionId(null);
      return;
    }

    const idsToMove = selectedIdSet.has(shape.id) ? [...selectedIds] : [shape.id];
    if (!selectedIdSet.has(shape.id)) {
      setSelectedIds([shape.id]);
    }
    setSelectedConnectionId(null);

    const startX = event.clientX;
    const startY = event.clientY;
    const initialPositions = new Map(
      idsToMove.map((id) => [id, { ...(shapesById.get(id) || {}) }]),
    );
    let isDragging = false;

    const onMouseMove = (moveEvent) => {
      const dx = clientDeltaToCanvas(moveEvent.clientX - startX, zoom);
      const dy = clientDeltaToCanvas(moveEvent.clientY - startY, zoom);
      if (!isDragging && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        isDragging = true;
        setDraggingShapeIds(idsToMove);
      }
      setShapes((current) => {
        const next = current.map((item) => {
          const initial = initialPositions.get(item.id);
          if (!initial) return item;
          return { ...item, x: initial.x + dx, y: initial.y + dy };
        });
        shapesRef.current = next;
        return next;
      });
    };
    const onMouseUp = () => {
      setDraggingShapeIds([]);
      commitHistory(shapesRef.current, connectionsRef.current);
      interactionInProgressRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleTouchStartShape = (event, shape) => {
    if (event.target.closest('.resize-handle') || event.target.closest('.connection-handle')) return;
    if (event.target.closest('.editable-text')) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    interactionInProgressRef.current = true;
    setSelectedIds([shape.id]);
    setSelectedConnectionId(null);
    const touch = event.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;
    const initial = { ...shape };
    let isDragging = false;

    const onTouchMove = (moveEvent) => {
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const moveTouch = moveEvent.touches[0];
      const dx = clientDeltaToCanvas(moveTouch.clientX - startX, zoom);
      const dy = clientDeltaToCanvas(moveTouch.clientY - startY, zoom);
      if (!isDragging && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        isDragging = true;
        setDraggingShapeIds([shape.id]);
      }
      setShapes((current) => {
        const next = current.map((item) =>
          item.id === shape.id ? { ...item, x: initial.x + dx, y: initial.y + dy } : item,
        );
        shapesRef.current = next;
        return next;
      });
    };
    const cleanup = () => {
      setDraggingShapeIds([]);
      commitHistory(shapesRef.current, connectionsRef.current);
      interactionInProgressRef.current = false;
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
    };
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', cleanup);
    window.addEventListener('touchcancel', cleanup);
  };

  const handleResizeMouseDown = (event, shape) => {
    event.stopPropagation();
    event.preventDefault();
    interactionInProgressRef.current = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = shape.width;
    const startHeight = shape.height;

    const onMouseMove = (moveEvent) => {
      const dx = clientDeltaToCanvas(moveEvent.clientX - startX, zoom);
      const dy = clientDeltaToCanvas(moveEvent.clientY - startY, zoom);
      setShapes((current) => {
        const next = current.map((item) =>
          item.id === shape.id
            ? {
                ...item,
                width: Math.max(SHAPE_SIZE_LIMITS.minWidth, startWidth + dx),
                height: Math.max(SHAPE_SIZE_LIMITS.minHeight, startHeight + dy),
              }
            : item
        );
        shapesRef.current = next;
        return next;
      });
    };
    const onMouseUp = () => {
      commitHistory(shapesRef.current, connectionsRef.current);
      interactionInProgressRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleResizeTouchStart = (event, shape) => {
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    interactionInProgressRef.current = true;
    const touch = event.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;
    const startWidth = shape.width;
    const startHeight = shape.height;

    const onTouchMove = (moveEvent) => {
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const moveTouch = moveEvent.touches[0];
      const dx = clientDeltaToCanvas(moveTouch.clientX - startX, zoom);
      const dy = clientDeltaToCanvas(moveTouch.clientY - startY, zoom);
      setShapes((current) => {
        const next = current.map((item) =>
          item.id === shape.id
            ? {
                ...item,
                width: Math.max(SHAPE_SIZE_LIMITS.minWidth, startWidth + dx),
                height: Math.max(SHAPE_SIZE_LIMITS.minHeight, startHeight + dy),
              }
            : item
        );
        shapesRef.current = next;
        return next;
      });
    };
    const onTouchEnd = () => {
      commitHistory(shapesRef.current, connectionsRef.current);
      interactionInProgressRef.current = false;
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  };

  const handleClear = () => {
    const empty = emptyDiagramState();
    setShapes(empty.shapes);
    setConnections(empty.connections);
    setSelectedIds([]);
    setConnectSource(null);
    centerView();
  };

  const handleExportPDF = async () => {
    if (!canvasRef.current) return;
    showMessage('Generando PDF...');
    try {
      const pdfCanvas = await captureDiagramHighRes(canvasRef.current, shapes);
      await downloadDiagramPdf(pdfCanvas, shapes, saveTitle || 'diagrama');
      showMessage('PDF descargado');

    } catch (err) {
      console.error('Error PDF:', err);
      showError('Error al generar el PDF');
    }
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    html2canvas(canvasRef.current, { backgroundColor: '#ffffff', scale: 2 }).then((canvas) => {
      const link = document.createElement('a');
      link.download = `${saveTitle || 'diagrama'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  };

  const isCanvasBackgroundTarget = (target) =>
    target.classList.contains('editor-canvas-fs')
    || target.classList.contains('canvas-zoom-layer')
    || target.classList.contains('canvas-bg')
    || target.classList.contains('canvas-hint');

  const shouldClearCanvasSelection = (target) => {
    if (!(target instanceof Element)) return false;
    if (target.closest('.shape-element')) return false;
    if (target.closest('.connection-group')) return false;
    return true;
  };

  const handleCanvasMouseDown = (e) => {
    if (!isCanvasBackgroundTarget(e.target)) return;
    setSelectedIds([]);
    setSelectedConnectionId(null);
    setConnectSource(null);
    setIsPanning(true);
    const startX = e.clientX - pan.x;
    const startY = e.clientY - pan.y;
    const onMouseMove = (moveEvent) => {
      setPan({ x: moveEvent.clientX - startX, y: moveEvent.clientY - startY });
    };
    const onMouseUp = () => {
      setIsPanning(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleCanvasTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    if (!isCanvasBackgroundTarget(e.target)) return;
    setSelectedIds([]);
    setSelectedConnectionId(null);
    setConnectSource(null);
    setIsPanning(true);
    const touch = e.touches[0];
    const startX = touch.clientX - pan.x;
    const startY = touch.clientY - pan.y;
    const onTouchMove = (moveEvent) => {
      if (moveEvent.touches.length !== 1) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const moveTouch = moveEvent.touches[0];
      setPan({ x: moveTouch.clientX - startX, y: moveTouch.clientY - startY });
    };
    const cleanup = () => {
      setIsPanning(false);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
    };
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', cleanup);
    window.addEventListener('touchcancel', cleanup);
  };

  return (
    <div
      className={`editor-fullscreen figma-editor${paletteTouchDrag ? ' is-palette-dragging' : ''}`}
      id="editor-page"
    >
      <EditorSidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        onPaletteDragStart={handlePaletteDragStart}
        onPaletteTapPlace={handlePaletteTapPlace}
        renderPreview={(type) => <ShapePreview type={type} />}
      />

      <div className="editor-main-fs figma-editor-main">
        <div className="figma-editor-panel">
          <div className="figma-editor-panel-head">
            <EditorToolbar
              saveTitle={saveTitle}
              setSaveTitle={setSaveTitle}
              handleClear={handleClear}
              handleExport={handleExport}
              handleExportPDF={handleExportPDF}
            />
          </div>

          <EditorSubToolbar
            zoom={zoom}
            zoomIn={zoomIn}
            zoomOut={zoomOut}
            zoomReset={zoomReset}
            handleClear={handleClear}
            undo={undo}
            redo={redo}
            canUndo={canUndo(historyStack)}
            canRedo={canRedo(historyStack)}
            onBringToFront={handleBringToFront}
            onCopyPaste={handleCopyPaste}
            onDelete={handleDeleteSelected}
            canBringToFront={hasShapeSelection}
            canCopyPaste={hasShapeSelection || clipboardShapes.length > 0}
            canDelete={hasShapeSelection || !!selectedConnectionId}
          />

          <div className="figma-editor-canvas-area">
        <div
          className={`editor-canvas-fs figma-canvas-panel ${isPanning ? 'panning' : ''} ${paletteTouchDrag ? 'palette-touch-active' : ''} ${paletteDragOverCanvas ? 'palette-drop-target' : ''}`}
          ref={canvasWrapperRef}
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
          onClick={(event) => {
            if (!shouldClearCanvasSelection(event.target)) return;
            setSelectedIds([]);
            setSelectedConnectionId(null);
            setConnectSource(null);
          }}
          onMouseDown={handleCanvasMouseDown}
          onTouchStart={handleCanvasTouchStart}
        >
          <div
            ref={canvasRef}
            className="canvas-zoom-layer"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: `${CANVAS_SIZE.width}px`,
              height: `${CANVAS_SIZE.height}px`,
              position: 'relative',
            }}
          >
            <svg
              id="connections-layer"
              className="connection-layer"
              width={CANVAS_SIZE.width}
              height={CANVAS_SIZE.height}
              viewBox={`0 0 ${CANVAS_SIZE.width} ${CANVAS_SIZE.height}`}
              aria-hidden="true"
            >
              {connections.map((connection) => {
                const line = getConnectionLineFromMap(connection, shapesById);
                if (!line) return null;
                const isSelected = selectedConnectionId === connection.id;
                return (
                  <g
                    key={connection.id}
                    className={`connection-group${isSelected ? ' selected' : ''}`}
                    onClick={(event) => selectConnection(event, connection.id)}
                    onMouseDown={(event) => selectConnection(event, connection.id)}
                    onTouchStart={(event) => selectConnection(event, connection.id)}
                  >
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      className="connection-line-hit"
                    />
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      className="connection-line"
                    />
                  </g>
                );
              })}
              {connectionDraftLine && (
                <line
                  x1={connectionDraftLine.x1}
                  y1={connectionDraftLine.y1}
                  x2={connectionDraftLine.x2}
                  y2={connectionDraftLine.y2}
                  className="connection-draft-line"
                />
              )}
            </svg>
            {shapes.length === 0 && (
              <div className="canvas-bg">
                <p className="canvas-hint">Arrastra formas aquí para comenzar a editar</p>
              </div>
            )}

            {shapes.map((shape) => (
              <div
                key={shape.id}
                data-shape-id={shape.id}
                className={`shape-element ${selectedIdSet.has(shape.id) ? 'selected' : ''} ${connectSource === shape.id ? 'connect-source' : ''} ${draggingShapeIdSet.has(shape.id) ? 'is-dragging' : ''}`}
                style={{ left: shape.x, top: shape.y, width: shape.width, height: shape.height }}
                onMouseMove={(event) => handleShapeMouseMove(event, shape)}
                onMouseDown={(event) => handleMouseDown(event, shape)}
                onTouchStart={(event) => handleShapeTouchStart(event, shape)}
              >
                <RenderShape
                  shape={shape}
                  onTextChange={(title, textElement) => handleShapeTextChange(shape.id, title, textElement)}
                  onTextCommit={handleShapeTextCommit}
                />
                {(selectedIdSet.has(shape.id) || connectSource === shape.id) && (
                  <button
                    type="button"
                    className="connection-handle"
                    style={getConnectionHandleStyle(shape)}
                    title="Arrastrar para conectar"
                    aria-label={`Arrastrar para conectar ${shape.title || 'componente'}`}
                    onMouseDown={(event) => handleConnectionDragStart(event, shape)}
                    onTouchStart={(event) => handleConnectionDragStart(event, shape)}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
                {selectedIds.length === 1 && selectedIdSet.has(shape.id) && (
                  <div
                    className="resize-handle"
                    onMouseDown={(e) => handleResizeMouseDown(e, shape)}
                    onTouchStart={(e) => handleResizeTouchStart(e, shape)}
                    title="Redimensionar"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        </div>
        </div>
      </div>

      {paletteTouchDrag && (
        <div
          className="palette-touch-drag-ghost"
          style={{
            left: paletteTouchDrag.x,
            top: paletteTouchDrag.y,
          }}
          aria-hidden
        >
          <div className="palette-touch-drag-ghost-inner">
            <ShapePreview type={paletteTouchDrag.type} />
          </div>
        </div>
      )}

    </div>
  );
}
