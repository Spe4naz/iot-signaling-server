<template>
  <el-container class="panel-layout">
    <el-aside :width="collapsed ? '64px' : '220px'" class="panel-sidebar">
      <div class="brand">
        <div class="brand-logo">IoT</div>
        <div v-if="!collapsed">
          <div class="brand-title">IoT Panel</div>
          <div class="brand-sub">v{{ version }}</div>
        </div>
      </div>

      <el-menu
        :default-active="route.path"
        :collapse="collapsed"
        router
        background-color="transparent"
      >
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>
          <template #title>Обзор</template>
        </el-menu-item>
        <el-menu-item index="/devices">
          <el-icon><Monitor /></el-icon>
          <template #title>Устройства</template>
        </el-menu-item>
        <el-menu-item index="/alerts">
          <el-icon><Bell /></el-icon>
          <template #title>Алерты</template>
        </el-menu-item>
        <el-menu-item index="/rules">
          <el-icon><SetUp /></el-icon>
          <template #title>Правила</template>
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <template #title>Настройки</template>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer">
        <span v-if="!collapsed">
          Сервер {{ serverState.online ? 'в сети' : '—' }}
          <span
            class="dot"
            :class="serverState.online ? 'dot-online' : 'dot-offline'"
            style="display: inline-block; margin-left: 4px"
          />
        </span>
        <el-button
          text
          size="small"
          :title="collapsed ? 'Развернуть' : 'Свернуть'"
          @click="collapsed = !collapsed"
        >
          <el-icon><Expand v-if="collapsed" /><Fold v-else /></el-icon>
        </el-button>
      </div>
    </el-aside>

    <el-container>
      <el-header class="topbar" height="58px">
        <div style="font-weight: 600; display: flex; align-items: center; gap: 8px">
          {{ route.meta.title || '' }}
          <el-tag
            v-if="!sessionState.apiTokenSet"
            type="warning"
            size="small"
            effect="plain"
          >
            API-токен не задан
          </el-tag>
        </div>

        <div style="display: flex; align-items: center; gap: 14px">
          <span v-if="serverState.level" class="mono" style="color: var(--panel-text-dim)">
            node: {{ serverState.level }}
          </span>
          <el-tooltip content="Проверить соединение с сервером">
            <el-button
              text
              size="small"
              :icon="serverState.online ? Connection : CircleClose"
              :type="serverState.online ? 'success' : 'danger'"
              @click="ping"
            />
          </el-tooltip>
          <el-tooltip content="Частота обновления данных">
            <el-select
              v-model="refreshSec"
              size="small"
              style="width: 110px"
              @change="applyRefresh"
            >
              <el-option label="10 сек" :value="10" />
              <el-option label="30 сек" :value="30" />
              <el-option label="60 сек" :value="60" />
            </el-select>
          </el-tooltip>
          <el-tooltip content="Выйти">
            <el-button text size="small" :icon="SwitchButton" @click="logout" />
          </el-tooltip>
        </div>
      </el-header>

      <el-main class="panel-main">
        <div class="page-body">
          <router-view />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { reactive, ref, provide, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Odometer, Monitor, Bell, SetUp, Setting,
  SwitchButton, Expand, Fold, Connection, CircleClose,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { check, sessionState, evict } from '../store';

const route = useRoute();
const router = useRouter();
const collapsed = ref(false);
const refreshSec = ref(30);
const ticker = ref(0);
const version = ref('—');
const serverState = reactive({ online: false, level: '' });

provide('panelTicker', ticker);

let timers = [];

async function ping() {
  try {
    await api.session();
    serverState.online = true;
    ElMessage({ type: 'success', message: 'Сервер доступен', duration: 1200 });
  } catch {
    serverState.online = false;
    ElMessage({ type: 'error', message: 'Нет соединения с сервером', duration: 1500 });
  }
}

async function applyRefresh() {
  timers.forEach((t) => clearInterval(t));
  if (refreshSec.value > 0) {
    timers.push(setInterval(() => ticker.value++, refreshSec.value * 1000));
  }
}

async function logout() {
  try {
    await api.logout();
  } catch {
    /* ignore */
  }
  evict();
  router.push('/login');
}

onMounted(async () => {
  await check();
  version.value = sessionState.version || '';
  applyRefresh();
  ping();
});

onUnmounted(() => timers.forEach((t) => clearInterval(t)));

defineExpose({ ticker });
</script>