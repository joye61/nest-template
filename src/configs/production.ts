export default {
  // 生产环境不显示日志颜色
  colors: false,
  cors: {
    origin: [/\.example\.com$/],
    methods: ['GET', 'POST'],
    credentials: true,
  }
};
