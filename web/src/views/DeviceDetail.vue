<template>
  <div v-loading="loading">
    <div class="toolbar">
      <el-button :icon="ArrowLeft" @click="$router.push('/devices')">Устройства</el-button>
      <el-tag
        v-if="detail"
        :type="detail.device.online ? 'success' : 'danger'"
        effect="dark"
      >
        {{ detail.device.online ? 'В сети' : 'Оффлайн' }}
      </el-tag>
    </div>

    <template v-if="detail">
      <el-row :gutter="14">
        <el-col :span="6">
          <div class="stat-card">
            <div class="label">Аптайм 24ч</div>
            <div class="value">{{ pct(detail.stability.uptime24) }}</div>
            <div class="hint">журнал за {{ fmtDuration(stabilityWindow) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="label">Аптайм 7 дн</div>
            <div class="value">{{ pct(detail.stability.uptime7d) }}</div>
            <div class="hint">среднее за неделю</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="label">Конечная точка</div>
            <div class="value mono" style="font-size: 18px">
              {{ detail.device.ip }}:{{ detail.device.port }}
            </div>
            <div class="hint">тип {{ detail.device.type }} · FW {{ detail.device.firmwareVersion || '—' }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="label">Сенсоры</div>
            <div class="value" style="font-size: 18px">
              <el-tag
                v-for="s in detail.device.sensors || []"
                :key="s"
                size="small"
                effect="plain"
                style="margin: 2px"
              >
                {{ s }}
              </el-tag>
            </div>
            <div class="hint">последний сигнал: {{ relTime(detail.device.last_seen) }}</div>
          </div>
        </el-col>
      </el-row>

      <div class="chart-card" style="margin-top: 14px">
        <div class="chart-title">Таймлайн статусов</div>
        <LineChart v-if="tl.ts.length" :timestamps="tl.ts" :series="tl.series" :height="200" :legend="true" />
        <div v-else class="chart-placeholder">Событий подключения ещё нет</div>
      </div>

      <el-row :gutter="14" style="margin-top: 14px">
        <el-col :span="12">
          <el-card shadow="never">
            <template #header>
              <div style="display: flex; justify-content: space-between; align-items: center">
                <span>События ({{ detail.stability.events.length }})</span>
                <el-button text size="small" type="primary" @click="$router.push('/devices')">Изменение в списке</el-button>
              </div>
            </template>
            <el-table :data="detail.stability.events.slice().reverse()" size="small" max-height="320">
              <el-table-column label="Время">
                <template #default="{ row }">{{ fmtClock(row.t) }}</template>
              </el-table-column>
              <el-table-column label="Статус">
                <template #default="{ row }">
                  <el-tag :type="row.s === 'online' ? 'success' : 'danger'" size="small">
                    {{ row.s === 'online' ? 'онлайн' : 'оффлайн' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card shadow="never">
            <template #header>
              <span>Связанные алерты ({{ detail.alerts.length }}) · правила ({{ detail.rules.length }})</span>
            </template>
            <el-table :data="detail.alerts" size="small" max-height="150">
              <el-table-column prop="sensor_type" label="Алерт" />
              <el-table-column label="Тип / порог">
                <template #default="{ row }">{{ row.type }} {{ row.threshold }}</template>
              </el-table-column>
              <el-table-column label="Активен">
                <template #default="{ row }">
                  <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
                    {{ row.is_active ? 'да' : 'нет' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
            <el-table :data="detail.rules" size="small" max-height="150" style="margin-top: 8px">
              <el-table-column prop="name" label="Правило" />
              <el-table-column prop="trigger" label="Триггер" />
              <el-table-column label="Действие">
                <template #default="{ row }">{{ row.action }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-col>
      </el-row>
    </template>

    <template v-else-if="!loading">
      <el-empty description="Устройство не найдено">
        <el-button type="primary" @click="$router.push('/devices')">К списку</el-button>
      </el-empty>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import { api } from '../api';
import LineChart from '../components/LineChart.vue';
import { relTime, fmtClock, fmtDuration, pct } from '../utils';

const route = useRoute();
const loading = ref(false);
const detail = ref(null);

async function load() {
  loading.value = true;
  try {
    detail.value = await api.device(route.params.id);
  } catch {
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

const stabilityWindow = computed(() => 7 * 24 * 3600);
const tl = computed(() => {
  const events = detail.value?.stability?.events || [];
  if (!events.length) return { ts: [], series: [] };
  const ts = events.map((e) => e.t);
  const data = events.map((e) => (e.s === 'online' ? 1 : 0));
  return {
    ts,
    series: [{ name: 'status', color: '#10b981', data, step: true }],
  };
});

onMounted(load);
</script>