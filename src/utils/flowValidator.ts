import type { FlowDefinition, FlowNode } from '../types/bot.ts';

export interface FlowValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  nodeTitle?: string;
  message: string;
}

export interface FlowValidationReport {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: FlowValidationIssue[];
  unreachableNodeIds: string[];
}

export function getOutgoingTargets(node: FlowNode): Array<{ label: string; targetId: string }> {
  const targets: Array<{ label: string; targetId: string }> = [];
  if (node.type === 'condition' && node.condition) {
    if (node.condition.trueNodeId) {
      targets.push({ label: 'شرط درست', targetId: node.condition.trueNodeId });
    }
    if (node.condition.falseNodeId) {
      targets.push({ label: 'شرط نادرست', targetId: node.condition.falseNodeId });
    }
  } else if (node.type === 'survey_node') {
    if (node.nextNodeId) {
      targets.push({ label: 'پس از نظرسنجی', targetId: node.nextNodeId });
    }
    if (node.surveyConfig?.lowScoreNodeId) {
      targets.push({ label: 'امتیاز پایین', targetId: node.surveyConfig.lowScoreNodeId });
    }
  } else {
    if (node.nextNodeId) {
      targets.push({ label: 'گره بعدی', targetId: node.nextNodeId });
    }
  }

  for (const btn of node.inlineButtons || []) {
    if (btn.targetNodeId && !btn.url) {
      targets.push({ label: `دکمه «${btn.text}»`, targetId: btn.targetNodeId });
    }
  }

  return targets;
}

export function validateFlowGraph(flow: FlowDefinition): FlowValidationReport {
  const issues: FlowValidationIssue[] = [];
  const nodeMap = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));

  if (flow.nodes.length === 0) {
    issues.push({
      id: 'empty_flow',
      severity: 'error',
      message: 'جریان گفتگو هیچ گره‌ای ندارد.',
    });
    return { valid: false, errorCount: 1, warningCount: 0, issues, unreachableNodeIds: [] };
  }

  const triggerNodes = flow.nodes.filter((n) => n.type === 'trigger');
  if (triggerNodes.length === 0) {
    issues.push({
      id: 'no_trigger',
      severity: 'error',
      message: 'حداقل یک گره «دستور شروع / ماشه» (مانند /start) برای شروع گفتگو لازم است.',
    });
  }

  if (!flow.startNodeId || !nodeMap.has(flow.startNodeId)) {
    issues.push({
      id: 'missing_start_node',
      severity: 'warning',
      message: 'گره شروع پیش‌فرض (startNodeId) تنظیم نشده یا حذف شده است.',
    });
  }

  for (const node of flow.nodes) {
    if (node.type === 'trigger' && !node.triggerPattern?.trim()) {
      issues.push({
        id: `trigger_pattern_${node.id}`,
        severity: 'error',
        nodeId: node.id,
        nodeTitle: node.title,
        message: `گره «${node.title}» دستور محرک (مانند /start) ندارد.`,
      });
    }

    if (
      (node.type === 'message' || node.type === 'save_form') &&
      !node.messageText?.trim()
    ) {
      issues.push({
        id: `empty_msg_${node.id}`,
        severity: 'warning',
        nodeId: node.id,
        nodeTitle: node.title,
        message: `متن پیام در گره «${node.title}» خالی است.`,
      });
    }

    if (node.type === 'question') {
      if (!node.fieldKey?.trim()) {
        issues.push({
          id: `missing_fieldkey_${node.id}`,
          severity: 'error',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `گره سوال «${node.title}» کلید فیلد (fieldKey) ندارد.`,
        });
      }
      if (!node.messageText?.trim()) {
        issues.push({
          id: `missing_qtext_${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `متن پرسش در گره «${node.title}» خالی است.`,
        });
      }
    }

    if (node.type === 'condition') {
      if (!node.condition?.sourceKey?.trim()) {
        issues.push({
          id: `cond_source_${node.id}`,
          severity: 'error',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `متغیر شرط در گره «${node.title}» مشخص نشده است.`,
        });
      }
      if (!node.condition?.trueNodeId || !node.condition?.falseNodeId) {
        issues.push({
          id: `cond_branch_${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `یکی از شاخه‌های درست/نادرست در گره «${node.title}» متصل نشده است.`,
        });
      }
    }

    if (node.type === 'tag_contact' && (!node.tagConfig?.tags || node.tagConfig.tags.length === 0)) {
      issues.push({
        id: `empty_tags_${node.id}`,
        severity: 'warning',
        nodeId: node.id,
        nodeTitle: node.title,
        message: `گره برچسب‌گذاری «${node.title}» هیچ برچسبی ندارد.`,
      });
    }

    if (node.type === 'delay') {
      const secs = node.delayConfig?.delaySeconds ?? 0;
      if (secs <= 0) {
        issues.push({
          id: `delay_secs_${node.id}`,
          severity: 'error',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `مدت زمان تاخیر در گره «${node.title}» باید بیشتر از صفر ثانیه باشد.`,
        });
      }
      if (!node.delayConfig?.followUpText?.trim() && !node.nextNodeId) {
        issues.push({
          id: `delay_empty_${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `گره تاخیر «${node.title}» نه متن پیگیری دارد و نه به گره بعدی متصل است.`,
        });
      }
    }

    if (node.type === 'survey_node') {
      const cfg = node.surveyConfig;
      if (!cfg?.surveyId && cfg?.surveyType === 'multi_choice' && (!cfg.questions || cfg.questions.length === 0)) {
        issues.push({
          id: `survey_empty_${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `گره نظرسنجی «${node.title}» هنوز هیچ سوالی ندارد یا به یک نظرسنجی متصل نشده است.`,
        });
      }
    }

    if (node.type === 'booking_node') {
      const days = node.bookingConfig?.daysAhead ?? 7;
      if (days < 1 || days > 30) {
        issues.push({
          id: `booking_days_${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `تعداد روزهای باز نوبت‌دهی در گره «${node.title}» باید بین ۱ تا ۳۰ روز باشد.`,
        });
      }
    }

    // Broken target links check
    for (const edge of getOutgoingTargets(node)) {
      if (!nodeMap.has(edge.targetId)) {
        issues.push({
          id: `broken_link_${node.id}_${edge.targetId}`,
          severity: 'error',
          nodeId: node.id,
          nodeTitle: node.title,
          message: `اتصال «${edge.label}» در گره «${node.title}» به گره نامعتبر (${edge.targetId}) اشاره دارد.`,
        });
      }
    }
  }

  // BFS reachability check from startNodeId + all triggers
  const visited = new Set<string>();
  const queue: string[] = [];
  if (flow.startNodeId && nodeMap.has(flow.startNodeId)) {
    queue.push(flow.startNodeId);
    visited.add(flow.startNodeId);
  }
  for (const trig of triggerNodes) {
    if (!visited.has(trig.id)) {
      visited.add(trig.id);
      queue.push(trig.id);
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentNode = nodeMap.get(currentId);
    if (!currentNode) continue;

    for (const edge of getOutgoingTargets(currentNode)) {
      if (nodeMap.has(edge.targetId) && !visited.has(edge.targetId)) {
        visited.add(edge.targetId);
        queue.push(edge.targetId);
      }
    }
  }

  const unreachableNodeIds: string[] = [];
  for (const node of flow.nodes) {
    if (!visited.has(node.id)) {
      unreachableNodeIds.push(node.id);
      issues.push({
        id: `orphan_${node.id}`,
        severity: 'warning',
        nodeId: node.id,
        nodeTitle: node.title,
        message: `گره «${node.title}» رها شده و از هیچ نقطه شروعی قابل دسترسی نیست.`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    unreachableNodeIds,
  };
}

export function needsAutoLayout(flow: FlowDefinition): boolean {
  if (flow.nodes.length === 0) return false;
  for (const n of flow.nodes) {
    if (!n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number') {
      return true;
    }
  }
  for (let i = 0; i < flow.nodes.length; i += 1) {
    const a = flow.nodes[i].position!;
    for (let j = i + 1; j < flow.nodes.length; j += 1) {
      const b = flow.nodes[j].position!;
      if (Math.abs(a.x - b.x) < 252 && Math.abs(a.y - b.y) < 175) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Clean BFS layered Horizontal RTL layout (Start on the Right, flowing Left; branches stacked cleanly vertically).
 */
export function autoLayoutFlow(flow: FlowDefinition): FlowDefinition {
  if (flow.nodes.length === 0) return flow;
  const nodeMap = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));
  const levelMap = new Map<string, number>();
  const queue: string[] = [];

  const seeds: string[] = [];
  if (flow.startNodeId && nodeMap.has(flow.startNodeId)) {
    seeds.push(flow.startNodeId);
  }
  for (const n of flow.nodes) {
    if (n.type === 'trigger' && !seeds.includes(n.id)) {
      seeds.push(n.id);
    }
  }
  if (seeds.length === 0 && flow.nodes[0]) {
    seeds.push(flow.nodes[0].id);
  }

  for (const seed of seeds) {
    levelMap.set(seed, 0);
    queue.push(seed);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (!node) continue;
    const baseLevel = levelMap.get(id) ?? 0;

    for (const edge of getOutgoingTargets(node)) {
      if (nodeMap.has(edge.targetId) && !levelMap.has(edge.targetId)) {
        levelMap.set(edge.targetId, baseLevel + 1);
        queue.push(edge.targetId);
      }
    }
  }

  let maxAssignedLevel = Math.max(0, ...Array.from(levelMap.values()));
  for (const node of flow.nodes) {
    if (!levelMap.has(node.id)) {
      maxAssignedLevel += 1;
      levelMap.set(node.id, maxAssignedLevel);
    }
  }

  const cols = new Map<number, FlowNode[]>();
  for (const node of flow.nodes) {
    const lvl = levelMap.get(node.id) ?? 0;
    const list = cols.get(lvl) || [];
    list.push(node);
    cols.set(lvl, list);
  }

  const NODE_WIDTH = 236;
  const H_GAP = 104;
  const COL_STEP = NODE_WIDTH + H_GAP; // 340px
  const ROW_STEP = 230;
  const CENTER_Y = 240;
  const maxCol = Math.max(0, ...Array.from(cols.keys()));

  const positionMap = new Map<string, { x: number; y: number }>();
  for (const [lvl, list] of cols.entries()) {
    // Level 0 starts on the rightmost column; subsequent steps flow Right -> Left
    const x = Math.round(80 + (maxCol - lvl) * COL_STEP);
    const totalHeight = list.length * 145 + Math.max(0, list.length - 1) * (ROW_STEP - 145);
    const startY = Math.max(60, Math.round(CENTER_Y - totalHeight / 2));

    list.forEach((node, idx) => {
      positionMap.set(node.id, {
        x,
        y: Math.round(startY + idx * ROW_STEP),
      });
    });
  }

  return {
    ...flow,
    nodes: flow.nodes.map((node) => ({
      ...node,
      position: positionMap.get(node.id) || node.position || { x: 80, y: 80 },
    })),
  };
}
