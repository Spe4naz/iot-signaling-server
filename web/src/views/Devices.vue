<template>
  <div>
    <div class="toolbar">
      <el-input
        v-model="query"
        placeholder="Поиск по id / ip / имени"
        clearable
        style="width: 280px"
        :prefix-icon="Search"
        @input="load"
      />
      <el-select v-model="statusFilter" placeholder="Статус" clearable style="width: 150px" @change="load">
        <el-option label="В сети" value="online" />
        <el-option label="Оффлайн" value="offline" />
      </el-select>
      <el-button type="primary" :icon="Plus" @click="openCreate">Добавить</el-button>
      <el-button :icon="Refresh" circle @click="load" :loading="loading" />
      <el-tag type="info" effect="plain">{{ list.length }} из {{ total }}</el-tag>
    </div>

    <el-table :data="list" v-loading="loading" size="default">
      <el-table-column label="id" min-width="160">
        <template #default="{ row }">
          <el-button text type="primary" style="font-family: Consolas, monospace" @click="openDetail(row)">
            {{ row.id }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="Имя" width="180" />
      <el-table-column prop="type" label="Тип" width="110" />
      <el-table-column prop="ip" label="IP" width="130">
        <template #default="{ row }">{{ row.ip }}:{{ row.port }}</template>
      </el-table-column>
      <el-table-column label="Статус" width="120">
        <template #default="{ row }">
          <span class="pill" :class="row.status === 'online' ? 'dot-online' : 'dot-offline'">
            <span class="dot" />
            {{ row.status === 'online' ? 'В сети' : 'Оффлайн' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="firmwareVersion" label="FW" width="110" />
      <el-table-column label="Аптайм 24ч" width="110">
        <template #default="{ row }">{{ pct(row.uptime24) }}</template>
      </el-table-column>
      <el-table-column label="Сенсоры" min-width="140">
        <template #default="{ row }">
          <el-tag
            v-for="s in row.sensors || []"
            :key="s"
            size="small"
            effect="plain"
            style="margin-right: 4px"
          >
            {{ s }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Последний раз" width="150">
        <template #default="{ row }">{{ relTime(row.lastSeen) }}</template>
      </el-table-column>
      <el-table-column label="Действия" width="120" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" :icon="Edit" @click="openEdit(row)" />
          <el-button text size="small" type="danger" :icon="Delete" @click="remove(row)" />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg.visible" :title="dlg.isEdit ? `Редактировать ${dlg.form.id}` : 'Добавить устройство'" width="520px">
      <el-form label-width="110px">
        <el-form-item v-if="!dlg.isEdit" label="ID" required>
          <el-input v-model="dlg.form.id" placeholder="esp32-living-room" />
        </el-form-item>
        <el-form-item label="Имя">
          <el-input v-model="dlg.form.name" placeholder="Гостиная (ESP32)" />
        </el-form-item>
        <el-form-item label="Тип">
          <el-select v-model="dlg.form.type" style="width: 100%">
            <el-option label="esp32" value="esp32" />
            <el-option label="esp32s3" value="esp32s3" />
            <el-option label="esp8266" value="esp8266" />
            <el-option label="generic" value="generic" />
          </el-select>
        </el-form-item>
        <el-form-item label="IP" required>
          <el-input v-model="dlg.form.ip" placeholder="192.168.0.155" />
        </el-form-item>
        <el-form-item label="Port">
          <el-input-number v-model="dlg.form.port" :min="0" :max="65535" />
        </el-form-item>
        <el-form-item label="Сенсоры">
          <el-input v-model="dlg.form.sensorsText" placeholder="temperature, humidity, motion" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">Отмена</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">Сохранить</el-button>
      </template>
    </el-dialog>

    <div class="footer-note">
      Реестр устройств; динамика статусов/аптайма и алерты устройства — в карточке (клик по id).
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, inject, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search, Edit, Delete } from '@element-plus/icons-vue';
import { api } from '../api';
import { relTime, pct } from '../utils';

const router = useRouter();
const ticker = inject('panelTicker', ref(0));
const loading = ref(false);
const list = ref([]);
const total = ref(0);
const query = ref('');
const statusFilter = ref('');

const dlg = reactive({
  visible: false,
  isEdit: false,
  saving: false,
  form: {},
});

async function load() {
  loading.value = true;
  try {
    const data = await api.devices(query.value, statusFilter.value || '');
    list.value = Array.isArray(data) ? data : data.items || data.devices || [];
    total.value = list.value.length;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function baseForm() {
  return {
    id: '',
    name: '',
    type: 'esp32',
    ip: '',
    port: 80,
    sensorsText: '',
  };
}

function openCreate() {
  dlg.isEdit = false;
  dlg.form = baseForm();
  dlg.visible = true;
}

function openEdit(row) {
  dlg.isEdit = true;
  dlg.form = {
    ...baseForm(),
    id: row.id,
    name: row.name || '',
    type: row.type || 'esp32',
    ip: row.ip || '',
    port: row.port || 80,
    sensorsText: (row.sensors || []).join(', '),
  };
  dlg.visible = true;
}

function openDetail(row) {
  router.push(`/devices/${encodeURIComponent(row.id)}`);
}

function parseSensors(text) {
  return (text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function save() {
  const f = dlg.form;
  if (!f.id || !f.ip) {
    ElMessage.warning('Укажите ID и IP');
    return;
  }
  dlg.saving = true;
  const body = {
    name: f.name,
    type: f.type,
    ip: f.ip,
    port: f.port,
    sensors: parseSensors(f.sensorsText),
  };
  if (!dlg.isEdit) body.id = f.id;
  try {
    if (dlg.isEdit) {
      await api.updateDevice(f.id, body);
      ElMessage.success('Устройство обновлено');
    } else {
      await api.createDevice(body);
      ElMessage.success('Устройство добавлено');
    }
    dlg.visible = false;
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    dlg.saving = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`Удалить устройство ${row.id}?`, 'Удаление', {
      type: 'warning',
      confirmButtonText: 'Удалить',
      cancelButtonText: 'Отмена',
    });
  } catch {
    return;
  }
  try {
    await api.deleteDevice(row.id);
    ElMessage.success('Удалено');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

watch(ticker, load);
onMounted(load);
</script>