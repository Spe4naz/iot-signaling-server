<template>
  <div v-loading="loading">
    <el-row :gutter="14">
      <el-col :span="16">
        <el-card shadow="never">
          <template #header><span>Сервер</span></template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="Версия">{{ settings.version }}</el-descriptions-item>
            <el-descriptions-item label="API-префикс">{{ settings.api_prefix }}</el-descriptions-item>
            <el-descriptions-item label="Панель">
              {{ settings.panel?.path }}
              <el-tag :type="settings.panel?.enabled ? 'success' : 'danger'" size="small">
                {{ settings.panel?.enabled ? 'вкл' : 'выкл' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="API-токен">
              <el-tag :type="settings.api_token_set ? 'success' : 'warning'" size="small" effect="plain">
                {{ settings.api_token_set ? 'задан' : 'не задан' }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never" style="margin-top: 14px">
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <span>Параметры (перезаписывают переменные среды)</span>
              <el-tag size="small" type="success" v-if="saved">сохранено · применяется сразу</el-tag>
            </div>
          </template>

          <el-form label-width="190px">
            <el-divider content-position="left">Работа реестра</el-divider>
            <el-form-item label="Время stale (мс)">
              <el-input-number v-model="form.stale_ms" :min="1000" :max="600000" :step="1000" />
              <span class="form-hint">макс. интервал heartbeat до «оффлайн»</span>
            </el-form-item>
            <el-form-item label="Устройств с одного IP">
              <el-input-number v-model="form.max_devices_per_ip" :min="1" :max="10000" />
            </el-form-item>

            <el-divider content-position="left">История метрик</el-divider>
            <el-form-item label="Глубина истории (ч)">
              <el-input-number v-model="form.metrics_hours" :min="1" :max="720" />
              <span class="form-hint">точка каждые 10с, далее аггрегация</span>
            </el-form-item>

            <el-divider content-position="left">Rate limits (окно = window_ms)</el-divider>
            <el-form-item label="Окно (мс)">
              <el-input-number v-model="form.rate_limits.window_ms" :min="1000" :max="3600000" :step="1000" />
            </el-form-item>
            <el-form-item label="register (N/окно)">
              <el-input-number v-model="form.rate_limits.register" :min="0" :max="100000" />
            </el-form-item>
            <el-form-item label="heartbeat (N/окно)">
              <el-input-number v-model="form.rate_limits.heartbeat" :min="0" :max="100000" />
            </el-form-item>
            <el-form-item label="write (N/окно)">
              <el-input-number v-model="form.rate_limits.write" :min="0" :max="100000" />
            </el-form-item>
            <el-form-item label="read (N/окно)">
              <el-input-number v-model="form.rate_limits.read" :min="0" :max="100000" />
            </el-form-item>

            <el-divider content-position="left">Сессия панели</el-divider>
            <el-form-item label="TTL сессии (мс)">
              <el-input-number v-model="form.session_ttl_ms" :min="60000" :max="86400000" :step="60000" />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">Сохранить</el-button>
              <el-button @click="reload">Сбросить форму</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="never">
          <template #header><span>Безопасность</span></template>
          <el-form label-position="top">
            <el-form-item label="API-токен устройств">
              <el-input
                v-model="token.newValue"
                type="password"
                show-password
                :placeholder="settings.api_token_set ? '•••••••• (оставьте пустым, чтобы не менять)' : 'не задан — задайте'"
              />
              <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap">
                <el-button type="primary" size="small" @click="saveToken">Сохранить токен</el-button>
                <el-button v-if="settings.api_token_set" size="small" type="warning" @click="clearToken">
                  Очистить токен
                </el-button>
              </div>
            </el-form-item>

            <el-form-item label="Пароль панели (min 8)">
              <el-input
                v-model="token.newPassword"
                type="password"
                show-password
                placeholder="оставьте пустым, чтобы не менять"
              />
              <el-button size="small" type="primary" style="margin-top: 8px" @click="savePassword">
                Сменить пароль
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" style="margin-top: 14px">
          <template #header><span>Обслуживание</span></template>
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            :title="'Перезапуск сервера: регистр и метрики будут сброшены в память? Нет — всё персистится. Сессия панели будет разорвана.'"
          />
          <el-button type="danger" style="width: 100%; margin-top: 10px" @click="restart">
            Перезапустить сервер
          </el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const loading = ref(false);
const saving = ref(false);
const saved = ref(false);
const settings = ref({});
const form = reactive({
  stale_ms: 30000,
  max_devices_per_ip: 3,
  metrics_hours: 24,
  session_ttl_ms: 86400000,
  rate_limits: { window_ms: 60000, register: 100, heartbeat: 100, write: 100, read: 100 },
});
const token = reactive({ newValue: '', newPassword: '' });

async function reload() {
  loading.value = true;
  try {
    const s = await api.settings();
    settings.value = s;
    Object.assign(form, {
      stale_ms: s.stale_ms,
      max_devices_per_ip: s.max_devices_per_ip,
      metrics_hours: s.metrics_hours,
      session_ttl_ms: s.session_ttl_ms,
      rate_limits: {
        window_ms: s.rate_limits.window_ms,
        register: s.rate_limits.register,
        heartbeat: s.rate_limits.heartbeat,
        write: s.rate_limits.write,
        read: s.rate_limits.read,
      },
    });
    saved.value = false;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await api.saveSettings({
      stale_ms: form.stale_ms,
      max_devices_per_ip: form.max_devices_per_ip,
      metrics_hours: form.metrics_hours,
      session_ttl_ms: form.session_ttl_ms,
      rate_limits: form.rate_limits,
    });
    saved.value = true;
    ElMessage.success('Настройки сохранены и применены');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function saveToken() {
  if (!token.newValue) {
    ElMessage.warning('Введите новое значение токена');
    return;
  }
  try {
    await api.saveSettings({ api_token: token.newValue });
    token.newValue = '';
    ElMessage.success('API-токен обновлён');
    reload();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function clearToken() {
  try {
    await ElMessageBox.confirm('Удалить API-токен? Устройства перестанут проходить авторизацию.', 'Осторожно', {
      type: 'warning',
      confirmButtonText: 'Очистить',
      cancelButtonText: 'Отмена',
    });
    await api.saveSettings({ api_token: '' });
    ElMessage.success('API-токен очищен');
    reload();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message);
  }
}

async function savePassword() {
  if (!token.newPassword) {
    ElMessage.warning('Введите новый пароль');
    return;
  }
  if (token.newPassword.length < 8) {
    ElMessage.warning('Минимум 8 символов');
    return;
  }
  try {
    await api.saveSettings({ panel_password: token.newPassword });
    token.newPassword = '';
    ElMessage.success('Пароль панели обновлён');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function restart() {
  try {
    await ElMessageBox.confirm('Перезапустить сервер сейчас? Панель отключится на несколько секунд.', 'Перезапуск', {
      type: 'warning',
      confirmButtonText: 'Перезапустить',
      cancelButtonText: 'Отмена',
    });
    await api.restart();
    ElMessage.info('Сервер перезапускается…');
    setTimeout(() => window.location.href = '/panel/', 3000);
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message);
  }
}

onMounted(reload);
</script>

<style scoped>
.form-hint {
  margin-left: 10px;
  color: var(--panel-text-dim);
  font-size: 12px;
}
</style>