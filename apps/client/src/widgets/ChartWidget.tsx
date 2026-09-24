import { useEffect, useMemo, useRef, useState } from 'react';
import type { RegisteredWidget, WidgetProps } from './types';

/**
 * Chart widget.
 *
 * ECharts is loaded on demand rather than bundled: it is by far the largest
 * dependency here, and most pages have no chart on them. A page that does pays for
 * it once, and the published runtime of an app without charts never fetches it.
 */

type EChartsModule = typeof import('echarts');
type EChartsInstance = ReturnType<EChartsModule['init']>;

let echartsPromise: Promise<EChartsModule> | null = null;

function loadECharts(): Promise<EChartsModule> {
  echartsPromise ??= import('echarts');
  return echartsPromise;
}

function ChartWidget({ properties, fireEvent, isDesignMode }: WidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const [echarts, setECharts] = useState<EChartsModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const rows = useMemo<Record<string, unknown>[]>(
    () => (Array.isArray(properties.data) ? (properties.data as Record<string, unknown>[]) : []),
    [properties.data],
  );

  const option = useMemo(() => buildOption(properties, rows), [properties, rows]);

  useEffect(() => {
    let cancelled = false;
    loadECharts()
      .then((module) => !cancelled && setECharts(module))
      .catch((error) =>
        !cancelled && setLoadError(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!echarts || !containerRef.current) return;

    chartRef.current ??= echarts.init(containerRef.current);
    const chart = chartRef.current;
    chart.setOption(option, true);

    // Grid widgets are resized by dragging, which does not fire a window resize.
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);

    const onClick = (params: { name?: string; value?: unknown; dataIndex?: number }): void => {
      if (isDesignMode) return;
      fireEvent('onDataPointClick', {
        name: params.name,
        value: params.value,
        index: params.dataIndex,
      });
    };
    chart.on('click', onClick);

    return () => {
      observer.disconnect();
      chart.off('click', onClick);
    };
  }, [echarts, option, fireEvent, isDesignMode]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    [],
  );

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
        Charting library failed to load: {loadError}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
        Bind this chart to a query, e.g. {'{{ GetSales.data }}'}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}

function buildOption(
  properties: Record<string, unknown>,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  const type = String(properties.chartType ?? 'bar');
  const xKey = String(properties.xKey ?? Object.keys(rows[0] ?? {})[0] ?? '');
  const yKeys = Array.isArray(properties.yKeys)
    ? (properties.yKeys as string[])
    : properties.yKey
      ? [String(properties.yKey)]
      : Object.keys(rows[0] ?? {})
          .filter((key) => key !== xKey && Number.isFinite(Number(rows[0]?.[key])))
          .slice(0, 1);

  const common = {
    title: properties.title ? { text: String(properties.title), left: 8, top: 4, textStyle: { fontSize: 13 } } : undefined,
    tooltip: { trigger: type === 'pie' ? 'item' : 'axis' },
    legend: yKeys.length > 1 ? { bottom: 0, type: 'scroll' } : undefined,
    grid: { left: 48, right: 16, top: properties.title ? 36 : 16, bottom: yKeys.length > 1 ? 36 : 24 },
  };

  if (type === 'pie') {
    return {
      ...common,
      grid: undefined,
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          data: rows.map((row) => ({
            name: String(row[xKey] ?? ''),
            value: Number(row[yKeys[0] ?? ''] ?? 0),
          })),
        },
      ],
    };
  }

  return {
    ...common,
    xAxis: { type: 'category', data: rows.map((row) => String(row[xKey] ?? '')) },
    yAxis: { type: 'value' },
    series: yKeys.map((key) => ({
      name: key,
      type: type === 'area' ? 'line' : type,
      areaStyle: type === 'area' ? {} : undefined,
      smooth: type === 'area' || type === 'line',
      data: rows.map((row) => Number(row[key] ?? 0)),
    })),
  };
}

export const chartWidget: RegisteredWidget = {
  component: ChartWidget,
  definition: {
    type: 'chart',
    displayName: 'Chart',
    category: 'chart',
    icon: 'chart',
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 4, h: 5 },
    events: [
      { key: 'onDataPointClick', label: 'On data point click', payloadKeys: ['name', 'value', 'index'] },
    ],
    exposedState: [],
    properties: [
      {
        name: 'Data',
        properties: [
          {
            key: 'data',
            label: 'Chart data',
            control: 'code',
            expectedType: 'array',
            bindable: true,
            helpText: 'Rows from a query, e.g. {{ GetSales.data }}',
          },
          { key: 'xKey', label: 'Category field', control: 'text', expectedType: 'string', bindable: false, helpText: 'Column used for the x axis' },
          { key: 'yKey', label: 'Value field', control: 'text', expectedType: 'string', bindable: false, helpText: 'Column plotted; leave blank to guess' },
          {
            key: 'yKeys',
            label: 'Value fields',
            control: 'json',
            expectedType: 'array',
            bindable: false,
            helpText: 'Several columns for a multi-series chart, e.g. ["revenue","cost"]',
          },
        ],
      },
      {
        name: 'Appearance',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true },
          { key: 'chartType', label: 'Type', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'bar' },
        ],
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'onDataPointClick', label: 'On data point click', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};
