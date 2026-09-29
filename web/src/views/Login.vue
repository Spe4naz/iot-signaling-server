<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-logo">IoT</div>
        <div>
          <div class="brand-title">IoT Panel</div>
          <div class="brand-sub">Self-hosted control</div>
        </div>
      </div>

      <el-form v-if="!disabled">
        <el-form-item>
          <el-input
            v-model="password"
            type="password"
            show-password
            placeholder="Пароль панели"
            size="large"
            :prefix-icon="Lock"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-alert
          v-if="error"
          type="error"
          :closable="false"
          :title="error"
          show-icon
          class="mb"
        />
        <el-button
          type="primary"
          size="large"
          style="width: 100%"
          :loading="loading"
          @click="submit"
        >
          Войти
        </el-button>
      </el-form>

      <el-alert
        v-else
        type="warning"
        :closable="false"
        :title="`Панель отключена. Задайте PANEL_PASSWORD в конфигурации сервера.`"
        show-icon
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Lock } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { check, sessionState } from '../store';

const router = useRouter();
const password = ref('');
const loading = ref(false);
const error = ref('');
const disabled = ref(false);

async function submit() {
  if (!password.value) {
    error.value = 'Введите пароль';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await api.login(password.value);
    password.value = '';
    await check();
    router.push('/');
  } catch (e) {
    if (e.status === 401) error.value = 'Неверный пароль';
    else if (e.status === 503) disabled.value = true;
    else if (e.status === 429) error.value = 'Слишком много попыток. Подождите минуту';
    else error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await check();
  if (sessionState.ok) {
    router.push('/');
    return;
  }
  if (router.currentRoute.value.query.s && router.currentRoute.value.query.s === 'disabled') {
    disabled.value = true;
  }
  ElMessage({ type: 'info', message: 'Войдите для доступа к панели', duration: 1500 });
});
</script>

<style scoped>
.mb { margin-bottom: 14px; }
</style>