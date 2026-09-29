import { createRouter, createWebHistory } from 'vue-router';
import { check, sessionState } from './store';

import Login from './views/Login.vue';
import Layout from './views/Layout.vue';
import Dashboard from './views/Dashboard.vue';
import Devices from './views/Devices.vue';
import DeviceDetail from './views/DeviceDetail.vue';
import Alerts from './views/Alerts.vue';
import Rules from './views/Rules.vue';
import Settings from './views/Settings.vue';

const router = createRouter({
  history: createWebHistory('/panel/'),
  routes: [
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    {
      path: '/',
      component: Layout,
      children: [
        { path: '', name: 'dashboard', component: Dashboard, meta: { title: 'Обзор' } },
        { path: 'devices', name: 'devices', component: Devices, meta: { title: 'Устройства' } },
        { path: 'devices/:id', name: 'device-detail', component: DeviceDetail, meta: { title: 'Устройство' } },
        { path: 'alerts', name: 'alerts', component: Alerts, meta: { title: 'Алерты' } },
        { path: 'rules', name: 'rules', component: Rules, meta: { title: 'Правила' } },
        { path: 'settings', name: 'settings', component: Settings, meta: { title: 'Настройки' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (!sessionState.checked) {
    await check();
  }
  if (to.meta.public) {
    if (sessionState.ok) return '/';
    return true;
  }
  if (!sessionState.ok) return '/login';
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title || 'Панель'} · IoT Panel`;
});

export default router;