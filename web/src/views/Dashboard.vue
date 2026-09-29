<template>
  <div>
    <div class="toolbar">
      <span style="color: var(--panel-text-dim)">Сводка сервера + метрики за {{ hoursText }}ч</span>
      <el-tag v-if="loading" type="info" effect="plain" size="small">обновление…</el-tag>
    </div>

    <el-row :gutter="14">
      <el-col :span="6">
        <div class="stat-card">
          <div class="label">Устройства</div>
          <div class="value">
            {{ total || '—' }}
            <el-tag size="small" type="success" effect="dark" style="margin-left: 6px">
              онлайн {{ online || 0 }}
            </el-tag>
            <el-tag size="small" type="danger" effect="dark" style="margin-left: 4px">
              оффлайн {{ offline || 0 }}
            </el-tag>
          </div>
          <div class="hint">Всего в реестре</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="label">Алерты</div>
          <div class="value">
            {{ activeAlerts || '—' }}
            <el-tag size="small" type="warning" effect="dark" style="margin-left: 6px">
              всего {{ totalAlerts || 0 }}
            </el-tag>
          </div>
          <div class="hint">Сработавшие правила</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="label">Правила</div>
          <div class="value">
            {{ enabledRules || '—' }}
            <el-tag size="small" type="primary" effect="dark" style="margin-left: 6px">
              всего {{ totalRules || 0 }}
            </el-tag>
          </div>
          <div class="hint">Умный дом</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="label">CPU / RAM</div>
          <div class="value">
            {{ cpu }}% <span style="color: var(--panel-text-dim); font-size: 16px">/</span> {{ mem }}%
          </div>
          <div class="hint" style="color: var(--panel-accent)">
            аптайм сервера: {{ upTime }}
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px">
      <el-col :span="12">
        <div class="chart-card">
          <div class="chart-title">CPU и Memory</div>
          <LineChart
            :timestamps="ts"
            :series="cpuMemSeries"
            :height="200"
          />
        </div>
      </el-col>
      <el-col :span="12">
        <div class="chart-card">
          <div class="chart-title">System Load</div>
          <LineChart
            :timestamps="ts"
            :series="loadSeries"
            :height="200"
          />
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px">
      <el-col :span="12">
        <div class="chart-card">
          <div class="chart-title">Запросы/мин и латентность</div>
          <LineChart
            :timestamps="ts"
            :series="reqSeries"
            :height="200"
          />
        </div>
      </el-col>
      <el-col :span="12">
        <div class="chart-card">
          <div class="chart-title">Устройства онлайн</div>
          <LineChart
            :timestamps="ts"
            :series="onlineSeries"
            :height="200"
          />
        </div>
      </el-col>
    </el-row>

    <el-card v-if="alerts.length" shadow="never" style="margin-top: 14px">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>Последние алерты</span>
          <el-button text type="primary" size="small" @click="$router.push('/alerts')">Все алерты</el-button>
        </div>
      </template>
      <el-table :data="alerts.slice(0, 8)" size="small">
        <el-table-column prop="device_id" label="Устройство" width="200" />
        <el-table-column prop="sensor_type" label="Сенсор" width="160" />
        <el-table-column label="Тип" width="120">
          <template #default="{ row }">{{ row.type }}</template>
        </el-table-column>
        <el-table-column label="Порог" width="120">
          <template #default="{ row }">{{ row.threshold }}</template>
        </el-table-column>
        <el-table-column label="Сработал">
          <template #default="{ row }">{{ relTime(row.triggered_at) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <div v-if="!ts.length" class="footer-note">
      Метрики ещё не собраны — данные появятся через несколько секунд.
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, watch, onMounted, onUnmounted } from 'vue';
import { api } from '../api';
import LineChart from '../components/LineChart.vue';
import { relTime, fmtDuration } from '../utils';

const ticker = inject('panelTicker', ref(0));
const loading = ref(false);
const sys = ref(null);
const hist = ref(null);
const alerts = ref([]);

async function loadSys() {
  try {
    sys.value = await api.system();
  } catch {
    /* keep last */
  }
}

async function loadHist() {
  try {
    hist.value = await api.history(160);
  } catch {
    /* keep last */
  }
}

async function loadAlerts() {
  try {
    alerts.value = await api.alerts();
  } catch {
    /* keep last */
  }
}

const total = computed(() => sys.value?.devices?.total ?? null);
const online = computed(() => sys.value?.devices?.online ?? null);
const offline = computed(() => sys.value?.devices?.offline ?? null);
const activeAlerts = computed(() => sys.value?.alerts?.active ?? null);
const totalAlerts = computed(() => sys.value?.alerts?.total ?? null);
const enabledRules = computed(() => sys.value?.rules?.enabled ?? null);
const totalRules = computed(() => sys.value?.rules?.total ?? null);
const cpu = computed(() => (sys.value?.cpu_percent ?? null));
const mem = computed(() => (sys.value?.mem_percent ?? null));
const upTime = computed(() => fmtDuration(sys.value?.uptime_sec));
const hoursText = computed(() => (sys.value?.metrics_window_hours ?? 24));

const ts = computed(() => hist.value?.timestamps || []);
const m = computed(() => hist.value?.metrics || {});

const cpuMemSeries = computed(() => [
  { name: 'CPU %', color: '#38bdf8', data: m.value.cpu || [], fill: true },
  { name: 'MEM %', color: '#a78bfa', data: m.value.mem || [], fill: true },
]);
const loadSeries = computed(() => [
  { name: 'Load', color: '#f59e0b', data: m.value.load || [] },
]);
const reqSeries = computed(() => [
  { name: 'req/min', color: '#10b981', data: m.value.req_min || [] },
  { name: 'avg ms', color: '#f472b6', data: m.value.avg_ms || [] },
]);
const onlineSeries = computed(() => [
  { name: 'online', color: '#10b981', data: m.value.online || [], step: true, fill: true },
]);

let timers = [];

async function refresh() {
  loading.value = true;
  await Promise.all([loadSys(), loadHist(), loadAlerts()]);
  loading.value = false;
}

watch(ticker, refresh);

onMounted(() => {
  refresh();
  timers.push(setInterval(loadSys, 30000));
  timers.push(setInterval(loadAlerts, 30000));
  timers.push(setInterval(loadHist, 60000));
});

onUnmounted(() => timers.forEach((t) => clearInterval(t)));
</script>