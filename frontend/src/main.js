import { createApp } from 'vue';
import 'element-plus/theme-chalk/el-message.css';
import 'element-plus/theme-chalk/el-message-box.css';
import App from './App.vue';
import router from './router';
import './styles.css';

const app = createApp(App);

app.use(router);
app.mount('#app');
