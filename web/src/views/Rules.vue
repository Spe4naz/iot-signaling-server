<template>
  <div>
    <div class="toolbar">
      <el-select v-model="deviceFilter" placeholder="Устройство" clearable filterable style="width: 240px" @change="load">
        <el-option v-for="d in devices" :key="d.id" :label="d.id" :value="d.id" />
      </el-select>
      <el-button type="primary" :icon="Plus" @click="openCreate">Добавить правило</el-button>
      <el-button :icon="Refresh" circle @click="load" :loading="loading" />
      <el-tag type="info" effect="plain">{{ list.length }}</el-tag>
    </div>

    <el-table :data="list" v-loading="loading">
      <el-table-column prop="name" label="Имя" min-width="160" />
      <el-table-column prop="device_id" label="Устройство" min-width="150" />
      <el-table-column label="Триггер" width="200">
        <template #default="{ row }">{{ triggerLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="Действие" width="200">
        <template #default="{ row }">{{ actionLabel(row.action) }}</template>
      </el-table-column>
      <el-table-column label="Кулдаун" width="110">
        <template #default="{ row }">{{ row.cooldown_seconds }} с</template>
      </el-table-column>
      <el-table-column label="Вкл" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="true" />
        </template>
      </el-table-column>
      <el-table-column label="Действия" width="120" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" :icon="Edit" @click="openEdit(row)" />
          <el-button text size="small" type="danger" :icon="Delete" @click="remove(row)" />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg.visible" :title="dlg.isEdit ? `Правило ${dlg.form.name}` : 'Добавить правило'" width="560px">
      <el-form label-width="130px">
        <el-form-item label="Имя" required>
          <el-input v-model="dlg.form.name" placeholder="Включить свет при открытии" />
        </el-form-item>
        <el-form-item label="Устройство" required>
          <el-select v-model="dlg.form.device_id" filterable style="width: 100%">
            <el-option v-for="d in devices" :key="d.id" :label="d.id" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="Триггер" required>
          <el-select v-model="dlg.form.trigger" style="width: 100%">
            <el-option label="Порог выше" value="threshold_above" />
            <el-option label="Порог ниже" value="threshold_below" />
            <el-option label="Устройство в сети" value="online" />
            <el-option label="Устройство оффлайн" value="offline" />
            <el-option label="Нет данных" value="no_data" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="needsThreshold" label="Сенсор" required>
          <el-input v-model="dlg.form.sensor_type" placeholder="temperature" />
        </el-form-item>
        <el-form-item v-if="needsThreshold" label="Порог" required>
          <el-input-number v-model="dlg.form.threshold" :step="0.5" />
        </el-form-item>
        <el-form-item label="Действие" required>
          <el-select v-model="dlg.form.action" style="width: 100%">
            <el-option label="Уведомление" value="notify" />
            <el-option label="MQTT-команда" value="mqtt_command" />
            <el-option label="Команда на устройство" value="device_command" />
          </el-select>
        </el-form-item>
        <el-form-item label="Payload (JSON)">
          <el-input
            v-model="dlg.form.action_payload"
            type="textarea"
            :rows="2"
            placeholder='{"topic": "home/light", "payload": "on"}'
          />
        </el-form-item>
        <el-form-item label="Кулдаун (сек)">
          <el-input-number v-model="dlg.form.cooldown_seconds" :min="0" :max="604800" />
        </el-form-item>
        <el-form-item label="Включено">
          <el-switch v-model="dlg.form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">Отмена</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">Сохранить</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Edit, Delete } from '@element-plus/icons-vue';
import { api } from '../api';

const loading = ref(false);
const list = ref([]);
const devices = ref([]);
const deviceFilter = ref('');

const dlg = reactive({ visible: false, isEdit: false, saving: false, id: null, form: {} });

const needsThreshold = computed(
  () => dlg.form.trigger === 'threshold_above' || dlg.form.trigger === 'threshold_below',
);

function triggerLabel(r) {
  if (r.trigger === 'threshold_above') return `${r.sensor_type} > ${r.threshold}`;
  if (r.trigger === 'threshold_below') return `${r.sensor_type} < ${r.threshold}`;
  if (r.trigger === 'online') return 'устройство в сети';
  if (r.trigger === 'offline') return 'устройство оффлайн';
  return 'нет данных';
}

function actionLabel(a) {
  return { notify: 'Уведомление', mqtt_command: 'MQTT-команда', device_command: 'Команда на устройство' }[a] || a;
}

async function loadDevices() {
  try {
    devices.value = await api.devices();
  } catch {
    devices.value = [];
  }
}

async function load() {
  loading.value = true;
  try {
    list.value = await api.rules();
    if (deviceFilter.value) {
      list.value = list.value.filter((r) => r.device_id === deviceFilter.value);
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function baseForm() {
  return {
    name: '',
    device_id: '',
    trigger: 'threshold_above',
    sensor_type: '',
    threshold: 0,
    action: 'notify',
    action_payload: '',
    cooldown_seconds: 60,
    enabled: true,
  };
}

function openCreate() {
  dlg.isEdit = false;
  dlg.id = null;
  dlg.form = baseForm();
  dlg.visible = true;
}

function openEdit(row) {
  dlg.isEdit = true;
  dlg.id = row.id;
  dlg.form = {
    name: row.name,
    device_id: row.device_id,
    trigger: row.trigger,
    sensor_type: row.sensor_type || '',
    threshold: row.threshold ?? 0,
    action: row.action,
    action_payload: row.action_payload || '',
    cooldown_seconds: row.cooldown_seconds,
    enabled: row.enabled,
  };
  dlg.visible = true;
}

async function save() {
  const f = dlg.form;
  if (!f.name || !f.device_id) {
    ElMessage.warning('Заполните имя и устройство');
    return;
  }
  if (needsThreshold.value && !f.sensor_type) {
    ElMessage.warning('Укажите сенсор для порогового триггера');
    return;
  }
  dlg.saving = true;
  try {
    const body = { ...f };
    if (!needsThreshold.value) {
      delete body.sensor_type;
      delete body.threshold;
    }
    if (dlg.isEdit) {
      await api.updateRule(dlg.id, body);
    } else {
      await api.createRule(body);
    }
    ElMessage.success('Сохранено');
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
    await ElMessageBox.confirm(`Удалить правило «${row.name}»?`, 'Удаление', {
      type: 'warning',
      confirmButtonText: 'Удалить',
      cancelButtonText: 'Отмена',
    });
  } catch {
    return;
  }
  try {
    await api.deleteRule(row.id);
    ElMessage.success('Удалено');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(() => {
  loadDevices();
  load();
});
</script>