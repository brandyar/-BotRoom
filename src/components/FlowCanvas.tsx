import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Expand,
  Focus,
  GitBranch,
  HelpCircle,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Minimize2,
  Plus,
  Save,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  Unlink,
  UserCheck,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FlowDefinition, FlowNode, NodeType } from '../types/bot.ts';
import type { FlowValidationReport } from '../utils/flowValidator.ts';
import { toPersianDigits } from '../utils/jalali.ts';

export type EdgeKind =
  | { type: 'next'; sourceNodeId: string }
  | { type: 'button'; sourceNodeId: string; buttonId: string }
  | { type: 'condition_true'; sourceNodeId: string }
  | { type: 'condition_false'; sourceNodeId: string }
  | { type: 'survey_low'; sourceNodeId: string };

interface CanvasEdge {
  id: string;
  kind: EdgeKind;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  color: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

interface FlowCanvasProps {
  flow: FlowDefinition;
  selectedNodeId: string;
  validation: FlowValidationReport;
  onSelectNode: (nodeId: string) => void;
  onUpdateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  onConnectEdge: (kind: EdgeKind, targetNodeId: string) => void;
  onDisconnectEdge: (kind: EdgeKind) => void;
  onDeleteNode: (nodeId: string) => void;
  onAutoLayout: () => void;
}

const NODE_WIDTH = 236;
const DEFAULT_NODE_HEIGHT = 116;

const NODE_TYPE_TITLES: Record<NodeType, string> = {
  trigger: 'دستور شروع',
  message: 'ارسال پیام',
  question: 'دریافت ورودی',
  condition: 'شرط و انشعاب',
  delay: 'تاخیر و پیگیری',
  tag_contact: 'برچسب مشتری',
  update_contact: 'پروفایل CRM',
  save_form: 'ثبت فرم',
  catalog_browser: 'کاتالوگ محصول',
  survey_node: 'نظرسنجی بله',
  booking_node: 'نوبت‌دهی شمسی',
};

const NODE_HEADER_STYLES: Record<NodeType, string> = {
  trigger: 'bg-amber-50 border-amber-200/70',
  message: 'bg-emerald-50/70 border-emerald-200/60',
  question: 'bg-sky-50/80 border-sky-200/70',
  condition: 'bg-slate-100 border-slate-200',
  delay: 'bg-amber-50/70 border-amber-200/60',
  tag_contact: 'bg-emerald-50/60 border-emerald-200/60',
  update_contact: 'bg-emerald-50/60 border-emerald-200/60',
  save_form: 'bg-emerald-50 border-emerald-200/70',
  catalog_browser: 'bg-sky-50 border-sky-200/80',
  survey_node: 'bg-amber-50/80 border-amber-200/70',
  booking_node: 'bg-emerald-50/80 border-emerald-200/80',
};

function getNodeIcon(type: NodeType) {
  switch (type) {
    case 'trigger':
      return <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
    case 'message':
      return <MessageSquare className="w-3.5 h-3.5 text-emerald-700 shrink-0" />;
    case 'question':
      return <HelpCircle className="w-3.5 h-3.5 text-sky-700 shrink-0" />;
    case 'condition':
      return <GitBranch className="w-3.5 h-3.5 text-slate-700 shrink-0" />;
    case 'delay':
      return <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />;
    case 'tag_contact':
      return <Tag className="w-3.5 h-3.5 text-emerald-700 shrink-0" />;
    case 'update_contact':
      return <UserCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />;
    case 'save_form':
      return <Save className="w-3.5 h-3.5 text-emerald-700 shrink-0" />;
    case 'catalog_browser':
      return <ShoppingBag className="w-3.5 h-3.5 text-sky-700 shrink-0" />;
    case 'survey_node':
      return <Star className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
    case 'booking_node':
      return <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0" />;
  }
}

function getFallbackPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 1100 - col * 340, y: 80 + row * 230 };
}

export function FlowCanvas({
  flow,
  selectedNodeId,
  validation,
  onSelectNode,
  onUpdateNodePosition,
  onConnectEdge,
  onDisconnectEdge,
  onDeleteNode,
  onAutoLayout,
}: FlowCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(0.92);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [viewportSize, setViewportSize] = useState({ width: 820, height: 640 });
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [draggingNode, setDraggingNode] = useState<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  const [panningCanvas, setPanningCanvas] = useState<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const [connectingFrom, setConnectingFrom] = useState<{
    kind: EdgeKind;
    startX: number;
    startY: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const nodeIssueMap = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number; firstMsg: string }>();
    for (const issue of validation.issues) {
      if (!issue.nodeId) continue;
      const cur = map.get(issue.nodeId) || { errors: 0, warnings: 0, firstMsg: issue.message };
      if (issue.severity === 'error') cur.errors += 1;
      else cur.warnings += 1;
      map.set(issue.nodeId, cur);
    }
    return map;
  }, [validation.issues]);

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    flow.nodes.forEach((node, idx) => {
      map.set(node.id, node.position || getFallbackPosition(idx));
    });
    return map;
  }, [flow.nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  const latestNodesRef = useRef<FlowNode[]>(flow.nodes);
  latestNodesRef.current = flow.nodes;

  const focusStartNode = useCallback(
    (targetZoom = 0.92) => {
      const nodes = latestNodesRef.current;
      if (nodes.length === 0) return;

      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const vw = rect && rect.width > 50 ? rect.width : viewportSize.width;
      const vh = rect && rect.height > 50 ? rect.height : viewportSize.height;

      const startNode =
        nodes.find((n) => n.id === flow.startNodeId) ||
        nodes.find((n) => n.type === 'trigger') ||
        nodes[0];
      const pos = startNode.position || { x: 80, y: 80 };

      // Align start node near the right side of the canvas so RTL flow unfolds naturally to the left
      const nextPanX = Math.round(vw - (pos.x + NODE_WIDTH + 48) * targetZoom);
      const nextPanY = Math.round(vh / 2 - (pos.y + 60) * targetZoom);

      setZoom(targetZoom);
      setPan({ x: nextPanX, y: nextPanY });
    },
    [flow.startNodeId, viewportSize.width, viewportSize.height]
  );

  const fitView = useCallback(
    (overrideNodes?: FlowNode[]) => {
      const nodes = overrideNodes || latestNodesRef.current;
      if (nodes.length === 0) return;

      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const vw = rect && rect.width > 50 ? rect.width : viewportSize.width;
      const vh = rect && rect.height > 50 ? rect.height : viewportSize.height;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      nodes.forEach((node, idx) => {
        const pos = node.position || getFallbackPosition(idx);
        const h = nodeHeights[node.id] || DEFAULT_NODE_HEIGHT;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + NODE_WIDTH);
        maxY = Math.max(maxY, pos.y + h);
      });

      const padX = 48;
      const padTop = 68;
      const padBottom = 48;
      const graphW = Math.max(180, maxX - minX);
      const graphH = Math.max(140, maxY - minY);

      const availW = Math.max(160, vw - padX * 2);
      const availH = Math.max(160, vh - padTop - padBottom);

      const nextZoom = Number(
        Math.max(0.15, Math.min(1.05, Math.min(availW / graphW, availH / graphH))).toFixed(2)
      );

      const nextPanX = Math.round((vw - graphW * nextZoom) / 2 - minX * nextZoom);
      const nextPanY = Math.round(padTop + (availH - graphH * nextZoom) / 2 - minY * nextZoom);

      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    },
    [nodeHeights, viewportSize.width, viewportSize.height]
  );

  // Focus cleanly on start node at readable 92% zoom on mount or flow change
  const lastFlowStartRef = useRef<string>('');
  useEffect(() => {
    const signature = `${flow.startNodeId}:${flow.nodes.length}`;
    if (viewportSize.width > 100 && flow.nodes.length > 0 && lastFlowStartRef.current !== signature) {
      lastFlowStartRef.current = signature;
      requestAnimationFrame(() => focusStartNode(0.92));
    }
  }, [viewportSize.width, flow.startNodeId, flow.nodes.length, focusStartNode]);

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      if (draggingNode) {
        const dx = (e.clientX - draggingNode.startClientX) / zoom;
        const dy = (e.clientY - draggingNode.startClientY) / zoom;
        onUpdateNodePosition(draggingNode.nodeId, {
          x: Math.round(draggingNode.startPosX + dx),
          y: Math.round(draggingNode.startPosY + dy),
        });
      } else if (panningCanvas) {
        const dx = e.clientX - panningCanvas.startClientX;
        const dy = e.clientY - panningCanvas.startClientY;
        setPan({
          x: Math.round(panningCanvas.startPanX + dx),
          y: Math.round(panningCanvas.startPanY + dy),
        });
      } else if (connectingFrom && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left - pan.x) / zoom;
        const canvasY = (e.clientY - rect.top - pan.y) / zoom;
        setConnectingFrom((prev) => (prev ? { ...prev, mouseX: canvasX, mouseY: canvasY } : null));
      }
    }

    function handlePointerUp() {
      setDraggingNode(null);
      setPanningCanvas(null);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setConnectingFrom(null);
        setIsFullscreen(false);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [draggingNode, panningCanvas, connectingFrom, zoom, pan, onUpdateNodePosition]);

  // Compute Horizontal RTL edges (exit Left edge of source -> enter Right edge of target)
  const edges = useMemo<CanvasEdge[]>(() => {
    const list: CanvasEdge[] = [];
    const nodeMap = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));

    for (const node of flow.nodes) {
      const srcPos = nodePositions.get(node.id);
      if (!srcPos) continue;
      const srcH = nodeHeights[node.id] || DEFAULT_NODE_HEIGHT;
      const leftEdgeX = srcPos.x;

      if (node.type === 'condition' && node.condition) {
        if (node.condition.trueNodeId && nodeMap.has(node.condition.trueNodeId)) {
          const tgt = nodePositions.get(node.condition.trueNodeId)!;
          const tgtH = nodeHeights[node.condition.trueNodeId] || DEFAULT_NODE_HEIGHT;
          list.push({
            id: `${node.id}__true__${node.condition.trueNodeId}`,
            kind: { type: 'condition_true', sourceNodeId: node.id },
            sourceNodeId: node.id,
            targetNodeId: node.condition.trueNodeId,
            label: 'درست',
            color: '#047857',
            sourceX: leftEdgeX,
            sourceY: srcPos.y + srcH * 0.38,
            targetX: tgt.x + NODE_WIDTH,
            targetY: tgt.y + tgtH / 2,
          });
        }
        if (node.condition.falseNodeId && nodeMap.has(node.condition.falseNodeId)) {
          const tgt = nodePositions.get(node.condition.falseNodeId)!;
          const tgtH = nodeHeights[node.condition.falseNodeId] || DEFAULT_NODE_HEIGHT;
          list.push({
            id: `${node.id}__false__${node.condition.falseNodeId}`,
            kind: { type: 'condition_false', sourceNodeId: node.id },
            sourceNodeId: node.id,
            targetNodeId: node.condition.falseNodeId,
            label: 'نادرست',
            color: '#d97706',
            sourceX: leftEdgeX,
            sourceY: srcPos.y + srcH * 0.72,
            targetX: tgt.x + NODE_WIDTH,
            targetY: tgt.y + tgtH / 2,
          });
        }
      } else if (node.type === 'survey_node') {
        if (node.nextNodeId && nodeMap.has(node.nextNodeId)) {
          const tgt = nodePositions.get(node.nextNodeId)!;
          const tgtH = nodeHeights[node.nextNodeId] || DEFAULT_NODE_HEIGHT;
          list.push({
            id: `${node.id}__next__${node.nextNodeId}`,
            kind: { type: 'next', sourceNodeId: node.id },
            sourceNodeId: node.id,
            targetNodeId: node.nextNodeId,
            label: 'عادی / بالا',
            color: '#047857',
            sourceX: leftEdgeX,
            sourceY: srcPos.y + srcH * 0.38,
            targetX: tgt.x + NODE_WIDTH,
            targetY: tgt.y + tgtH / 2,
          });
        }
        if (node.surveyConfig?.lowScoreNodeId && nodeMap.has(node.surveyConfig.lowScoreNodeId)) {
          const tgt = nodePositions.get(node.surveyConfig.lowScoreNodeId)!;
          const tgtH = nodeHeights[node.surveyConfig.lowScoreNodeId] || DEFAULT_NODE_HEIGHT;
          list.push({
            id: `${node.id}__srvlow__${node.surveyConfig.lowScoreNodeId}`,
            kind: { type: 'survey_low', sourceNodeId: node.id },
            sourceNodeId: node.id,
            targetNodeId: node.surveyConfig.lowScoreNodeId,
            label: `امتیاز ≤ ${toPersianDigits(node.surveyConfig.lowScoreThreshold ?? 3)}`,
            color: '#d97706',
            sourceX: leftEdgeX,
            sourceY: srcPos.y + srcH * 0.72,
            targetX: tgt.x + NODE_WIDTH,
            targetY: tgt.y + tgtH / 2,
          });
        }
      } else if (node.nextNodeId && nodeMap.has(node.nextNodeId)) {
        const tgt = nodePositions.get(node.nextNodeId)!;
        const tgtH = nodeHeights[node.nextNodeId] || DEFAULT_NODE_HEIGHT;
        list.push({
          id: `${node.id}__next__${node.nextNodeId}`,
          kind: { type: 'next', sourceNodeId: node.id },
          sourceNodeId: node.id,
          targetNodeId: node.nextNodeId,
          label:
            node.type === 'delay'
              ? 'پس از تاخیر'
              : node.type === 'catalog_browser'
              ? 'پس از ثبت سفارش'
              : node.type === 'booking_node'
              ? 'پس از ثبت نوبت'
              : '',
          color: node.type === 'delay' ? '#b45309' : '#64748b',
          sourceX: leftEdgeX,
          sourceY: srcPos.y + srcH / 2,
          targetX: tgt.x + NODE_WIDTH,
          targetY: tgt.y + tgtH / 2,
        });
      }

      const buttons = (node.inlineButtons || []).filter(
        (b) => b.targetNodeId && !b.url && nodeMap.has(b.targetNodeId)
      );
      buttons.forEach((btn, bIdx) => {
        const tgt = nodePositions.get(btn.targetNodeId)!;
        const tgtH = nodeHeights[btn.targetNodeId] || DEFAULT_NODE_HEIGHT;
        const spread = buttons.length === 1 ? 0.6 : 0.45 + (bIdx / (buttons.length - 1)) * 0.42;
        list.push({
          id: `${node.id}__btn_${btn.id}__${btn.targetNodeId}`,
          kind: { type: 'button', sourceNodeId: node.id, buttonId: btn.id },
          sourceNodeId: node.id,
          targetNodeId: btn.targetNodeId,
          label: btn.text,
          color: '#0284c7',
          sourceX: leftEdgeX,
          sourceY: srcPos.y + srcH * spread,
          targetX: tgt.x + NODE_WIDTH,
          targetY: tgt.y + tgtH / 2,
        });
      });
    }

    return list;
  }, [flow.nodes, nodePositions, nodeHeights]);

  // MiniMap bounding calculations
  const miniMapMetrics = useMemo(() => {
    const MAP_W = 168;
    const MAP_H = 100;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of flow.nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;
      minX = Math.min(minX, pos.x - 40);
      minY = Math.min(minY, pos.y - 40);
      maxX = Math.max(maxX, pos.x + NODE_WIDTH + 40);
      maxY = Math.max(maxY, pos.y + (nodeHeights[node.id] || DEFAULT_NODE_HEIGHT) + 40);
    }

    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 900;
      maxY = 500;
    }

    const spanX = Math.max(300, maxX - minX);
    const spanY = Math.max(240, maxY - minY);
    const scale = Math.min(MAP_W / spanX, MAP_H / spanY);

    return { MAP_W, MAP_H, minX, minY, scale };
  }, [flow.nodes, nodePositions, nodeHeights]);

  function startConnecting(e: React.PointerEvent, kind: EdgeKind, startX: number, startY: number) {
    e.stopPropagation();
    setConnectingFrom({
      kind,
      startX,
      startY,
      mouseX: startX - 60,
      mouseY: startY,
    });
  }

  function makeHorizontalBezierPath(sx: number, sy: number, tx: number, ty: number) {
    // Normal Right -> Left forward edge (tx < sx)
    if (tx <= sx - 16) {
      const dx = Math.max(48, (sx - tx) * 0.5);
      return {
        d: `M ${sx} ${sy} C ${sx - dx} ${sy}, ${tx + dx} ${ty}, ${tx} ${ty}`,
        labelX: (sx + tx) / 2,
        labelY: (sy + ty) / 2,
      };
    }

    // Same-column vertical hop or back-edge: route smoothly above/below
    const goBelow = sy >= ty;
    const arcOffset = goBelow ? 105 : -105;
    const ctrlY = (sy + ty) / 2 + arcOffset;
    return {
      d: `M ${sx} ${sy} C ${sx - 65} ${ctrlY}, ${tx + 65} ${ctrlY}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2 + arcOffset * 0.65,
    };
  }

  const measureNodeRef = useCallback((nodeId: string) => {
    return (el: HTMLDivElement | null) => {
      if (!el) return;
      const h = el.offsetHeight;
      setNodeHeights((prev) => (prev[nodeId] === h ? prev : { ...prev, [nodeId]: h }));
    };
  }, []);

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-4 z-50 rounded-xl border border-slate-300 bg-slate-50 shadow-xl overflow-hidden select-none'
          : 'relative w-full h-[660px] rounded-xl border border-slate-200 bg-slate-50 overflow-hidden select-none'
      }
    >
      {/* Top-Right Canvas Controls (RTL) */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-xs flex-wrap">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.12).toFixed(2))))}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
          title="بزرگ‌نمایی"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="px-1.5 text-[11px] font-mono text-slate-600 tabular-nums">
          {toPersianDigits(Math.round(zoom * 100))}٪
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.15, Number((z - 0.12).toFixed(2))))}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
          title="کوچک‌نمایی"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-slate-200 mx-0.5" />
        <button
          type="button"
          onClick={() => focusStartNode(0.92)}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
          title="بازگشت به نقطه شروع با اندازه خوانا"
        >
          <Focus className="w-3 h-3" />
          <span>شروع</span>
        </button>
        <button
          type="button"
          onClick={() => fitView()}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
          title="جاگذاری تمام گره‌ها در کادر"
        >
          <Maximize2 className="w-3 h-3" />
          <span>نمای کامل</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onAutoLayout();
            setTimeout(() => focusStartNode(0.92), 60);
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50 rounded-md cursor-pointer whitespace-nowrap"
          title="مرتب‌سازی منظم گره‌ها"
        >
          <LayoutGrid className="w-3 h-3" />
          <span>چیدمان منظم</span>
        </button>
        <div className="w-px h-4 bg-slate-200 mx-0.5" />
        <button
          type="button"
          onClick={() => setIsFullscreen((f) => !f)}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
          title={isFullscreen ? 'خروج از تمام‌صفحه' : 'باز کردن تمام‌صفحه'}
        >
          {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Expand className="w-3 h-3" />}
          <span>{isFullscreen ? 'بستن' : 'تمام‌صفحه'}</span>
        </button>
      </div>

      {/* Connecting banner hint */}
      {connectingFrom && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 bg-slate-900 text-white text-xs rounded-lg flex items-center gap-2 shadow-sm">
          <span>روی گره مقصد کلیک کنید تا اتصال برقرار شود</span>
          <button
            type="button"
            onClick={() => setConnectingFrom(null)}
            className="text-slate-300 hover:text-white underline cursor-pointer"
          >
            لغو (Esc)
          </button>
        </div>
      )}

      {/* Interactive Pan/Zoom Surface */}
      <div
        ref={containerRef}
        dir="ltr"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBg === 'true') {
            if (connectingFrom) {
              setConnectingFrom(null);
              return;
            }
            setPanningCanvas({
              startClientX: e.clientX,
              startClientY: e.clientY,
              startPanX: pan.x,
              startPanY: pan.y,
            });
          }
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.08 : 0.08;
            setZoom((z) => Math.max(0.15, Math.min(1.5, Number((z + delta).toFixed(2)))));
          } else {
            setPan((prev) => ({
              x: Math.round(prev.x - e.deltaX),
              y: Math.round(prev.y - e.deltaY),
            }));
          }
        }}
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: `${Math.max(12, 24 * zoom)}px ${Math.max(12, 24 * zoom)}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        className={`w-full h-full relative ${panningCanvas ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div
          data-canvas-bg="true"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          className="absolute top-0 left-0"
        >
          {/* SVG Edges Layer */}
          <svg
            className="overflow-visible pointer-events-none absolute top-0 left-0"
            width="1"
            height="1"
          >
            <defs>
              <marker id="arrow-slate" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="#64748b" />
              </marker>
              <marker id="arrow-emerald" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="#047857" />
              </marker>
              <marker id="arrow-amber" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="#d97706" />
              </marker>
              <marker id="arrow-sky" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="#0284c7" />
              </marker>
            </defs>

            {edges.map((edge) => {
              const geom = makeHorizontalBezierPath(
                edge.sourceX,
                edge.sourceY,
                edge.targetX,
                edge.targetY
              );
              const isHighlighted =
                hoveredEdgeId === edge.id ||
                edge.sourceNodeId === selectedNodeId ||
                edge.targetNodeId === selectedNodeId;
              const markerId =
                edge.color === '#047857'
                  ? 'url(#arrow-emerald)'
                  : edge.color === '#d97706' || edge.color === '#b45309'
                  ? 'url(#arrow-amber)'
                  : edge.color === '#0284c7'
                  ? 'url(#arrow-sky)'
                  : 'url(#arrow-slate)';

              return (
                <g key={edge.id}>
                  <path
                    d={geom.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    className="pointer-events-auto cursor-pointer"
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                  />
                  <path
                    d={geom.d}
                    fill="none"
                    stroke={edge.color}
                    strokeWidth={isHighlighted ? 2.5 : 1.75}
                    strokeOpacity={isHighlighted ? 1 : 0.72}
                    markerEnd={markerId}
                  />
                </g>
              );
            })}

            {connectingFrom && (
              <path
                d={
                  makeHorizontalBezierPath(
                    connectingFrom.startX,
                    connectingFrom.startY,
                    connectingFrom.mouseX,
                    connectingFrom.mouseY
                  ).d
                }
                fill="none"
                stroke="#047857"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            )}
          </svg>

          {/* Edge Labels (only shown when meaningful or hovered) */}
          {edges.map((edge) => {
            const geom = makeHorizontalBezierPath(
              edge.sourceX,
              edge.sourceY,
              edge.targetX,
              edge.targetY
            );
            const isActiveEdge = hoveredEdgeId === edge.id;
            const showEdgeBadge = Boolean(edge.label) || isActiveEdge;
            if (!showEdgeBadge) return null;

            return (
              <div
                key={`lbl_${edge.id}`}
                dir="rtl"
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
                style={{
                  left: geom.labelX,
                  top: geom.labelY,
                  transform: 'translate(-50%, -50%)',
                }}
                className="absolute z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/95 border border-slate-200 text-[10px] font-medium text-slate-700 shadow-xs"
              >
                {edge.label && <span className="max-w-[90px] truncate">{edge.label}</span>}
                {isActiveEdge && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDisconnectEdge(edge.kind);
                    }}
                    title="قطع اتصال"
                    className="text-slate-400 hover:text-red-700 cursor-pointer"
                  >
                    <Unlink className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Node Cards (Horizontal RTL: Input port on Right edge, Output port(s) on Left edge) */}
          {flow.nodes.map((node, idx) => {
            const pos = nodePositions.get(node.id) || getFallbackPosition(idx);
            const nodeH = nodeHeights[node.id] || DEFAULT_NODE_HEIGHT;
            const isSelected = selectedNodeId === node.id;
            const isStart = flow.startNodeId === node.id;
            const isUnreachable = validation.unreachableNodeIds.includes(node.id);
            const issueInfo = nodeIssueMap.get(node.id);

            return (
              <div
                key={node.id}
                ref={measureNodeRef(node.id)}
                dir="rtl"
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_WIDTH,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (connectingFrom) {
                    onConnectEdge(connectingFrom.kind, node.id);
                    setConnectingFrom(null);
                    return;
                  }
                  onSelectNode(node.id);
                  setDraggingNode({
                    nodeId: node.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    startPosX: pos.x,
                    startPosY: pos.y,
                  });
                }}
                className={`absolute rounded-xl bg-white border shadow-xs transition-shadow ${
                  connectingFrom
                    ? 'cursor-crosshair hover:border-emerald-700 hover:ring-2 hover:ring-emerald-600/30'
                    : 'cursor-move'
                } ${
                  isSelected
                    ? 'border-emerald-700 ring-2 ring-emerald-700/20 z-20'
                    : issueInfo?.errors
                    ? 'border-red-300 z-10'
                    : isUnreachable
                    ? 'border-amber-300 z-10'
                    : 'border-slate-200 hover:border-slate-300 z-10'
                }`}
              >
                {/* Right-Side Input Port Marker (RTL Entry) */}
                <div
                  className={`w-3 h-3 rounded-full bg-white border-2 absolute top-1/2 -right-1.5 -translate-y-1/2 transition-transform ${
                    connectingFrom ? 'border-emerald-600 scale-125' : 'border-slate-400'
                  }`}
                />

                {/* Tinted Card Header */}
                <div
                  className={`px-3 py-2 rounded-t-xl border-b flex items-center justify-between gap-2 ${NODE_HEADER_STYLES[node.type]}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {getNodeIcon(node.type)}
                    <span className="text-xs font-bold text-slate-900 truncate">{node.title}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {issueInfo && (
                      <span
                        title={issueInfo.firstMsg}
                        className={issueInfo.errors > 0 ? 'text-red-600' : 'text-amber-600'}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {flow.nodes.length > 1 && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNode(node.id);
                        }}
                        className="p-0.5 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                        title="حذف گره"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Concise Card Body */}
                <div className="px-3 py-2.5 space-y-1.5 text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <span className="font-medium">{NODE_TYPE_TITLES[node.type]}</span>
                    {isStart && (
                      <>
                        <span>·</span>
                        <span className="text-emerald-700 font-semibold">شروع</span>
                      </>
                    )}
                    {node.type === 'trigger' && node.triggerPattern && (
                      <>
                        <span>·</span>
                        <code className="font-mono text-emerald-800 truncate" dir="ltr">
                          {node.triggerPattern}
                        </code>
                      </>
                    )}
                  </div>

                  {node.messageText && (
                    <p className="truncate text-slate-700">{node.messageText}</p>
                  )}

                  {node.type === 'condition' && node.condition && (
                    <p className="font-mono text-[10px] text-slate-700 truncate" dir="ltr">
                      {node.condition.sourceKey} ({node.condition.operator}) {node.condition.value}
                    </p>
                  )}

                  {node.type === 'delay' && node.delayConfig && (
                    <p className="text-amber-800 font-medium tabular-nums">
                      تاخیر {toPersianDigits(node.delayConfig.delaySeconds)} ثانیه
                    </p>
                  )}

                  {node.type === 'tag_contact' && node.tagConfig && (
                    <p className="text-slate-700 truncate">
                      {node.tagConfig.action === 'add' ? 'افزودن: ' : 'حذف: '}
                      {node.tagConfig.tags.join('، ') || '—'}
                    </p>
                  )}

                  {node.type === 'catalog_browser' && (
                    <p className="text-sky-800 truncate">
                      {node.catalogConfig?.categoryFilter && node.catalogConfig.categoryFilter !== 'all'
                        ? `دسته: ${node.catalogConfig.categoryFilter}`
                        : 'همه محصولات'}{' '}
                      · {node.catalogConfig?.allowCart === false ? 'فقط نمایش' : 'با سبد خرید'}
                    </p>
                  )}

                  {node.type === 'survey_node' && (
                    <p className="text-amber-800 truncate">
                      {node.surveyConfig?.surveyType === 'multi_choice'
                        ? `چندسوالی (${toPersianDigits(node.surveyConfig?.questions?.length || 1)} سوال)`
                        : 'امتیازدهی ۱ تا ۵ ستاره'}
                    </p>
                  )}

                  {node.type === 'booking_node' && (
                    <p className="text-emerald-800 truncate tabular-nums">
                      تقویم {toPersianDigits(node.bookingConfig?.daysAhead || 7)} روز آتی ·{' '}
                      {node.bookingConfig?.defaultStatus === 'pending' ? 'تایید دستی' : 'تایید خودکار'}
                    </p>
                  )}

                  {node.inlineButtons && node.inlineButtons.length > 0 && (
                    <div className="pt-1 space-y-1">
                      {node.inlineButtons.map((btn, bIdx) => {
                        const buttons = node.inlineButtons || [];
                        const spread =
                          buttons.length === 1
                            ? 0.6
                            : 0.45 + (bIdx / Math.max(1, buttons.length - 1)) * 0.42;
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            onPointerDown={(e) =>
                              startConnecting(
                                e,
                                { type: 'button', sourceNodeId: node.id, buttonId: btn.id },
                                pos.x,
                                pos.y + nodeH * spread
                              )
                            }
                            title="کلیک کنید تا این دکمه به گره مقصد وصل شود"
                            className="w-full flex items-center justify-between px-2 py-1 bg-sky-50 hover:bg-sky-100 border border-sky-200/80 text-sky-900 rounded text-[10px] cursor-pointer"
                          >
                            <span className="truncate">{btn.text}</span>
                            <span className="w-2 h-2 rounded-full bg-sky-600 shrink-0 mr-1" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Left-Side Output Port Handles (RTL Exit) */}
                {node.type === 'condition' ? (
                  <>
                    <button
                      type="button"
                      onPointerDown={(e) =>
                        startConnecting(
                          e,
                          { type: 'condition_true', sourceNodeId: node.id },
                          pos.x,
                          pos.y + nodeH * 0.38
                        )
                      }
                      style={{ top: '38%' }}
                      title="اتصال شاخه درست (True)"
                      className="w-5 h-5 -left-2.5 -translate-y-1/2 absolute rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) =>
                        startConnecting(
                          e,
                          { type: 'condition_false', sourceNodeId: node.id },
                          pos.x,
                          pos.y + nodeH * 0.72
                        )
                      }
                      style={{ top: '72%' }}
                      title="اتصال شاخه نادرست (False)"
                      className="w-5 h-5 -left-2.5 -translate-y-1/2 absolute rounded-full bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </>
                ) : node.type === 'survey_node' ? (
                  <>
                    <button
                      type="button"
                      onPointerDown={(e) =>
                        startConnecting(
                          e,
                          { type: 'next', sourceNodeId: node.id },
                          pos.x,
                          pos.y + nodeH * 0.38
                        )
                      }
                      style={{ top: '38%' }}
                      title="اتصال مسیر عادی / امتیاز بالا"
                      className="w-5 h-5 -left-2.5 -translate-y-1/2 absolute rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) =>
                        startConnecting(
                          e,
                          { type: 'survey_low', sourceNodeId: node.id },
                          pos.x,
                          pos.y + nodeH * 0.72
                        )
                      }
                      style={{ top: '72%' }}
                      title="اتصال مسیر امتیاز پایین (پیگیری نارضایتی)"
                      className="w-5 h-5 -left-2.5 -translate-y-1/2 absolute rounded-full bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onPointerDown={(e) =>
                      startConnecting(
                        e,
                        { type: 'next', sourceNodeId: node.id },
                        pos.x,
                        pos.y + nodeH / 2
                      )
                    }
                    title="اتصال به گره بعدی"
                    className="w-5 h-5 -left-2.5 top-1/2 -translate-y-1/2 absolute rounded-full bg-white hover:bg-emerald-700 border-2 border-slate-400 hover:border-emerald-700 text-slate-600 hover:text-white flex items-center justify-center shadow-xs transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive MiniMap (Bottom-Left) */}
      <div
        dir="ltr"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          const worldX = clickX / miniMapMetrics.scale + miniMapMetrics.minX;
          const worldY = clickY / miniMapMetrics.scale + miniMapMetrics.minY;
          setPan({
            x: Math.round(viewportSize.width / 2 - worldX * zoom),
            y: Math.round(viewportSize.height / 2 - worldY * zoom),
          });
        }}
        style={{ width: miniMapMetrics.MAP_W, height: miniMapMetrics.MAP_H }}
        className="absolute bottom-3 left-3 z-20 bg-white/95 border border-slate-200 rounded-lg shadow-xs overflow-hidden cursor-pointer"
        title="نقشه کوچک گراف (برای جابجایی کلیک کنید)"
      >
        {flow.nodes.map((node, idx) => {
          const pos = nodePositions.get(node.id) || getFallbackPosition(idx);
          const h = nodeHeights[node.id] || DEFAULT_NODE_HEIGHT;
          const left = (pos.x - miniMapMetrics.minX) * miniMapMetrics.scale;
          const top = (pos.y - miniMapMetrics.minY) * miniMapMetrics.scale;
          const width = Math.max(8, NODE_WIDTH * miniMapMetrics.scale);
          const height = Math.max(5, h * miniMapMetrics.scale);
          const isSelected = node.id === selectedNodeId;
          return (
            <div
              key={`mm_${node.id}`}
              style={{ left, top, width, height }}
              className={`absolute rounded-[2px] ${
                isSelected ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            />
          );
        })}

        <div
          style={{
            left: (-pan.x / zoom - miniMapMetrics.minX) * miniMapMetrics.scale,
            top: (-pan.y / zoom - miniMapMetrics.minY) * miniMapMetrics.scale,
            width: (viewportSize.width / zoom) * miniMapMetrics.scale,
            height: (viewportSize.height / zoom) * miniMapMetrics.scale,
          }}
          className="absolute border border-emerald-700/70 bg-emerald-500/10 pointer-events-none"
        />
      </div>
    </div>
  );
}
