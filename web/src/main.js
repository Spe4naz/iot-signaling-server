import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import ru from 'element-plus/dist/locale/ru.mjs';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'uplot/dist/uPlot.min.css';
import './styles.css';

import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(ElementPlus, { locale: ru });
app.use(router);
app.mount('#app');