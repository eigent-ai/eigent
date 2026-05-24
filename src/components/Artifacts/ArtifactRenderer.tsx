// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { fetchPost } from '@/api/http';
import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import type {
  RuntimeActionType,
  RuntimeKpiMetric,
  RuntimeSelectionOption,
  RuntimeTone,
  RuntimeUiAction,
  RuntimeUiArtifactEvent,
  RuntimeUiArtifactPayload,
  RuntimeUiSection,
} from '@/types/runtimeArtifact';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Inbox,
  MousePointerClick,
  Pencil,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ArtifactRendererProps {
  payload: RuntimeUiArtifactPayload;
}

function actionTone(actionType: RuntimeActionType, tone?: RuntimeTone) {
  if (tone) return tone;
  if (actionType === 'approval') return 'success' as const;
  if (actionType === 'reject') return 'error' as const;
  if (actionType === 'edit') return 'warning' as const;
  return 'neutral' as const;
}

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rowId(row: unknown, index: number): string {
  const record = asRecord(row);
  return toText(record.id ?? record.ID ?? record.key ?? index);
}

/** Detect if a metric value is a rich KpiMetric object vs a plain scalar. */
function isKpiMetric(value: unknown): value is RuntimeKpiMetric {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in (value as object)
  );
}

function ActionIcon({ action }: { action: RuntimeUiAction }) {
  if (action.type === 'approval') return <Check className="h-4 w-4" />;
  if (action.type === 'reject') return <X className="h-4 w-4" />;
  if (action.type === 'edit') return <Pencil className="h-4 w-4" />;
  return <MousePointerClick className="h-4 w-4" />;
}

/** Tone → left-border colour class for section wrappers. */
function toneBorder(tone?: RuntimeTone): string {
  switch (tone) {
    case 'success':
      return 'border-l-4 border-l-green-500';
    case 'error':
      return 'border-l-4 border-l-red-500';
    case 'warning':
      return 'border-l-4 border-l-amber-500';
    case 'information':
      return 'border-l-4 border-l-blue-500';
    default:
      return '';
  }
}

// ── Animated number count-up ─────────────────────────────────────────────────

function AnimatedNumber({ value }: { value: number }) {
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) =>
    Number.isInteger(value) ? Math.round(v).toLocaleString() : v.toFixed(1)
  );
  // Initialize at the final value so it's correct in SSR/test environments.
  // The useEffect below will trigger the animated count-up in the browser.
  const [display, setDisplay] = useState(() =>
    Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
  );

  useEffect(() => {
    const unsubscribe = rounded.on('change', setDisplay);
    const ctrl = animate(motionVal, value, { duration: 0.9, ease: 'easeOut' });
    return () => {
      ctrl.stop();
      unsubscribe();
    };
  }, [value, motionVal, rounded]);

  return <motion.span>{display}</motion.span>;
}

// ── KPI Tile ─────────────────────────────────────────────────────────────────

function KpiTile({ label, raw }: { label: string; raw: unknown }) {
  const metric = isKpiMetric(raw) ? raw : null;
  const numericVal = metric
    ? metric.value
    : typeof raw === 'number'
      ? raw
      : null;
  const deltaStr = metric?.delta;
  const direction = metric?.direction ?? 'neutral';

  return (
    <Card className="rounded-lg border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default">
      <CardContent className="p-3">
        <div className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {label.replace(/_/g, ' ')}
        </div>
        <div className="mt-1 gap-2 flex items-end">
          <div className="text-xl font-bold text-ds-text-neutral-default-default">
            {numericVal !== null ? (
              <AnimatedNumber value={numericVal} />
            ) : (
              toText(raw)
            )}
          </div>
          {deltaStr && (
            <Badge
              size="xs"
              tone={
                direction === 'up'
                  ? 'success'
                  : direction === 'down'
                    ? 'error'
                    : 'neutral'
              }
              variant="secondary"
              className="mb-0.5 gap-0.5 flex shrink-0 items-center"
            >
              {direction === 'up' ? (
                <TrendingUp className="h-2.5 w-2.5" />
              ) : direction === 'down' ? (
                <TrendingDown className="h-2.5 w-2.5" />
              ) : null}
              {deltaStr}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Chart palette ─────────────────────────────────────────────────────────────

const CHART_COLORS = [
  'var(--ds-icon-brand-default-default)',
  'var(--ds-icon-status-completed-default-default)',
  'var(--ds-icon-status-pending-default-default)',
  'var(--ds-icon-status-error-default-default)',
  'var(--ds-icon-status-splitting-default-default)',
  'var(--ds-icon-status-running-default-default)',
];

// ── Recharts wrappers ─────────────────────────────────────────────────────────

function ReLineChart({
  points,
  xField,
  yFields,
  smooth,
  showLegend,
}: {
  points: Record<string, unknown>[];
  xField: string;
  yFields: string[];
  smooth?: boolean | null;
  showLegend?: boolean | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart
        data={points}
        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
        aria-label="line chart"
      >
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
        <XAxis
          dataKey={xField}
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid var(--ds-border-neutral-subtle-default)',
          }}
        />
        {(showLegend ?? yFields.length > 1) && <Legend iconSize={10} />}
        {yFields.map((field, i) => (
          <Line
            key={field}
            type={smooth ? 'monotone' : 'linear'}
            dataKey={field}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            animationDuration={700}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function ReBarChart({
  points,
  xField,
  yFields,
  stacked,
  showLegend,
}: {
  points: Record<string, unknown>[];
  xField: string;
  yFields: string[];
  stacked?: boolean | null;
  showLegend?: boolean | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={points}
        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
        aria-label="bar chart"
      >
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
        <XAxis
          dataKey={xField}
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid var(--ds-border-neutral-subtle-default)',
          }}
        />
        {(showLegend ?? yFields.length > 1) && <Legend iconSize={10} />}
        {yFields.map((field, i) => (
          <Bar
            key={field}
            dataKey={field}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            stackId={stacked ? 'stack' : undefined}
            radius={[3, 3, 0, 0]}
            animationDuration={700}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ReAreaChart({
  points,
  xField,
  yFields,
  stacked,
  smooth,
  showLegend,
}: {
  points: Record<string, unknown>[];
  xField: string;
  yFields: string[];
  stacked?: boolean | null;
  smooth?: boolean | null;
  showLegend?: boolean | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart
        data={points}
        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
        aria-label="area chart"
      >
        <defs>
          {yFields.map((field, i) => (
            <linearGradient
              key={field}
              id={`area-gradient-${field}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
        <XAxis
          dataKey={xField}
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid var(--ds-border-neutral-subtle-default)',
          }}
        />
        {(showLegend ?? yFields.length > 1) && <Legend iconSize={10} />}
        {yFields.map((field, i) => (
          <Area
            key={field}
            type={smooth ? 'monotone' : 'linear'}
            dataKey={field}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={`url(#area-gradient-${field})`}
            strokeWidth={2}
            stackId={stacked ? 'stack' : undefined}
            animationDuration={700}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RePieChart({
  points,
  xField,
  yFields,
  showLegend,
}: {
  points: Record<string, unknown>[];
  xField: string;
  yFields: string[];
  showLegend?: boolean | null;
}) {
  const valueField = yFields[0] ?? 'value';
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart aria-label="pie chart">
        <Pie
          data={points}
          dataKey={valueField}
          nameKey={xField}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          animationDuration={700}
        >
          {points.map((_entry, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid var(--ds-border-neutral-subtle-default)',
          }}
        />
        {(showLegend ?? true) && <Legend iconSize={10} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Trigger Card Section ─────────────────────────────────────────────────────
// Matches TaskCompletionCard design: neutral card bg, title+subtitle, two CTA buttons.

function TriggerCardSection({
  title,
  subtitle,
  taskPrompt,
}: {
  title: string;
  subtitle: string;
  taskPrompt: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);

  if (dismissed) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.1 }}
        className="group rounded-xl p-3 bg-ds-bg-neutral-default-default gap-3 relative flex w-full flex-row items-center"
      >
        {/* Hover-reveal dismiss button */}
        <Button
          type="button"
          variant="secondary"
          tone="neutral"
          size="xs"
          buttonRadius="full"
          buttonContent="icon-only"
          onClick={() => setDismissed(true)}
          className="-top-2 -right-2 pointer-events-none absolute z-10 shrink-0 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          aria-label="Dismiss"
        >
          <X />
        </Button>

        {/* Text */}
        <div className="min-w-0 gap-0.5 flex w-full flex-col">
          <div className="text-label-sm font-bold leading-normal text-ds-text-neutral-default-default">
            {title}
          </div>
          <div className="text-label-sm font-medium leading-normal text-ds-text-neutral-subtle-default">
            {subtitle}
          </div>
        </div>

        {/* Actions */}
        <div className="gap-2 flex shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDismissed(true)}
            className="rounded-lg h-fit whitespace-nowrap"
          >
            Maybe later
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsTriggerDialogOpen(true)}
            className="rounded-lg h-fit whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Add Trigger
          </Button>
        </div>
      </motion.div>

      <TriggerDialog
        selectedTrigger={null}
        isOpen={isTriggerDialogOpen}
        onOpenChange={setIsTriggerDialogOpen}
        initialTaskPrompt={taskPrompt}
      />
    </>
  );
}

// ── Status Tile ───────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, React.ElementType> = {
  check: CircleCheck,
  error: CircleX,
  warning: Clock,
  clock: Clock,
  zap: Zap,
};

function StatusTileSection({ section }: { section: RuntimeUiSection }) {
  const IconComponent =
    STATUS_ICONS[section.icon?.toLowerCase() ?? ''] ?? CircleCheck;
  const toneColor: Record<string, string> = {
    success: 'text-green-500',
    error: 'text-red-500',
    warning: 'text-amber-500',
    information: 'text-blue-500',
    neutral: 'text-ds-text-neutral-muted-default',
  };
  const iconClass = toneColor[section.tone ?? 'neutral'] ?? toneColor.neutral;

  return (
    <Card
      className={cn(
        'rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default',
        toneBorder(section.tone)
      )}
    >
      <CardContent className="gap-4 p-4 flex items-center">
        <IconComponent className={cn('h-10 w-10 shrink-0', iconClass)} />
        <div className="gap-0.5 min-w-0 flex flex-col">
          {section.title && (
            <div className="text-label-xs text-ds-text-neutral-muted-default">
              {section.title}
            </div>
          )}
          <div className="text-2xl font-bold text-ds-text-neutral-default-default leading-tight">
            {section.value ?? '—'}
          </div>
          {section.caption && (
            <div className="text-label-xs text-ds-text-neutral-subtle-default">
              {section.caption}
            </div>
          )}
        </div>
        {section.delta && (
          <Badge
            size="xs"
            tone="neutral"
            variant="secondary"
            className="ml-auto shrink-0"
          >
            {section.delta}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ── Timeline Section ──────────────────────────────────────────────────────────

interface TimelineItem {
  id?: string;
  timestamp?: string;
  label: string;
  tone?: RuntimeTone;
  icon?: string;
}

function TimelineSection({
  items,
  title,
}: {
  items: TimelineItem[];
  title?: string | null;
}) {
  const dotColor: Record<string, string> = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    information: 'bg-blue-500',
    neutral: 'bg-ds-text-neutral-muted-default',
  };

  return (
    <section className="gap-2 flex flex-col">
      {title && (
        <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
          {title}
        </h3>
      )}
      <div className="gap-0 pl-4 relative flex flex-col">
        {/* Vertical connector line */}
        <div className="top-2 bottom-2 bg-ds-border-neutral-subtle-default absolute left-[7px] w-px" />
        {items.map((item, i) => (
          <div
            key={item.id ?? i}
            className="gap-3 pb-3 relative flex items-start"
          >
            {/* Dot */}
            <div
              className={cn(
                'mt-1.5 h-3 w-3 border-background relative z-10 shrink-0 rounded-full border-2',
                dotColor[item.tone ?? 'neutral'] ?? dotColor.neutral
              )}
            />
            <div className="gap-0.5 min-w-0 flex flex-col">
              <span className="text-sm text-ds-text-neutral-default-default">
                {item.label}
              </span>
              {item.timestamp && (
                <span className="text-label-xs text-ds-text-neutral-muted-default gap-1 flex items-center">
                  <Clock className="h-2.5 w-2.5" />
                  {item.timestamp}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Compare Card Section ──────────────────────────────────────────────────────

interface CompareOption {
  id: string;
  title: string;
  features?: { label: string; included: boolean }[];
  cta_label?: string;
  description?: string;
}

function CompareCardSection({
  options,
  title,
  onSelect,
  submitted,
}: {
  options: CompareOption[];
  title?: string | null;
  onSelect?: (id: string) => void;
  submitted?: boolean;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <section className="gap-3 flex flex-col">
      {title && (
        <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
          {title}
        </h3>
      )}
      <div
        className={cn(
          'gap-3 grid',
          options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
        )}
      >
        {options.map((opt) => (
          <Card
            key={opt.id}
            className={cn(
              'rounded-xl cursor-pointer border transition-colors',
              chosen === opt.id
                ? 'border-blue-500 bg-ds-bg-neutral-subtle-default'
                : 'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default hover:border-ds-border-neutral-default-default'
            )}
            onClick={() => setChosen(opt.id)}
          >
            <CardContent className="p-4 gap-3 flex h-full flex-col">
              <div className="font-semibold text-sm text-ds-text-neutral-default-default">
                {opt.title}
              </div>
              {opt.description && (
                <div className="text-xs text-ds-text-neutral-muted-default">
                  {opt.description}
                </div>
              )}
              {opt.features && opt.features.length > 0 && (
                <ul className="gap-1.5 text-xs mt-auto flex flex-col">
                  {opt.features.map((f, i) => (
                    <li
                      key={i}
                      className={cn(
                        'gap-1.5 flex items-center',
                        f.included
                          ? 'text-ds-text-neutral-default-default'
                          : 'text-ds-text-neutral-muted-default line-through'
                      )}
                    >
                      {f.included ? (
                        <Check className="h-3 w-3 text-green-500 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      {f.label}
                    </li>
                  ))}
                </ul>
              )}
              {!submitted && onSelect && (
                <Button
                  size="sm"
                  variant={chosen === opt.id ? 'primary' : 'secondary'}
                  tone="information"
                  className="mt-auto w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChosen(opt.id);
                    onSelect(opt.id);
                  }}
                >
                  {opt.cta_label ?? 'Choose'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ message = 'No data available.' }: { message?: string }) {
  return (
    <div className="gap-2 rounded-lg border-ds-border-neutral-default-default py-6 flex flex-col items-center justify-center border border-dashed text-center">
      <Inbox className="h-8 w-8 text-ds-text-neutral-muted-default" />
      <span className="text-sm text-ds-text-neutral-muted-default">
        {message}
      </span>
    </div>
  );
}

// ── Main Renderer ────────────────────────────────────────────────────────────

export function ArtifactRenderer({ payload }: ArtifactRendererProps) {
  const { artifact, data, state } = payload;
  const { projectStore } = useChatStoreAdapter();
  const bodyRef = useRef<HTMLDivElement>(null);

  const [localState, setLocalState] = useState<Record<string, unknown>>(
    state ?? {}
  );
  const [selectedRows, setSelectedRows] = useState<Set<string>>(
    () => new Set(asArray(state?.selectedRows).map(toText))
  );
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(
    null
  );
  const [submittedLabel, setSubmittedLabel] = useState<string | null>(null);

  // Interactive artifacts start expanded; collapse after submit
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (submittedLabel !== null) {
      const t = setTimeout(() => setIsExpanded(false), 350);
      return () => clearTimeout(t);
    }
  }, [submittedLabel]);

  const mergedState = useMemo(
    () => ({
      ...localState,
      selectedRows: Array.from(selectedRows),
      selectedOption,
    }),
    [localState, selectedRows, selectedOption]
  );

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submitEvent = async (action: RuntimeUiAction) => {
    if (!projectStore.activeProjectId) return;
    const event: RuntimeUiArtifactEvent = {
      artifact_id: artifact.id,
      event_type:
        action.type === 'approval' ||
        action.type === 'reject' ||
        action.type === 'edit'
          ? 'approval_submitted'
          : 'action_clicked',
      action_id: action.id,
      payload: action.payload ?? {},
      state: mergedState,
    };
    const reply = [
      `Runtime UI action: ${action.label}`,
      `Artifact: ${artifact.title} (${artifact.id})`,
      `Event: ${JSON.stringify(event)}`,
    ].join('\n');

    setSubmittingActionId(action.id);
    try {
      await fetchPost(`/chat/${projectStore.activeProjectId}/human-reply`, {
        agent: 'single_agent',
        reply,
      });
      setSubmittedLabel(action.label);
      toast.success('Action sent to agent');
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to send action';
      toast.error(msg);
    } finally {
      setSubmittingActionId(null);
    }
  };

  // ── Action buttons (with HITL skeleton) ─────────────────────────────────────

  const renderActions = (actions: RuntimeUiAction[] = []) => {
    if (actions.length === 0) return null;
    if (submittedLabel !== null) return null;

    // Show skeleton rows while awaiting server response
    if (submittingActionId !== null) {
      return (
        <div className="gap-2 flex flex-wrap">
          {actions.map((a) => (
            <Skeleton key={a.id} className="h-8 w-24 rounded-md" />
          ))}
        </div>
      );
    }

    return (
      <div className="gap-2 flex flex-wrap">
        {actions.map((action) => {
          const tone = actionTone(action.type, action.tone);
          return (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={tone === 'neutral' ? 'secondary' : 'primary'}
              tone={tone}
              disabled={submittingActionId !== null}
              onClick={() => submitEvent(action)}
            >
              <ActionIcon action={action} />
              {action.label}
            </Button>
          );
        })}
      </div>
    );
  };

  // ── Section renderers ───────────────────────────────────────────────────────

  const renderSection = (section: RuntimeUiSection) => {
    // trigger_card — TaskCompletionCard-style automation prompt
    if (section.type === 'trigger_card') {
      return (
        <TriggerCardSection
          key={section.id}
          title={section.title ?? 'Want to automate this?'}
          subtitle={
            section.content ?? 'Set up a trigger to run this task automatically'
          }
          taskPrompt={artifact.prompt}
        />
      );
    }

    if (section.type === 'markdown') {
      return (
        <section
          key={section.id}
          className={cn('gap-1 pl-2 flex flex-col', toneBorder(section.tone))}
        >
          {section.title && (
            <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
              {section.title}
            </h3>
          )}
          <div className="text-sm text-ds-text-neutral-default-default">
            <MarkDown
              content={section.content ?? ''}
              enableTypewriter={false}
              onTyping={() => {}}
            />
          </div>
        </section>
      );
    }

    if (section.type === 'kpi_row') {
      const metrics = asRecord(data[section.data_source ?? '']);
      const entries = Object.entries(metrics);
      return (
        <section key={section.id} className="gap-2 grid grid-cols-2">
          {entries.length === 0 ? (
            <div className="col-span-2">
              <EmptyState message="No metrics available." />
            </div>
          ) : (
            entries.map(([label, value]) => (
              <KpiTile key={label} label={label} raw={value} />
            ))
          )}
        </section>
      );
    }

    if (section.type === 'table') {
      const rows = asArray(data[section.data_source ?? '']);
      const columns =
        section.columns ??
        Object.keys(asRecord(rows[0]))
          .slice(0, 6)
          .map((key) => key);
      return (
        <section
          key={section.id}
          className={cn('gap-2 pl-2 flex flex-col', toneBorder(section.tone))}
        >
          {section.title && (
            <div className="gap-2 flex items-center justify-between">
              <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
                {section.title}
              </h3>
              {selectedRows.size > 0 && (
                <Badge size="xs" tone="information" variant="secondary">
                  {selectedRows.size} selected
                </Badge>
              )}
            </div>
          )}
          {rows.length === 0 ? (
            <EmptyState message="No rows to display." />
          ) : (
            <div className="rounded-lg border-ds-border-neutral-subtle-default overflow-hidden border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const id = rowId(row, index);
                    const record = asRecord(row);
                    const selected = selectedRows.has(id);
                    return (
                      <TableRow
                        key={id}
                        data-state={selected ? 'selected' : undefined}
                        className={cn(
                          'cursor-pointer',
                          selected && 'font-medium'
                        )}
                        onClick={() => {
                          setSelectedRows((current) => {
                            const next = new Set(current);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          });
                        }}
                      >
                        {columns.map((column) => (
                          <TableCell key={column}>
                            {toText(record[column])}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      );
    }

    if (section.type === 'progress_list') {
      const items = asArray(data[section.data_source ?? '']);
      return (
        <section
          key={section.id}
          className={cn('gap-2 pl-2 flex flex-col', toneBorder(section.tone))}
        >
          {section.title && (
            <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
              {section.title}
            </h3>
          )}
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="gap-2 flex flex-col">
              {items.map((item, index) => {
                const record = asRecord(item);
                const label = toText(record.label ?? record.title ?? item);
                const progress = Number(record.progress ?? 0);
                return (
                  <div
                    key={`${label}-${index}`}
                    className="gap-1 flex flex-col"
                  >
                    <div className="text-sm text-ds-text-neutral-default-default">
                      {label}
                    </div>
                    {Number.isFinite(progress) && progress > 0 ? (
                      <Progress value={Math.min(progress, 100)} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      );
    }

    if (section.type === 'approval_panel') {
      return (
        <Card
          key={section.id}
          className={cn(
            'rounded-lg border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default',
            toneBorder(section.tone)
          )}
        >
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-label-sm">{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="gap-3 p-3 pt-0 flex flex-col">
            {section.content && (
              <MarkDown
                content={section.content}
                enableTypewriter={false}
                onTyping={() => {}}
              />
            )}
            {artifact.interaction_mode !== 'view_only' && (
              <Textarea
                value={toText(localState.note)}
                onChange={(event) =>
                  setLocalState((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="Add context for the agent..."
                className="min-h-[80px]"
              />
            )}
            {renderActions(section.actions)}
          </CardContent>
        </Card>
      );
    }

    if (section.type === 'action_row') {
      return (
        <section
          key={section.id}
          className={cn(
            'gap-2 bottom-0 pb-1 pt-2 sticky z-10 flex flex-col',
            (section.actions ?? []).length > 0 &&
              'from-ds-bg-neutral-subtle-default via-ds-bg-neutral-subtle-default bg-gradient-to-t to-transparent'
          )}
        >
          {section.title && (
            <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
              {section.title}
            </h3>
          )}
          {renderActions(section.actions)}
        </section>
      );
    }

    if (section.type === 'selection_list') {
      const options: RuntimeSelectionOption[] = section.options ?? [];
      const submitAction: RuntimeUiAction = (section.actions ?? []).find(
        (a) => a.id === 'submit'
      ) ?? {
        id: 'submit',
        label: 'Submit',
        type: 'agent_action',
        tone: 'information',
      };
      return (
        <section key={section.id} className="gap-3 flex flex-col">
          {section.title && (
            <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
              {section.title}
            </h3>
          )}
          {options.length === 0 ? (
            <EmptyState message="No options available." />
          ) : (
            <div className="gap-2 flex flex-col">
              {options.map((opt) => (
                <label
                  key={opt.id}
                  className={cn(
                    'gap-3 rounded-lg p-3 flex cursor-pointer items-start border transition-colors',
                    selectedOption === opt.id
                      ? 'border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default'
                      : 'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default hover:border-ds-border-neutral-default-default'
                  )}
                >
                  <input
                    type="radio"
                    name={`selection-${section.id}`}
                    value={opt.id}
                    checked={selectedOption === opt.id}
                    onChange={() => setSelectedOption(opt.id)}
                    className="mt-0.5"
                  />
                  <div className="gap-0.5 flex flex-col">
                    <span className="text-sm font-medium text-ds-text-neutral-default-default">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-xs text-ds-text-neutral-muted-default">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
          {submittedLabel !== null ? null : (
            <Button
              type="button"
              size="sm"
              variant="primary"
              tone="information"
              disabled={!selectedOption || submittingActionId !== null}
              onClick={() =>
                submitEvent({
                  ...submitAction,
                  payload: { selected_option: selectedOption },
                })
              }
            >
              {submittedLabel !== null ? (
                submittedLabel
              ) : submittingActionId !== null ? (
                <Skeleton className="h-4 w-12" />
              ) : (
                submitAction.label
              )}
            </Button>
          )}
        </section>
      );
    }

    // ── Chart sections (recharts) ───────────────────────────────────────────

    if (
      section.type === 'line_chart' ||
      section.type === 'bar_chart' ||
      section.type === 'area_chart' ||
      section.type === 'pie_chart'
    ) {
      const chartRaw = data[section.data_source ?? 'chart'];
      const chartRecord = asRecord(chartRaw);
      const points = asArray(chartRecord.points ?? chartRaw).map(asRecord);
      const xField = section.x_field ?? 'x';
      const yFields = section.y_fields ?? ['y'];

      const ariaLabel =
        section.type === 'bar_chart'
          ? 'bar chart'
          : section.type === 'area_chart'
            ? 'area chart'
            : section.type === 'pie_chart'
              ? 'pie chart'
              : 'line chart';

      return (
        <section key={section.id} className="gap-2 flex flex-col">
          {section.title && (
            <h3 className="text-label-sm font-bold text-ds-text-neutral-default-default">
              {section.title}
            </h3>
          )}
          <div
            className="rounded-lg border-ds-border-neutral-subtle-default p-3 bg-ds-bg-neutral-default-default border"
            aria-label={ariaLabel}
          >
            {points.length === 0 ? (
              <EmptyState message="No chart data available." />
            ) : section.type === 'bar_chart' ? (
              <ReBarChart
                points={points}
                xField={xField}
                yFields={yFields}
                stacked={section.stacked}
                showLegend={section.show_legend}
              />
            ) : section.type === 'area_chart' ? (
              <ReAreaChart
                points={points}
                xField={xField}
                yFields={yFields}
                stacked={section.stacked}
                smooth={section.smooth}
                showLegend={section.show_legend}
              />
            ) : section.type === 'pie_chart' ? (
              <RePieChart
                points={points}
                xField={xField}
                yFields={yFields}
                showLegend={section.show_legend}
              />
            ) : (
              <ReLineChart
                points={points}
                xField={xField}
                yFields={yFields}
                smooth={section.smooth}
                showLegend={section.show_legend}
              />
            )}
          </div>
        </section>
      );
    }

    if (section.type === 'status_tile') {
      return <StatusTileSection key={section.id} section={section} />;
    }

    if (section.type === 'timeline') {
      const rawItems = asArray(data[section.data_source ?? 'timeline']);
      const items = rawItems.map((item) => asRecord(item)) as TimelineItem[];
      return (
        <TimelineSection key={section.id} items={items} title={section.title} />
      );
    }

    if (section.type === 'compare_card') {
      const rawOptions = asArray(data[section.data_source ?? 'compare']);
      const options = rawOptions.map((o) => asRecord(o)) as CompareOption[];
      return (
        <CompareCardSection
          key={section.id}
          options={options}
          title={section.title}
          submitted={submittedLabel !== null}
          onSelect={(id) => {
            // Trigger submit if artifact has a submit action
            const submitAct = (artifact.actions ?? []).find(
              (a) => a.id === 'submit' || a.type === 'agent_action'
            );
            if (submitAct) {
              submitEvent({ ...submitAct, payload: { selected_option: id } });
            }
          }}
        />
      );
    }

    if (section.type === 'chart_placeholder') {
      return (
        <section
          key={section.id}
          className="rounded-lg border-ds-border-neutral-default-default p-3 border border-dashed"
        >
          <div className="text-label-sm font-bold text-ds-text-neutral-default-default">
            {section.title ?? 'Chart'}
          </div>
          <div className="mt-1 text-sm text-ds-text-neutral-muted-default">
            Chart preview unavailable.
          </div>
        </section>
      );
    }

    return (
      <section
        key={section.id}
        className="rounded-lg border-ds-border-neutral-subtle-default p-3 border"
      >
        <div className="text-sm text-ds-text-neutral-muted-default">
          Unsupported section: {section.type}
        </div>
      </section>
    );
  };

  // ── Layout ──────────────────────────────────────────────────────────────────

  const modeBadgeTone =
    artifact.interaction_mode === 'approval_required'
      ? 'warning'
      : 'information';

  return (
    <div className="px-sm py-2">
      {/* Card entrance animation */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl border-ds-border-neutral-muted-default bg-ds-bg-neutral-subtle-default overflow-hidden border"
      >
        {/* ── Header — always visible, click to expand/collapse ── */}
        <div
          onClick={() => setIsExpanded((v) => !v)}
          className="gap-2 px-4 py-3 flex w-full cursor-pointer items-center select-none"
        >
          {/* Title + type */}
          <div className="min-w-0 flex-1">
            <div className="text-label-sm font-bold leading-normal text-ds-text-neutral-default-default">
              {artifact.title}
            </div>
            <div className="text-label-xs text-ds-text-neutral-muted-default">
              {artifact.type.replace(/_/g, ' ')}
            </div>
          </div>

          {/* Submitted answer chip — shown when collapsed after action */}
          {submittedLabel !== null ? (
            <Badge
              size="xs"
              tone="success"
              variant="secondary"
              className="gap-1 flex shrink-0 items-center"
            >
              <Check className="h-3 w-3" />
              {submittedLabel}
            </Badge>
          ) : (
            <Badge
              size="xs"
              tone={modeBadgeTone}
              variant="secondary"
              className="shrink-0"
            >
              {artifact.interaction_mode.replace(/_/g, ' ')}
            </Badge>
          )}

          {/* Expand / collapse chevron */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            aria-label={isExpanded ? 'Collapse artifact' : 'Expand artifact'}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((v) => !v);
            }}
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          </Button>
        </div>

        {/* ── Body — animated collapse, scrollable for tall content ── */}
        <motion.div
          animate={{
            height: isExpanded ? 'auto' : 0,
            opacity: isExpanded ? 1 : 0,
          }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div
            ref={bodyRef}
            className="px-4 pb-4 gap-3 flex max-h-[560px] flex-col overflow-y-auto"
          >
            {artifact.sections.map(renderSection)}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
