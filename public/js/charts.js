/**
 * charts.js — ECharts initialization helpers
 * Android MDM Dashboard
 */
const Charts = (function () {
  'use strict';

  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('[Charts]', ...args); }

  const instances = new Map();

  /**
   * Dark theme base options
   */
  const darkTheme = {
    backgroundColor: 'transparent',
    textStyle: {
      color: '#94a3b8',
      fontFamily: "'Inter', sans-serif"
    },
    title: {
      textStyle: { color: '#f1f5f9', fontSize: 14, fontWeight: 600 }
    },
    legend: {
      textStyle: { color: '#94a3b8', fontSize: 12 },
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8
    },
    tooltip: {
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      borderWidth: 1,
      textStyle: { color: '#f1f5f9', fontSize: 12 },
      padding: [8, 12]
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '12%',
      containLabel: true
    },
    xAxis: {
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
      splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
    },
    yAxis: {
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
      splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
    }
  };

  /**
   * Initialize a chart on a container element
   */
  function init(container, options) {
    if (!container) {
      log('Container not found');
      return null;
    }
    // Dispose existing instance
    if (instances.has(container)) {
      instances.get(container).dispose();
    }
    if (typeof echarts === 'undefined') {
      log('ECharts not loaded');
      container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Chart library not loaded</div></div>';
      return null;
    }
    const chart = echarts.init(container, null, { renderer: 'canvas' });
    const merged = deepMerge({}, darkTheme, options || {});
    chart.setOption(merged);
    instances.set(container, chart);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);
    chart._resizeObserver = resizeObserver;

    return chart;
  }

  /**
   * Update an existing chart
   */
  function update(container, options, notMerge) {
    const chart = instances.get(container);
    if (!chart) return init(container, options);
    chart.setOption(options, notMerge || false);
    return chart;
  }

  /**
   * Dispose a chart
   */
  function dispose(container) {
    const chart = instances.get(container);
    if (chart) {
      if (chart._resizeObserver) chart._resizeObserver.disconnect();
      chart.dispose();
      instances.delete(container);
    }
  }

  /**
   * Dispose all charts
   */
  function disposeAll() {
    instances.forEach((chart, container) => {
      if (chart._resizeObserver) chart._resizeObserver.disconnect();
      chart.dispose();
    });
    instances.clear();
  }

  /**
   * Create a line chart option
   */
  function lineChart(xData, series, options = {}) {
    return {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: xData, boundaryGap: false },
      yAxis: { type: 'value' },
      series: series.map((s, i) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        data: s.data,
        lineStyle: { width: 2, color: s.color || ['#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6'][i % 5] },
        itemStyle: { color: s.color || ['#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6'][i % 5] },
        areaStyle: s.area ? {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: (s.color || '#3b82f6') + '40' },
              { offset: 1, color: (s.color || '#3b82f6') + '05' }
            ]
          }
        } : undefined
      })),
      ...options
    };
  }

  /**
   * Create a horizontal bar chart option
   */
  function horizontalBarChart(categories, values, options = {}) {
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '8%', bottom: '3%', top: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: categories, inverse: true },
      series: [{
        type: 'bar',
        data: values,
        barWidth: '60%',
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#3b82f6' },
              { offset: 1, color: '#06b6d4' }
            ]
          }
        },
        label: {
          show: true,
          position: 'right',
          color: '#94a3b8',
          fontSize: 11,
          formatter: options.labelFormatter || '{c}'
        }
      }],
      ...options
    };
  }

  /**
   * Create a pie/donut chart option
   */
  function pieChart(data, options = {}) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6'];
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: '#94a3b8', fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#111827', borderWidth: 2 },
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 13, fontWeight: 'bold', color: '#f1f5f9' }
        },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: d.color || colors[i % colors.length] } }))
      }],
      ...options
    };
  }

  /**
   * Deep merge helper
   */
  function deepMerge(target, ...sources) {
    sources.forEach(source => {
      if (!source) return;
      Object.keys(source).forEach(key => {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null) {
          if (!target[key] || typeof target[key] !== 'object') target[key] = {};
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      });
    });
    return target;
  }

  return {
    init,
    update,
    dispose,
    disposeAll,
    lineChart,
    horizontalBarChart,
    pieChart,
    darkTheme
  };
})();
