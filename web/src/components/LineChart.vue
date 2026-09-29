<template>
  <div class="chart-wrap" ref="wrap">
    <div ref="el" />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import uPlot from 'uplot';

const props = defineProps({
  series: { type: Array, required: true }, // [{ name, color, data: [], fill?, step? }]
  timestamps: { type: Array, required: true }, // ms[]
  height: { type: Number, default: 220 },
  legend: { type: Boolean, default: true },
});

const el = ref(null);
const wrap = ref(null);
let plot = null;

function palette(i) {
  const colors = ['#10b981', '#38bdf8', '#f59e0b', '#a78bfa', '#f472b6'];
  return colors[i % colors.length];
}

function build() {
  if (!el.value || props.timestamps.length === 0) {
    plot = null;
    return;
  }
  const data = [props.timestamps, ...props.series.map((s) => s.data)];

  const opts = {
    width: wrap.value ? wrap.value.clientWidth : 600,
    height: props.height,
    scales: { x: { time: true } },
    series: [
      {},
      ...props.series.map((s, i) => ({
        label: s.name || '',
        stroke: s.color || palette(i),
        width: 2,
        spanGaps: true,
        fill: s.fill ? (s.color || palette(i)) + '33' : undefined,
        paths: s.step ? uPlot.paths.stepped() : undefined,
      })),
    ],
    axes: [
      {
        stroke: 'rgba(255,255,255,0.35)',
        grid: { stroke: 'rgba(255,255,255,0.05)', width: 1 },
        ticks: { stroke: 'rgba(255,255,255,0.12)' },
        size: 52,
        font: '11px system-ui',
      },
      {
        stroke: 'rgba(255,255,255,0.35)',
        grid: { stroke: 'rgba(255,255,255,0.05)', width: 1 },
        ticks: { stroke: 'rgba(255,255,255,0.12)' },
        size: 60,
        font: '11px system-ui',
      },
    ],
    legend: { show: props.legend },
    cursor: { stroke: '#10b981', width: 1 },
  };

  plot = new uPlot(opts, data, el.value);
}

function redraw() {
  if (!plot) {
    build();
    return;
  }
  plot.setData([props.timestamps, ...props.series.map((s) => s.data)]);
}

function resize() {
  if (plot && wrap.value) {
    plot.setSize({ width: wrap.value.clientWidth, height: props.height });
  }
}

onMounted(() => {
  build();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  if (plot) {
    plot.destroy();
    plot = null;
  }
});

watch(
  () => [props.timestamps, props.series],
  () => {
    if (props.timestamps.length === 0) {
      if (plot) {
        plot.destroy();
        plot = null;
      }
      return;
    }
    if (plot) redraw();
    else build();
  },
  { deep: false },
);
</script>

<style scoped>
.chart-wrap {
  width: 100%;
  overflow: hidden;
}
</style>