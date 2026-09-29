<template>
  <div>
    <div class="toolbar">
      <el-select v-model="deviceFilter" placeholder="Устройство" clearable filterable style="width: 240px" @change="load">
        <el-option v-for="d in devices" :key="d.id" :label="d.id" :value="d.id" />
      </el-select>
      <el-button type="primary" :icon="Plus" @click="openCreate">Добавить алерт</el-button>
      <el-button :icon="Refresh" circle @click="load" :loading="loading" />
      <el-tag type="info" effect="plain">{{ list.length }}</el-tag>
    </div>

    <el-table :data="list" v-loading="loading">
      <el-table-column prop="device_id" label="Устройство" min-width="160" />
      <el-table-column prop="sensor_type" label="Сенсор" width="170" />
      <el-table-column label="Условие" width="150">
        <template #default="{ row }">
          {{ typeLabel(row.type) }} {{ row.threshold }}
        </template>
      </el-table-column>
      <el-table-column label="Активен" width="100">
        <template #default="{ row }">
          <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
            {{ row.is_active ? 'да' : 'нет' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Сработал" width="170">
        <template #default="{ row }">{{ relTime(row.triggered_at) }}</template>
      </el-table-column>
      <el-table-column label="Создан" width="170">
        <template #default="{ row }">{{ fmtTime(new Date(row.created_at).getTime()) }}</template>
      </el-table-column>
      <el-table-column label="Действия" width="120" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" :icon="Edit" @click="openEdit(row)" />
          <el-button text size="small" type="danger" :icon="Delete" @click="remove(row)" />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg.visible" :title="dlg.isEdit ? `Алерт ${dlg.form.device_id}` : 'Добавить алерт'" width="480px">
      <el-form label-width="120px">
        <el-form-item label="Устройство" required>
          <el-select v-model="dlg.form.device_id" filterable style="width: 100%">
            <el-option v-for="d in devices" :key="d.id" :label="d.id" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="Сенсор" required>
          <el-input v-model="dlg.form.sensor_type" placeholder="temperature" />
        </el-form-item>
        <el-form-item label="Условие" required>
          <el-select v-model="dlg.form.type" style="width: 140px">
            <el-option label="выше" value="above" />
            <el-option label="ниже" value="below" />
            <el-option label="равно" value="equals" />
          </el-select>
          <el-input-number v-model="dlg.form.threshold" :step="0.5" style="margin-left: 10px" />
        </el-form-item>
        <el-form-item label="Активен">
          <el-switch v-model="dlg.form.is_active" />
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
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Edit, Delete } from '@element-plus/icons-vue';
import { api } from '../api';
import { relTime, fmtTime } from '../utils';

const loading = ref(false);
const list = ref([]);
const devices = ref([]);
const deviceFilter = ref('');

const dlg = reactive({ visible: false, isEdit: false, saving: false, id: null, form: {} });

function typeLabel(t) {
  return { above: 'выше', below: 'ниже', equals: '=' }[t] || t;
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
    list.value = await api.alerts();
    if (deviceFilter.value) {
      list.value = list.value.filter((a) => a.device_id === deviceFilter.value);
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function baseForm() {
  return { device_id: '', sensor_type: '', type: 'above', threshold: 25, is_active: true };
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
    device_id: row.device_id,
    sensor_type: row.sensor_type,
    type: row.type,
    threshold: row.threshold,
    is_active: row.is_active,
  };
  dlg.visible = true;
}

async function save() {
  const f = dlg.form;
  if (!f.device_id || !f.sensor_type) {
    ElMessage.warning('Укажите устройство и сенсор');
    return;
  }
  dlg.saving = true;
  try {
    if (dlg.isEdit) {
      await api.updateAlert(dlg.id, f);
    } else {
      await api.createAlert(f);
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
    await ElMessageBox.confirm(`Удалить алерт для ${row.device_id} (${row.sensor_type})?`, 'Удаление', {
      type: 'warning',
      confirmButtonText: 'Удалить',
      cancelButtonText: 'Отмена',
    });
  } catch {
    return;
  }
  try {
    await api.deleteAlert(row.id);
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